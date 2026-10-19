import { buffer } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { CrashRecord, Logger, NodeLogEntry, NodeRuntime, NodeRuntimeOptions, NodeStartResult, NodeState } from '@fellow99/node-bridge';
import {
  AGENT_DIR_NAME,
  APP_LOG_NAME,
  ARCHIVE_REL,
  ARCHIVE_VERSION_REL,
  BRIDGE_BOOTSTRAP_FILE,
  BRIDGE_HOST_FILE,
  CWD_DIR_NAME,
  DEFAULT_PORT,
  DIAG_LOG_LINES,
  ENV_AGENT_DIR,
  ENV_APP_NAME,
  ENV_HOS_ROOTS,
  ENV_NO_PROXY,
  ENV_NO_PROXY_LOWER,
  ENV_OFFLINE,
  ENV_SKIP_VERSION_CHECK,
  ENV_WEB_HOSTNAME,
  ENV_WEB_PORT,
  CAP_TERMINAL_REASON,
  Log,
  PAYLOAD_DIR,
  PAYLOAD_ENTRY,
  PI_WEB_ENTRY_FILE,
  PROBE_ATTEMPTS,
  PROBE_INTERVAL_MS,
  READY_MARKER_INTERVAL_MS,
  READY_MARKER_TIMEOUT_MS,
  READONLY_PAYLOAD_DIR,
  HOST_PROBE_CAPABILITIES,
  HOST_MAILBOX_DIR_NAME,
  ENV_HOST_MAILBOX,
  SandboxRootCheck,
  WAIT_RUNNING_TIMEOUT_MS,
  appUrl,
  checkSandboxRoot,
  escapeJson,
  readyMarkerPath,
  sandboxRoot
} from '../common/Constants';
import { HttpProbeResult, PortResolution, Ports } from '../common/Ports';
import { HostCapabilities } from '../host/HostCapabilities';

/** 界面上看到的状态机（与库的运行时状态区分：这里是「整机可用性」） */
export enum UIState {
  IDLE = 'idle',
  LAUNCHING = 'launching',
  READY = 'running',
  FAILED = 'failed'
}

/** 载荷路线（工程规划 §7.1）。**判定依据是文件存在性**，不是编译期开关 —— 免得「以为走了 A 其实走了 B」。 */
export enum PayloadRoute {
  /** ① 只读直读（首选）：`resfile/pi-web/`，零解压 */
  READONLY = 'readonly',
  /** ② `tar.gz` + Node 自解包：`resfile/pi-web/pi-web.tar.gz`（本应用实际使用的产品路线） */
  ARCHIVE = 'tar',
  /** 骨架期自检载荷（Phase 0 回归路径）：`rawfile/selfcheck.js` */
  SELFCHECK = 'selfcheck'
}

/**
 * 载荷装配计划（**声明式**：ArkTS 不接受匿名结构体，所有中间结果都要有类型）。
 */
export class PayloadPlan {
  route: PayloadRoute = PayloadRoute.SELFCHECK;
  /** 交给库的 `entry`（**应用入口**，经 `NODE_BRIDGE_ENTRY` 由库 bootstrap 按运行根解析）；自检路线为空 */
  entry: string = '';
  /**
   * 交给库的 `scriptPath`：**`node::Start` 实际执行的脚本**。
   * 路线 ①② 一律 = 库引导器 `bootstrap.js`（解归档 / 幂等 marker / 异常兜底 / 独立日志都在它里面）；
   * 路线 ③ = 自检脚本（Phase 0 回归，保持原行为）。
   */
  scriptPath: string = '';
  /** 库引导器绝对路径（路线 ①② 的判据与证据；路线 ③ 为空 ⇒ 诊断显示「(未使用)」） */
  bootstrap: string = '';
  /** 只读直读根（路线 ①） */
  readonlyRoot: string = '';
  /** 归档绝对路径（路线 ②） */
  archive: string = '';
  /** 归档 sha256（路线 ② 的幂等键；读不到就是空串，交给库自己算一次） */
  archiveSha256: string = '';
  /** 证据：为什么选这条路线（要进日志，也要能上屏） */
  decision: string = '';
}

/**
 * 一个「声明的」工作区根（与 `PI_HOS_ROOTS` 的元素同构）。
 * ArkTS 不接受匿名结构体，故显式建模；`permType` 为空串 = JSON 里的 `null`（沙箱根不需要 ACL 权限）。
 */
export class DeclaredRoot {
  id: string;
  label: string;
  path: string;
  permType: string;

  constructor(id: string, label: string, path: string, permType: string) {
    this.id = id;
    this.label = label;
    this.path = path;
    this.permType = permType;
  }
}

/**
 * PiDesktopRuntime —— 消费方编排（本工程自己的逻辑，不属于库）。
 *
 * 启动编排（工程规划 §4 启动时序 / §5.10 ⑪⑭）：
 *   ① 载荷装配（路线判定 + 必要的物化）→ ② `NodeRuntime.start()` 投递
 *   → ③ `await waitUntilRunning()`（库的通用轮询；超时**reject**，必须 catch）
 *   → ④ **读回真实端口**（Node 侧就绪 marker / 日志行）→ ⑤ HTTP 探活 → ⑥ `markRunning()` → READY。
 *
 * ⚠️ 崩溃是终态：进程内 Node 不会自动重启（硬约束 ⑥）。本类只负责**如实报告**，
 *    不做「偷偷重启」——那只会把问题藏起来。失败一律留下可截图的文字 + 日志尾。
 */
export class PiDesktopRuntime {
  private static instance: PiDesktopRuntime | undefined = undefined;

  private state: UIState = UIState.IDLE;
  private port: number = 0;
  private lastError: string = '';
  private stage: string = 'idle（尚未启动）';
  private route: PayloadRoute = PayloadRoute.SELFCHECK;
  private routeDecision: string = '(未判定)';
  private portSource: string = 'none';
  private portEvidence: string = '';
  private hostSummary: string = '(未注册)';
  private launching: boolean = false;
  /** 本轮计划使用的库引导器（进诊断串；路线 ③ 显示「(未使用)」） */
  private bootstrapPlan: string = '(未判定)';
  /**
   * 本轮投递的时刻（epoch ms）。用途：把**跨启动累积**的 node.log 切成「本轮」——
   * 端口回退解析绝不能读到上一轮的 `PI_WEB_READY`（真机实测缺陷，见 resolveActualPort 的注释）。
   */
  private launchStartedAt: number = 0;
  /**
   * 声明过的工作区根的建立结果（P1a；`<id>=ok|skip|FAIL(...)` 用 `｜` 连接）。
   * 进诊断串 —— 建不出来是**必须可见**的事实，不允许只躺在日志里（C2）。
   */
  private workspaceRootsNote: string = '(尚未执行)';
  /**
   * 沙箱基座断言的结果（C2）：`ok｜filesDir=…｜沙箱根=…` 或 `MISMATCH｜…`。
   * 与 `workspaceRootsNote` 分开：前者说的是「基座对不对」，后者说的是「目录建没建出来」。
   */
  private sandboxBaseNote: string = '(尚未执行)';

  static getInstance(): PiDesktopRuntime {
    if (PiDesktopRuntime.instance === undefined) {
      PiDesktopRuntime.instance = new PiDesktopRuntime();
    }
    return PiDesktopRuntime.instance;
  }

  getState(): UIState {
    return this.state;
  }

  getPort(): number {
    return this.port;
  }

  getStage(): string {
    return this.stage;
  }

  getLastError(): string {
    return this.lastError;
  }

  /** 是否已在启动中/已就绪（页面重复进入时不要重复投递；`start()` 的幂等保护在库内） */
  isBusy(): boolean {
    return this.launching || this.state === UIState.READY;
  }

  getRoute(): PayloadRoute {
    return this.route;
  }

  getRouteDecision(): string {
    return this.routeDecision;
  }

  getHostSummary(): string {
    return this.hostSummary;
  }

  /** 就绪前不要拿它拼 URL（端口 0 = 还没读回真实端口，`getUrl()` 会返回空串） */
  getUrl(): string {
    return this.port > 0 ? appUrl(this.port) : '';
  }

  /** 诊断面板与错误页用它显示「服务端到底在哪」 */
  getUrlOrPending(): string {
    const url: string = this.getUrl();
    return url.length > 0 ? url : '(端口未就绪)';
  }

  private setStage(text: string): void {
    this.stage = text;
    Log.info('[stage] ' + text);
  }

  /**
   * 启动后端并等待可用。
   *
   * @param context UIAbilityContext
   * @param flags Node 参数；`--jitless` 只用于诊断（关 WASM ⇒ Next 的 WASM SWC 与 undici 的 llhttp 全废）
   * @returns 人读状态串（同时写入状态机；失败串里必须能看出**下一步该干什么**）
   */
  async launch(context: common.UIAbilityContext, flags: string): Promise<string> {
    if (this.state === UIState.READY) {
      return 'already running: ' + this.getUrlOrPending();
    }
    if (this.launching) {
      // 重复调用直接返回现状：库那边 `start()` 二次调用会以 code=-1 拒绝（幂等保护在库内）
      return 'launching（已在投递中，忽略重复请求）';
    }
    this.launching = true;
    this.state = UIState.LAUNCHING;
    this.lastError = '';
    try {
      return await this.launchInternal(context, flags);
    } finally {
      this.launching = false;
    }
  }

  private async launchInternal(context: common.UIAbilityContext, flags: string): Promise<string> {
    const runtime: NodeRuntime = NodeRuntime.getInstance();
    // 记下本轮投递时刻（先于任何日志写入）：端口回退解析只认这之后的行（见 resolveActualPort）
    this.launchStartedAt = Date.now();

    // 把库的沙箱目录先建好（payload/ + tmp/ + node-bridge/），再投递（库内部也会做一次，幂等）
    this.setStage('准备沙箱目录');
    // P2：能力事实在启动时就进 hilog —— 「终端/PTY 不支持」必须可被 grep 到，而不是只在点开终端时才炸
    Log.info('能力：' + this.getCapabilityNotice());
    try {
      const payloadDir: string = context.filesDir + '/' + PAYLOAD_DIR;
      const tmpDir: string = context.filesDir + '/tmp';
      const bridgeDir: string = context.filesDir + '/node-bridge';
      this.ensureDir(payloadDir);
      this.ensureDir(tmpDir);
      this.ensureDir(bridgeDir);
      // E18：宿主桥文件信箱目录（Node 写 .req / ArkTS 泵读它）；两侧同路径、同 UID
      this.ensureDir(context.filesDir + '/' + HOST_MAILBOX_DIR_NAME);
      this.ensureDir(context.filesDir + '/' + AGENT_DIR_NAME);
      this.ensureDir(context.filesDir + '/' + CWD_DIR_NAME);
      // C2：基座断言先于建目录 —— 「沙箱根对不对」和「建没建出来」是两件事
      this.assertSandboxBase(context);
      // P1a：声明过的沙箱内工作区根（`<base>/workspace` 等）必须在这里建 —— browse API 拒绝代建
      this.ensureDeclaredRoots(context);
    } catch (e) {
      // 建目录失败不致命（库与 Node 侧会各自再报），但必须可见
      Log.warn('目录准备阶段出现异常（继续启动，后续由 Node 侧报错）：' + Ports.describe(e));
    }

    // ① 载荷装配
    this.setStage('装配载荷（路线判定）');
    const plan: PayloadPlan = this.buildPlan(context);
    this.route = plan.route;
    this.routeDecision = plan.decision;
    this.bootstrapPlan = plan.bootstrap.length > 0 ? plan.bootstrap : '(未使用：自检路线)';
    Log.info('载荷路线 = ' + plan.route + '｜依据：' + plan.decision);

    // 上一轮的**就绪 marker 必须在投递前作废**：它是「本轮真实端口」的唯一权威来源，
    // 读到上一轮的端口会让探活打到随进程一起消失的旧端口（实测：重启后 UI 显示
    // FAILED「connect: Failed to connect to the server @ http://127.0.0.1:40477/（端口来自 marker）」，
    // 而本轮真实端口是 46619）。载荷会在就绪后立刻重写它，因此作废是安全且必要的。
    if (plan.route !== PayloadRoute.SELFCHECK) {
      this.invalidateReadyMarker(context);
    }

    /*
     * E18：**在投递之前**把信箱泵起起来。
     *
     * 顺序不能反：Node 一侧的 `pi-web-launch.js` 拿到 `PI_HOST_MAILBOX` 后会立刻
     * `useFileMailbox()`，并在启动期做一次真实往返探针（`runtime.facts`）。
     * 泵晚于 Node 起来 ⇒ 那次探针的 `.req` 会先在目录里等人 —— 不会丢（下次轮询就取到），
     * 但会把「首启探针耗时」计入 100~200 ms 的额外等待；先起泵就没有这段。
     *
     * 失败不阻断启动：`startMailbox` 如实返回 `refused:*` 串，Node 侧届时会报
     * `transport-unavailable` / `timeout`（结构化、可 grep），**不会**静默成功。
     */
    const mailboxDir: string = context.filesDir + '/' + HOST_MAILBOX_DIR_NAME;

    const mailboxState: string = runtime.host.startMailbox(mailboxDir, 100);
    Log.info('宿主信箱：' + mailboxState);
    // 宿主能力桥：**投递之前**注册（注册面先对，传输才有东西可分发）
    this.hostSummary = HostCapabilities.install(runtime, context)
      + '｜信箱' + (mailboxState.startsWith('started') ? '已启动' : '未启动（' + mailboxState + '）');
    this.lastError = '';
    this.setStage('投递 Node（dlopen + node::Start，在库的 detached 线程里）');
    Log.info('launch: flags=' + flags + ' route=' + plan.route + ' entry=' + plan.entry
      + ' bootstrap=' + plan.bootstrap + ' script=' + plan.scriptPath);

    // ② 应用语义环境（唯一事实源是 payload/env.js；这里按同一份契约装配）
    const env: Record<string, string> = this.buildAppEnv(context);

    // ③ 投递启动：按路线给**不同形状**的参数（F4：`scriptPath` = node::Start 实际执行的脚本 = 库引导器；
    //    `entry` = 应用入口，经 NODE_BRIDGE_ENTRY 交给 bootstrap 按运行根解析 —— 两者同时给才是新契约形状）
    let options: NodeRuntimeOptions;
    if (plan.route === PayloadRoute.READONLY) {
      options = {
        scriptPath: plan.scriptPath,
        entry: plan.entry,
        readonlyRoot: plan.readonlyRoot,
        payloadRoot: context.filesDir + '/' + PAYLOAD_DIR,
        flags: flags,
        env: env
      };
    } else if (plan.route === PayloadRoute.ARCHIVE) {
      options = {
        scriptPath: plan.scriptPath,
        entry: plan.entry,
        archive: plan.archive,
        archiveSha256: plan.archiveSha256,
        payloadRoot: context.filesDir + '/' + PAYLOAD_DIR,
        flags: flags,
        env: env
      };
    } else {
      // Phase 0 回归路径：只有自检脚本（`scriptPath` 形态，保持原有行为不变）
      options = {
        scriptPath: plan.scriptPath,
        payloadRoot: context.filesDir + '/' + PAYLOAD_DIR,
        flags: flags,
        env: env
      };
    }

    const result: NodeStartResult = runtime.start(context, options);
    if (!result.ok) {
      // code 语义（契约 §2.4）：-2 参数校验失败、-1 状态非 idle、>0 pthread_create 错误码
      this.fail('start 投递失败（code=' + result.code + '，state=' + result.state + '）：' + result.message);
      return 'FAILED: ' + this.lastError;
    }
    Log.info('start 已投递：state=' + result.state + ' code=' + result.code);

    /*
     * 宿主能力自检（默认空 ⇒ 什么都不做，见 `Constants.HOST_PROBE_CAPABILITIES`）。
     *
     * 为什么放在这里：它只依赖 ArkTS 侧的处理器注册（`HostCapabilities.install` 已在
     * 投递之前完成），不需要 Node 起来。**不 await**：其中会有弹窗/跳转（E17/E19），
     * 让它们自己跑，不阻塞启动流程。
     */
    this.probeLogPath = context.filesDir + '/capability-probe.log';
    this.runCapabilityProbes(runtime);

    // ④ 等 Node 线程真正跑起来（库的通用轮询；**超时会 reject**，且库会自己 markFailed）
    this.setStage('等待 Node 运行（waitUntilRunning，上限 ' + WAIT_RUNNING_TIMEOUT_MS + ' ms）');
    try {
      await runtime.waitUntilRunning(WAIT_RUNNING_TIMEOUT_MS);
      Log.info('Node 线程已运行：stage=' + runtime.getStage() + ' isRunning=' + runtime.isRunning());
    } catch (e) {
      const detail: string = Ports.describe(e);
      this.fail('Node 未能进入运行态：' + detail + '（stage=' + runtime.getStage()
        + '，lastError=' + runtime.getLastError() + '，log=' + runtime.getLogPath() + '）');
      return 'FAILED: ' + this.lastError;
    }

    // ⑤ 产品路线：**读回真实端口**（marker → 日志），再探活。
    //    自检路线（Phase 0）仍用 DEFAULT_PORT（15577；selfcheck.js 的约定端口），且不读 marker。
    if (plan.route === PayloadRoute.SELFCHECK) {
      this.port = DEFAULT_PORT;
      this.portSource = 'selfcheck:fixed';
      this.portEvidence = '自检载荷固定监听 127.0.0.1:' + DEFAULT_PORT + '（selfcheck.js 的约定端口；'
        + '产品路线不会走这里）';
    } else {
      this.setStage('读回真实端口（' + Ports.markerName() + '）');
      const resolution: PortResolution = await this.resolveActualPort(context, runtime);
      if (!resolution.ok()) {
        this.fail('未能读回服务端口：' + resolution.evidence + '（日志：' + runtime.getLogPath() + '）');
        return 'FAILED: ' + this.lastError;
      }
      this.port = resolution.port;
      this.portSource = resolution.source;
      this.portEvidence = resolution.evidence;
      Log.info('真实端口 = ' + this.port + '（依据：' + this.portSource + '）｜' + this.portEvidence);
    }

    // ⑥ HTTP 探活（只有探活成功才算 READY；`start()` 只代表「已投递」）
    this.setStage('探活 ' + appUrl(this.port) + '（' + PROBE_ATTEMPTS + ' 次 × ' + PROBE_INTERVAL_MS + ' ms）');
    const probe: HttpProbeResult = await Ports.probeWithRetry(appUrl(this.port), PROBE_ATTEMPTS, PROBE_INTERVAL_MS);
    if (!probe.ok) {
      this.fail('探活失败：' + probe.detail + '（端口来自 ' + this.portSource + '；Node 日志：'
        + runtime.getLogPath() + '；载荷日志：' + context.filesDir + '/' + PAYLOAD_DIR + '/' + APP_LOG_NAME + '）');
      return 'FAILED: ' + this.lastError;
    }

    runtime.markRunning();
    this.state = UIState.READY;
    this.setStage('就绪：' + appUrl(this.port));
    Log.info('READY: ' + appUrl(this.port) + '（探活 ' + probe.detail + '）');
    return 'READY: ' + appUrl(this.port) + '（route=' + plan.route + '，端口依据=' + this.portSource + '）';
  }

  /** 失败统一出口：状态 + 文字 + 日志三处都要留下东西（规划 §3 目标 7「失败可见」） */
  private fail(reason: string): void {
    this.state = UIState.FAILED;
    this.lastError = reason;
    this.stage = 'FAILED';
    Log.error(reason);
    try {
      const runtime: NodeRuntime = NodeRuntime.getInstance();
      if (runtime.getState() !== NodeState.IDLE) {
        runtime.markFailed(reason);
      }
    } catch (e) {
      Log.error('markFailed 调用异常（状态已在本类记录）：' + Ports.describe(e));
    }
  }

  /**
   * 载荷路线判定（**证据驱动**：查文件，不查编译期开关）。
   *
   * 顺序刻意与工程规划 §7.1 的优先级一致：只读直读（零解压）→ tar.gz（可写路线）→ 自检（Phase 0 回归）。
   *
   * F4：三条路线都必须能回答「引导器在哪」。库的 `bootstrap.js` 是 `scriptPath`
   * （`node::Start` 实际执行的脚本）：只有它被执行，归档解包、幂等 marker、`uncaughtException`
   * 兜底与独立日志通道才会生效。引导器缺失 ⇒ **该路线判定失败并把原因写进 decision**，
   * 继续试下一条（不静默回退）；三条都不成立时照旧返回自检路线，让 Node 侧如实报错。
   */
  private buildPlan(context: common.UIAbilityContext): PayloadPlan {
    const plan: PayloadPlan = new PayloadPlan();
    const payloadRoot: string = context.filesDir + '/' + PAYLOAD_DIR;
    /** 已判定失败的上游路线原因：一路带进最终 decision（C2：不静默回退） */
    let blocked: string = '';

    // 路线 ①：`<resourceDir>/pi-web/pi-web-launch.js` + 同层/根下的库引导器
    const readonlyRoot: string = context.resourceDir;
    const entryRel: string = READONLY_PAYLOAD_DIR + '/' + PI_WEB_ENTRY_FILE;
    if (readonlyRoot.length > 0) {
      const entryAbs: string = readonlyRoot + '/' + entryRel;
      if (this.fileExists(entryAbs)) {
        const bootstrapAbs: string = this.findBootstrap(readonlyRoot);
        if (bootstrapAbs.length > 0) {
          plan.route = PayloadRoute.READONLY;
          plan.entry = entryRel;
          plan.scriptPath = bootstrapAbs;
          plan.bootstrap = bootstrapAbs;
          plan.readonlyRoot = readonlyRoot;
          plan.decision = 'resfile 直读命中：' + entryAbs + '；引导器 = ' + bootstrapAbs
            + '（scriptPath，零解压；entry=' + entryRel + ' 由 bootstrap 按运行根解析，'
            + 'readonlyRoot=context.resourceDir）';
          return plan;
        }
        blocked += '路线 ① 判定失败：入口存在但库引导器缺失（已查 ' + readonlyRoot + '/'
          + READONLY_PAYLOAD_DIR + '/' + BRIDGE_BOOTSTRAP_FILE + ' 与 ' + readonlyRoot + '/'
          + BRIDGE_BOOTSTRAP_FILE + '，都不存在）｜';
        Log.error(blocked + '不静默降级到没用过的形态：改试下一条路线');
      } else {
        Log.warn('只读直读入口不存在（回退下一条路线）：' + entryAbs);
        blocked += '路线 ① 未命中：入口不存在（' + entryAbs + '）｜';
      }
    } else {
      Log.warn('context.resourceDir 为空：无法使用只读直读路线（库的 Env.readonlyRoot 同样返回空串，C2）');
      blocked += '路线 ① 不可用：context.resourceDir 为空｜';
    }

    // 路线 ②：`resfile/pi-web/pi-web.tar.gz`（Node 侧 bootstrap 自己解包；ArkTS 只判定 + 传参）
    // ⚠️ 判据是 **resfile 上的真实 fs 检查**（`readonlyRoot + '/pi-web/pi-web.tar.gz'`）：
    //    HAP 里**只有 resfile 是磁盘目录**，rawfile 只能经 resourceManager 读、Node 的 fs 打不开它。
    //    实测教训（本轮修掉的缺陷）：归档放 rawfile 时，即使 resourceManager 能探到，Node 侧也读不到，
    //    应用只能静默退回自检路线（`node.log` 里只剩 `[selfcheck] listening …`，`payload/app.log` 缺席）。
    //    `pi-desktop-hos` 同形：归档在 `resfile/resources/app/pi-dist.tar.gz`，主进程直接 fs 读（main.js:40-45）。
    //    因此本路线**不做任何物化搬运**：归档与引导器本来就在磁盘上，`scriptPath` 直接指过去。
    const archiveAbs: string = readonlyRoot.length > 0 ? readonlyRoot + '/' + ARCHIVE_REL : '';
    if (archiveAbs.length > 0 && this.fileExists(archiveAbs)) {
      const bootstrapAbs: string = this.findBootstrap(readonlyRoot);
      if (bootstrapAbs.length === 0) {
        blocked += '路线 ② 判定失败：归档在位但库引导器缺失（已查 ' + readonlyRoot + '/'
          + READONLY_PAYLOAD_DIR + '/' + BRIDGE_BOOTSTRAP_FILE + ' 与 ' + readonlyRoot + '/'
          + BRIDGE_BOOTSTRAP_FILE + '，都不存在）｜';
        Log.error(blocked + '不静默降级：引导器是 scriptPath，缺它则归档不会被解包');
      } else {
        const declared: string = this.readArchiveSha256(readonlyRoot);
        // host.js 与 bootstrap.js 同层（pi-web-launch.js 的关停钩子注册源）；缺席不阻断启动，
        // 但必须在 decision 里说出来 —— 否则「关停钩子没注册」会被当成静默成功。
        const hostAbs: string = readonlyRoot + '/' + READONLY_PAYLOAD_DIR + '/' + BRIDGE_HOST_FILE;
        plan.route = PayloadRoute.ARCHIVE;
        plan.entry = entryRel;
        plan.scriptPath = bootstrapAbs;
        plan.bootstrap = bootstrapAbs;
        plan.archive = archiveAbs;
        plan.archiveSha256 = declared;
        plan.decision = blocked + 'resfile 归档命中（fs 实检）：' + archiveAbs
          + '；引导器 = ' + bootstrapAbs + '（scriptPath，Node 侧解包到 payloadRoot 后按 entry 解析：' + entryRel + '）'
          + '；sha256=' + (declared.length > 0 ? declared.substring(0, 12) + '…（来自 '
            + ARCHIVE_VERSION_REL + '）' : '(未读到 ' + ARCHIVE_VERSION_REL + '，交库按实算值处理)')
          + '；host.js=' + (this.fileExists(hostAbs) ? '在位（关停钩子注册源）' : '缺席（载荷会 warn 并跳过关停钩子）');
        return plan;
      }
    } else {
      blocked += '路线 ② 未命中：resfile 里没有归档（fs 实检 ' + (archiveAbs.length > 0 ? archiveAbs : '(resourceDir 为空)')
        + ' 不存在）｜';
    }

    // Phase 0 回归路径：自检载荷（物化 rawfile，保持原行为不变）
    const selfDest: string = payloadRoot + '/' + PAYLOAD_ENTRY;
    try {
      this.ensureDir(payloadRoot);
      const materialized: string = this.materializeRawfile(context, PAYLOAD_ENTRY, selfDest);
      plan.route = PayloadRoute.SELFCHECK;
      plan.scriptPath = materialized;
      plan.decision = blocked + '自检载荷（Phase 0 回归路径）：物化 ' + PAYLOAD_ENTRY + ' → ' + materialized
        + '（只读路线与归档路线都未成立，原因见本串前面）';
      return plan;
    } catch (e) {
      plan.route = PayloadRoute.SELFCHECK;
      plan.scriptPath = selfDest;
      plan.decision = blocked + '自检载荷物化失败（' + Ports.describe(e) + '）：仍把 ' + selfDest
        + ' 交给 Node，让它报「找不到模块」而不是在这里吞掉';
      Log.error(plan.decision);
      return plan;
    }
  }

  /**
   * 读回**真实端口**（产品路线的唯一端口来源）。
   *
   * 两级来源，都要求「读到合法端口」才算成功：
   *   ① 就绪 marker `<filesDir>/payload/pi-web.ready.json`（载荷写的权威记录）；
   *   ② marker 缺席时退化为解析库日志尾里的 `PI_WEB_READY {"port":…}` / 「服务端口 = …」行。
   * 两级都失败 ⇒ 返回 `port=0`，由调用方进失败态（**绝不**用常量端口顶替）。
   */
  private async resolveActualPort(context: common.UIAbilityContext, runtime: NodeRuntime): Promise<PortResolution> {
    const deadline: number = Date.now() + READY_MARKER_TIMEOUT_MS;
    let attempts: number = 0;
    let lastLogEvidence: string = '';
    while (Date.now() < deadline) {
      attempts++;
      // ① marker
      const markerText: string = Ports.readMarker(context.filesDir);
      if (markerText.length > 0) {
        const port: number = Ports.parsePortFromMarker(markerText);
        if (port > 0) {
          return new PortResolution(port, 'marker', 'marker=' + readyMarkerPath(context.filesDir)
            + '；第 ' + attempts + ' 次读取命中');
        }
      }
      // ② 日志（库通道；载荷的 app.log 由诊断面板读，这里用库的 logs() 拿同一批 stdout）
      // ⚠️ **必须只认本轮的行**：库的 `logs()` 读的是 node.log 尾部，而该文件跨启动累积 ——
      //    重启时会读到上一轮的 `PI_WEB_READY {"port":46619…}` 并拿它去探活（真机实测缺陷：
      //    `FAILED: 探活失败：connect: … :46619（端口来自 log:PI_WEB_READY）`，本轮实际端口 44031）。
      //    因此按本轮投递时刻 `launchStartedAt` 过滤；`at=0` 的行（库未能解析出时间戳）保留，不小看它。
      const entriesText: string = this.logsToTextSince(runtime, 200, this.launchStartedAt);
      const fromLog: number = Ports.parsePortFromLog(entriesText);
      if (fromLog > 0) {
        lastLogEvidence = Ports.evidenceLine(entriesText);
        return new PortResolution(fromLog, 'log:PI_WEB_READY', '第 ' + attempts + ' 次读取命中（仅本轮日志）：'
          + lastLogEvidence);
      }
      if (attempts % 10 === 1) {
        Log.info('等端口：第 ' + attempts + ' 次尝试（marker 未命中，日志里也还没有 PI_WEB_READY）');
      }
      await Ports.sleep(READY_MARKER_INTERVAL_MS);
    }
    return new PortResolution(0, 'none', '等待 ' + READY_MARKER_TIMEOUT_MS + ' ms / ' + attempts
      + ' 次仍无合法端口；marker=' + readyMarkerPath(context.filesDir)
      + '；库日志尾=' + (lastLogEvidence.length > 0 ? lastLogEvidence : '(无 PI_WEB_READY 行)'));
  }

  /**
   * 应用语义环境（`options.env`）。
   *
   * **唯一事实源是 `payload/env.js`**：这里按同一份变量名与语义装配（`Constants.ets` 里只镜像名字），
   * Node 侧启动时还会用 `buildEnv(process.env)` 再算一遍并把最终值写进 `[env]` 日志 ——
   * 两边不一致时以 Node 侧那次为准（日志里能直接看出来谁覆盖了谁）。
   * 刻意**不设** `HOME`/`TMPDIR`/`TMP`/`TEMP`/`NODE_ENV`/`NODE_OPTIONS`：那是库的职责。
   */
  private buildAppEnv(context: common.UIAbilityContext): Record<string, string> {
    const env: Record<string, string> = {};
    env[ENV_OFFLINE] = '1';
    env[ENV_AGENT_DIR] = context.filesDir + '/' + AGENT_DIR_NAME;
    env[ENV_NO_PROXY] = '127.0.0.1,localhost,::1';
    env[ENV_NO_PROXY_LOWER] = env[ENV_NO_PROXY];
    env[ENV_HOS_ROOTS] = this.buildWorkspaceRoots(context);
    env[ENV_SKIP_VERSION_CHECK] = '1';
    env[ENV_APP_NAME] = 'Pi Desktop';
    // 路线 ①：只监听 loopback（同进程本地服务，无需再走局域网），端口 0 = 让 Node 侧探空闲端口（⑰）
    env[ENV_WEB_HOSTNAME] = '127.0.0.1';
    env[ENV_WEB_PORT] = String(Ports.resolvePort(0));
    // E18：宿主桥文件信箱目录。与上面的 `PI_*` 不同，这一项**不属于** pi-web 的 env 契约
    // （`payload/env.js` 的 KEYS 只管 pi 自己消费的变量）——它是**库的传输通道**，
    // 值只由应用侧给出（库不解释沙箱路径，C1）；Node 侧 `host.js` 与 ArkTS 侧泵读同一个串。
    env[ENV_HOST_MAILBOX] = context.filesDir + '/' + HOST_MAILBOX_DIR_NAME;
    return env;
  }

  /**
   * 一个「声明的」工作区根（与 `PI_HOS_ROOTS` 的元素同构，顺序即 UI 顺序）。
   * 单一事实源：`declaredRoots()` 出清单，`buildWorkspaceRoots()` 只负责序列化，
   * `ensureDeclaredRoots()` 只负责把**沙箱内**的根建出来 —— 三者不许各写一份路径。
   */
  private declaredRoots(context: common.UIAbilityContext): DeclaredRoot[] {
    const roots: DeclaredRoot[] = [];
    roots.push(new DeclaredRoot('sandbox', '沙箱', sandboxRoot(context.filesDir), ''));
    // 刻意**只有一个根**：桌面/文档/下载三个用户目录都要 OS 授权（桌面还属 system_basic，
    // 必须 ACL），本版已全部撤掉这些声明（见 module.json5 头注释与
    // docs/ACL-无ACL评估.md）⇒ 与其在 UI 里留三个永远打不开的 Tab，不如不声明它们。
    // 用户要处理外部文件，走「附加文件 / 选择器」（fs.pickFolder，URI 授权、仅本会话）。
    return roots;
  }

  /**
   * C2：启动时把「沙箱基座」打一次日志并断言。
   *
   * 判据（真机缺陷专用）：声明的沙箱根必须以 `context.filesDir` 为前缀。
   * 少了 `haps/<module>` 的 `/data/storage/el2/base/files/workspace` 会在这里
   * 以 `Log.error` 出现，而不是只在用户点开目录选择器时表现为 404。
   */
  private assertSandboxBase(context: common.UIAbilityContext): void {
    const declared: string = sandboxRoot(context.filesDir);
    const check: SandboxRootCheck = checkSandboxRoot(context.filesDir, declared);
    if (check.ok) {
      Log.info('沙箱基座：' + check.message);
    } else {
      Log.error('沙箱基座断言失败：' + check.message);
    }
    this.sandboxBaseNote = (check.ok ? 'ok' : 'MISMATCH') + '｜' + check.message;
  }

  /** 工作区主目录清单（与 `payload/env.js` 的兜底清单同形；选择器结果就绪后由它接管） */
  private buildWorkspaceRoots(context: common.UIAbilityContext): string {
    const roots: DeclaredRoot[] = this.declaredRoots(context);
    let json: string = '[';
    for (let i = 0; i < roots.length; i++) {
      const r: DeclaredRoot = roots[i];
      if (i > 0) {
        json += ',';
      }
      json += '{"id":"' + r.id + '","label":"' + r.label + '","path":"' + escapeJson(r.path) + '","permType":'
        + (r.permType.length === 0 ? 'null' : '"' + r.permType + '"') + '}';
    }
    return json + ']';
  }

  /**
   * P1a：把**声明过的、落在沙箱内**的工作区根**幂等地**建出来（必须在投递 Node 之前）。
   *
   * 为什么只能在这里建：
   *   - `GET /api/cwd/browse?root=sandbox` 在 `<base>/workspace` 不存在时直接回
   *     `{"error":"Directory does not exist","code":"ENOENT","rootId":"sandbox"}`；
   *   - browse API 自己**拒绝**创建它（`Parent path is outside the declared workspace roots`），
   *     于是这个「已声明的根」在真机上永远建不出来，用户在选择器里看到的是一个死入口；
   *   - 宿主应用（进程所有者）是唯一能建它的一层。
   *
   * 失败**不吞**（C2）：逐条 `Log.error` + 汇总进 `workspaceRootsNote`（诊断串里可见）。
   * 沙箱外的根（桌面/文档/下载）**不建也不失败**：它们由 ACL + 权限弹窗决定，应用无权替用户创建。
   */
  private ensureDeclaredRoots(context: common.UIAbilityContext): void {
    const roots: DeclaredRoot[] = this.declaredRoots(context);
    const sandboxPrefix: string = context.filesDir + '/';
    const notes: string[] = [];
    let failed: number = 0;
    for (let i = 0; i < roots.length; i++) {
      const r: DeclaredRoot = roots[i];
      if (!r.path.startsWith(sandboxPrefix)) {
        notes.push(r.id + '=skip(沙箱外，由 ACL 决定)');
        continue;
      }
      const err: string = this.ensureDirStrict(r.path);
      if (err.length === 0) {
        notes.push(r.id + '=ok');
      } else {
        failed += 1;
        notes.push(r.id + '=FAIL(' + err + ')');
        Log.error('声明的工作区根建不出来：' + r.path + '｜' + err);
      }
    }
    this.workspaceRootsNote = notes.join('｜');
    if (failed === 0) {
      Log.info('声明的工作区根：' + this.workspaceRootsNote);
    } else {
      Log.error('声明的工作区根有 ' + failed + ' 条失败：' + this.workspaceRootsNote);
    }
  }

  /**
   * 诊断面板的内容（**可截图断言**）：库侧事实 + 本类编排事实 + 日志尾 + 崩溃记录。
   *
   * ⚠️ 真机 `uitest dumpLayout` 拿不到结果（工程规划 §2.4 / §5.7），所以判据是
   * `snapshot_display` 截图 + 上面串里的**结构化字段**。
   */
  getDiagnostics(): string {
    const runtime: NodeRuntime = NodeRuntime.getInstance();
    let state: string = 'n/a';
    let stage: string = 'n/a';
    let lastError: string = 'n/a';
    let bridgeVersion: string = 'n/a';
    let logPath: string = 'n/a';
    let pid: number = -1;
    let isRunning: boolean = false;
    let logsJson: string = '[]';
    let crashJson: string = 'null';
    try {
      state = escapeJson(runtime.getState() as string);
      stage = escapeJson(runtime.getStage());
      lastError = escapeJson(runtime.getLastError());
      bridgeVersion = escapeJson(runtime.bridgeVersion());
      logPath = escapeJson(runtime.getLogPath());
      pid = runtime.getPid();
      isRunning = runtime.isRunning();
      logsJson = this.logsToJson(runtime, DIAG_LOG_LINES);
      crashJson = this.crashToJson(runtime);
    } catch (e) {
      lastError = escapeJson('读运行时事实失败：' + Ports.describe(e));
    }
    return '{'
      + '"at":"' + new Date().toISOString() + '",'
      + '"uiState":"' + this.state + '",'
      + '"stage":"' + escapeJson(this.stage) + '",'
      + '"lastError":"' + escapeJson(this.lastError) + '",'
      + '"route":"' + this.route + '",'
      + '"routeDecision":"' + escapeJson(this.routeDecision) + '",'
      + '"bootstrap":"' + escapeJson(this.bootstrapPlan) + '",'
      + '"port":' + this.port + ','
      + '"portSource":"' + escapeJson(this.portSource) + '",'
      + '"portEvidence":"' + escapeJson(this.portEvidence) + '",'
      + '"url":"' + escapeJson(this.getUrlOrPending()) + '",'
      + '"hostCapabilities":"' + escapeJson(this.hostSummary) + '",'
      + '"workspaceRoots":"' + escapeJson(this.workspaceRootsNote) + '",'
      + '"sandboxBase":"' + escapeJson(this.sandboxBaseNote) + '",'
      + '"capabilities":' + HostCapabilities.capabilitiesJson() + ','
      + '"node":{"state":"' + state + '","stage":"' + stage + '","bridgeVersion":"' + bridgeVersion + '"'
      + ',"pid":' + pid + ',"isRunning":' + (isRunning ? 'true' : 'false') + ',"lastError":"' + lastError + '"'
      + ',"logPath":"' + logPath + '","logs":' + logsJson + ',"lastCrash":' + crashJson + '}'
      + '}';
  }

  /**
   * P2：给 UI 的能力提示串（**能力标志**的展示层）。
   * 终端/PTY 在本平台**不支持**：这类事实必须以「不支持 + 理由」出现在界面上，
   * 而不是等用户点开终端、再看到一个 `Cannot load the node-pty native terminal module` 的
   * 模块加载异常（那是把平台能力缺失伪装成安装错误）。
   */
  getCapabilityNotice(): string {
    return '终端 / PTY：不支持 —— ' + CAP_TERMINAL_REASON;
  }

  /** 库日志尾（`Logger.tail`，UTF-8 正确解码；读失败返回占位串并记日志，不抛） */
  tailLog(maxBytes: number): string {
    try {
      const runtime: NodeRuntime = NodeRuntime.getInstance();
      const logPath: string = runtime.getLogPath();
      if (logPath.length === 0) {
        return '(日志路径尚未建立：Node 还没投递过)';
      }
      return Logger.tail(logPath, maxBytes);
    } catch (e) {
      Log.error('读日志尾失败：' + Ports.describe(e));
      return '(read failed: ' + Ports.describe(e) + ')';
    }
  }

  /** 载荷自己的日志尾（`<filesDir>/payload/app.log`，⑱ 的独立通道） */
  tailAppLog(filesDir: string, maxBytes: number): string {
    const path: string = filesDir + '/' + PAYLOAD_DIR + '/' + APP_LOG_NAME;
    try {
      return Logger.tail(path, maxBytes);
    } catch (e) {
      return '(read failed: ' + Ports.describe(e) + ')';
    }
  }

  /** 关停：**如实**委托给库（进程内 Node 无法真正停止；库会写日志并说明真相） */
  async shutdown(reason: string): Promise<string> {
    this.setStage('关停请求（' + reason + '）');
    try {
      const runtime: NodeRuntime = NodeRuntime.getInstance();
      await runtime.shutdown(reason);
      const detail: string = 'shutdown(' + reason + ') 已记录：state=' + runtime.getState()
        + '；进程内 node::Start 不返回 ⇒ 真正的停止只能是进程退出（库契约 §2.6）';
      Log.warn(detail);
      return detail;
    } catch (e) {
      const detail: string = 'shutdown(' + reason + ') 失败：' + Ports.describe(e);
      Log.error(detail);
      this.lastError = detail;
      return detail;
    }
  }

  // ── 内部工具 ────────────────────────────────────────────────────────────────

  /**
   * 只取**本轮**的库日志文本（`entry.at >= sinceMs` 或时间戳不可解析的行）。
   *
   * 为什么需要它：库的 `logs()` 读的是 `node.log` 尾部，而该文件跨启动累积。解析端口时读到
   * 上一轮的 `PI_WEB_READY` 会让探活打到旧端口（真机实测：重启后 `FAILED … :46619`，本轮实际 44031）。
   * `at === 0` 表示库没能解析出该行时间戳 —— 无法证明它属于上一轮，因此**保留**（宁可不命中，也不错杀）。
   */
  private logsToTextSince(runtime: NodeRuntime, count: number, sinceMs: number): string {
    try {
      const entries: NodeLogEntry[] = runtime.logs(count);
      let out: string = '';
      let skipped: number = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry: NodeLogEntry = entries[i];
        if (sinceMs > 0 && entry.at > 0 && entry.at < sinceMs) {
          skipped++;
          continue;
        }
        out += entry.text + '\n';
      }
      if (skipped > 0) {
        Log.info('端口解析已排除上一轮日志行 ' + skipped + ' 条（at < launchStartedAt=' + sinceMs + '）');
      }
      return out;
    } catch (e) {
      Log.error('读库日志失败（解析端口时会退化为 marker）：' + Ports.describe(e));
      return '';
    }
  }

  private logsToJson(runtime: NodeRuntime, count: number): string {
    try {
      const entries: NodeLogEntry[] = runtime.logs(count);
      let out: string = '[';
      for (let i = 0; i < entries.length; i++) {
        const entry: NodeLogEntry = entries[i];
        if (i > 0) {
          out += ',';
        }
        out += '{"at":' + entry.at + ',"stream":"' + escapeJson(entry.stream)
          + '","text":"' + escapeJson(entry.text) + '"}';
      }
      return out + ']';
    } catch (e) {
      return '[{"at":0,"stream":"system","text":"读 logs() 失败：' + escapeJson(Ports.describe(e)) + '"}]';
    }
  }

  private crashToJson(runtime: NodeRuntime): string {
    try {
      const crash: CrashRecord | null = runtime.lastCrash();
      if (crash === null || crash === undefined) {
        return 'null';
      }
      let tail: string = '[';
      for (let i = 0; i < crash.logTail.length; i++) {
        if (i > 0) {
          tail += ',';
        }
        tail += '"' + escapeJson(crash.logTail[i]) + '"';
      }
      tail += ']';
      const signal: string = crash.signal !== undefined ? escapeJson(crash.signal) : '';
      const hint: string = crash.hint !== undefined ? escapeJson(crash.hint) : '';
      return '{"at":' + crash.at + ',"stage":"' + escapeJson(crash.stage) + '","signal":"' + signal
        + '","hint":"' + hint + '","logTail":' + tail + '}';
    } catch (e) {
      return '{"readError":"' + escapeJson(Ports.describe(e)) + '"}';
    }
  }

  /**
   * 作废上一轮的就绪 marker（`<filesDir>/payload/pi-web.ready.json`）。
   *
   * 为什么必须做（真机实测缺陷）：marker 是「本轮真实端口」的唯一权威来源，而它由**载荷**在就绪
   * 之后才写。重启时若不先删，ArkTS 会在新服务就绪前读到上一轮的端口并立刻探活 ⇒
   * `FAILED: 探活失败：connect: Failed to connect to the server @ http://127.0.0.1:40477/（端口来自 marker）`，
   * 而本轮服务实际监听 46619（同一台设备连续两次启动的实测端口）。作废后由标记轮询自然等到新端口。
   * 失败只 warn、不阻断启动（最坏情况退回「日志解析端口」的退化路径）。
   */
  private invalidateReadyMarker(context: common.UIAbilityContext): void {
    const marker: string = readyMarkerPath(context.filesDir);
    if (!this.fileExists(marker)) {
      Log.info('就绪 marker 不存在（首启或已作废）：' + marker);
      return;
    }
    try {
      fs.unlinkSync(marker);
      Log.info('已作废上一轮就绪 marker（避免读回旧端口）：' + marker);
    } catch (e) {
      Log.warn('作废就绪 marker 失败（继续启动，可能读回旧端口）：' + marker + '｜' + Ports.describe(e));
    }
  }

  private fileExists(path: string): boolean {
    try {
      return fs.accessSync(path);
    } catch (e) {
      return false;
    }
  }

  /**
   * 读一个**小文本文件**（≤ 64 KiB；`pi-web.version` 这类版本/状态文件）。
   *
   * 为什么手写而不用 `fs.readTextSync`：本类的读文件路径与库的 `Logger.tail` / `Ports.readMarker`
   * 保持同一形态（stat → open → read → `buffer.from(...).toString('utf-8')`），中文不会乱码，
   * 失败一律**返回空串并 warn**（调用方据空串走退化路径，不猜）。
   */
  private readSmallText(path: string): string {
    try {
      const stat: fs.Stat = fs.statSync(path);
      const size: number = stat.size;
      if (size <= 0 || size > 65536) {
        Log.warn('文件大小异常（' + size + ' B），按不可读处理：' + path);
        return '';
      }
      const file: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
      try {
        const ab: ArrayBuffer = new ArrayBuffer(size);
        const read: number = fs.readSync(file.fd, ab);
        const buf: buffer.Buffer = buffer.from(ab, 0, read);
        return buf.toString('utf-8');
      } finally {
        fs.closeSync(file);
      }
    } catch (e) {
      Log.warn('读文件失败（按不可读处理）：' + path + '｜' + Ports.describe(e));
      return '';
    }
  }
  private async runCapabilityProbes(runtime: NodeRuntime): Promise<void> {
    const list: string[] = HOST_PROBE_CAPABILITIES;
    if (list.length === 0) {
      return;
    }
    // 结果**必须落文件**：本机 hilog 的 INFO 行取不到（`docs/002` §8），
    // 而这几类能力恰恰只能靠"弹窗被点了/设置被打开了"来判读 —— 落文件是唯一可复核的通道。
    const logPath: string = this.probeLogPath;
    this.appendProbeLog(logPath, '=== 自检开始：' + list.length + ' 项 ===');
    for (const item of list) {
      const sep: number = item.indexOf('|');
      const name: string = sep < 0 ? item : item.substring(0, sep);
      const args: string = sep < 0 ? '{}' : item.substring(sep + 1);
      try {
        const out: string = await runtime.host.dispatchAsync(name, args);
        this.appendProbeLog(logPath, name + ' -> ' + out);
        Log.info('宿主能力自检 ' + name + ' -> ' + out);
      } catch (e) {
        const detail: string = Ports.describe(e);
        this.appendProbeLog(logPath, name + ' !! ' + detail);
        Log.warn('宿主能力自检 ' + name + ' 抛异常：' + detail);
      }
    }
    this.appendProbeLog(logPath, '=== 自检结束 ===');
  }

  /** 自检日志路径（`<filesDir>/capability-probe.log`；0666 由 fileIo 默认给出，`hdc` 可读） */
  private probeLogPath: string = '';

  /** 追加一行自检日志（**永不抛**：自检本身不该把启动带崩） */
  private appendProbeLog(path: string, line: string): void {
    if (path.length === 0) {
      return;
    }
    try {
      const f: fs.File = fs.openSync(path,
        fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.APPEND);
      try {
        fs.writeSync(f.fd, new Date().toISOString() + ' ' + line + '\n');
      } finally {
        fs.closeSync(f);
      }
    } catch (e) {
      Log.warn('写自检日志失败：' + Ports.describe(e));
    }
  }

  private ensureDir(path: string): void {
    try {
      if (!this.fileExists(path)) {
        fs.mkdirSync(path);
      }
    } catch (e) {
      Log.warn('建目录失败（可能已存在）：' + path + '｜' + Ports.describe(e));
    }
  }

  /**
   * 幂等建目录的**严格**版本：成功返回空串，失败返回可读错误（不吞）。
   * 与上面的 `ensureDir()` 的区别：那个只 warn（启动流程不允许被单个目录挡住），
   * 这个把结果交回调用方 —— 声明根的建立结果要能上诊断面板（C2）。
   */
  private ensureDirStrict(path: string): string {
    try {
      if (this.fileExists(path)) {
        return '';
      }
      fs.mkdirSync(path);
      if (!this.fileExists(path)) {
        return 'mkdirSync 返回后目录仍不存在';
      }
      return '';
    } catch (e) {
      return Ports.describe(e);
    }
  }

  /**
   * 找库引导器（F4）：装配脚本把它投放到 `--out`（默认 `resfile/pi-web/`，与入口同层），
   * 也兼容「直接放 readonlyRoot 根」的布局 —— 两个候选都查，避免装配与运行时各说各话。
   * 都找不到返回空串 ⇒ 调用方**显式判定该路线失败**并说明原因（C2，不静默回退）。
   */
  private findBootstrap(root: string): string {
    const candidates: string[] = [
      root + '/' + READONLY_PAYLOAD_DIR + '/' + BRIDGE_BOOTSTRAP_FILE,
      root + '/' + BRIDGE_BOOTSTRAP_FILE
    ];
    for (let i = 0; i < candidates.length; i++) {
      if (this.fileExists(candidates[i])) {
        return candidates[i];
      }
    }
    return '';
  }

  /** `rawfile` → 沙箱（小文件；自检载荷走这里，与库的 `Env.materializeRawfile` 同语义） */
  private materializeRawfile(context: common.UIAbilityContext, rawName: string, destPath: string): string {
    const data: Uint8Array = context.resourceManager.getRawFileContentSync(rawName);
    const file: fs.File = fs.openSync(destPath,
      fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(file.fd, data.buffer as ArrayBuffer);
    } finally {
      fs.closeSync(file);
    }
    Log.info('载荷已物化：' + destPath + '（' + data.byteLength + ' B）');
    return destPath;
  }

  /**
   * 读归档的 SHA-256 版本文件 `<resfile>/pi-web/pi-web.version`（幂等键的唯一来源）。
   *
   * 形状镜像 `pi-desktop-hos/pi-dist.version`：纯文本、首行 64 位 hex。读不到 ⇒ 返回空串，
   * 由库的 bootstrap 按「实算值」处理（它会把实算 sha256 写进 marker，只是每次都要重算一遍）。
   * 做**首行 64 位 hex 校验**：版本文件被编辑器加了 BOM/换行/说明时，宁可退回实算也不要传错键。
   */
  private readArchiveSha256(readonlyRoot: string): string {
    const versionPath: string = readonlyRoot + '/' + ARCHIVE_VERSION_REL;
    const text: string = this.readSmallText(versionPath);
    if (text.length === 0) {
      Log.warn('未读到归档版本文件（' + versionPath + '）：交给库按实算 sha256 处理');
      return '';
    }
    const firstLine: string = text.split('\n')[0].trim().toLowerCase();
    if (this.isSha256(firstLine)) {
      return firstLine;
    }
    Log.warn('归档版本文件首行不是 64 位 hex（忽略，交给库实算）：' + firstLine.substring(0, 80));
    return '';
  }

  private isSha256(text: string): boolean {
    if (text.length !== 64) {
      return false;
    }
    for (let i = 0; i < text.length; i++) {
      const code: number = text.charCodeAt(i);
      const isDigit: boolean = code >= 48 && code <= 57;
      const isLowerHex: boolean = code >= 97 && code <= 102;
      if (!isDigit && !isLowerHex) {
        return false;
      }
    }
    return true;
  }
}
