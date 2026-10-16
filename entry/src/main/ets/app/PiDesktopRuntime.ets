import { buffer } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { resourceManager } from '@kit.LocalizationKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { CrashRecord, Logger, NodeLogEntry, NodeRuntime, NodeRuntimeOptions, NodeStartResult, NodeState } from '@fellow99/node-bridge';
import {
  AGENT_DIR_NAME,
  APP_LOG_NAME,
  ARCHIVE_RAWFILE,
  ARCHIVE_SHA256_RAWFILE,
  ARCHIVE_STAGED_NAME,
  BRIDGE_BOOTSTRAP_FILE,
  BRIDGE_RAWFILES,
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
  Log,
  PAYLOAD_DIR,
  PAYLOAD_ENTRY,
  PI_WEB_ENTRY_FILE,
  PROBE_ATTEMPTS,
  PROBE_INTERVAL_MS,
  READONLY_PAYLOAD_DIR,
  READY_MARKER_INTERVAL_MS,
  READY_MARKER_TIMEOUT_MS,
  USER_HOME_DIR,
  WAIT_RUNNING_TIMEOUT_MS,
  appUrl,
  escapeJson,
  rawfileDirFromResourceDir,
  readyMarkerPath
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
  /** ② `tar.gz` + Node 自解包（`rawfile/pi-web.tar.gz`） */
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

    // 把库的沙箱目录先建好（payload/ + tmp/ + node-bridge/），再投递（库内部也会做一次，幂等）
    this.setStage('准备沙箱目录');
    try {
      const payloadDir: string = context.filesDir + '/' + PAYLOAD_DIR;
      const tmpDir: string = context.filesDir + '/tmp';
      const bridgeDir: string = context.filesDir + '/node-bridge';
      this.ensureDir(payloadDir);
      this.ensureDir(tmpDir);
      this.ensureDir(bridgeDir);
      this.ensureDir(context.filesDir + '/' + AGENT_DIR_NAME);
      this.ensureDir(context.filesDir + '/' + CWD_DIR_NAME);
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

    // 宿主能力桥：**投递之前**注册（Phase 1 传输不可用，但注册面必须先对）
    this.hostSummary = HostCapabilities.install(runtime, context);
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

    // 路线 ②：`rawfile/pi-web.tar.gz`（先物化归档**与库引导器**，再由 bootstrap 自己解包）
    const rawfileDir: string = rawfileDirFromResourceDir(readonlyRoot);
    const archiveRaw: string = rawfileDir + '/' + ARCHIVE_RAWFILE;
    if (this.fileExists(archiveRaw)) {
      const staged: string = payloadRoot + '/' + ARCHIVE_STAGED_NAME;
      this.setStage('物化归档 + 库引导器（' + ARCHIVE_RAWFILE + ' → ' + staged + '）');
      try {
        this.materializeRawArchive(context, ARCHIVE_RAWFILE, staged);
        // F4：bootstrap（+ host.js / lib/tar-extract.js）必须在**解包之前**就位 —— 解包逻辑在 bootstrap 里
        const bootstrapStaged: string = this.materializeBridge(context, payloadRoot);
        plan.route = PayloadRoute.ARCHIVE;
        plan.entry = entryRel;
        plan.scriptPath = bootstrapStaged;
        plan.bootstrap = bootstrapStaged;
        plan.archive = staged;
        plan.archiveSha256 = this.readArchiveSha256(context);
        plan.decision = blocked + 'tar.gz 路线（包内归档存在）：' + archiveRaw + ' → ' + staged
          + '；引导器 = ' + bootstrapStaged + '（scriptPath，先解包再按 entry 解析：' + entryRel + '）'
          + '；sha256=' + (plan.archiveSha256.length > 0
            ? plan.archiveSha256.substring(0, 12) + '…' : '(未读到旁文件，交库自算)');
        return plan;
      } catch (e) {
        this.setStage('归档/引导器物化失败，试下一条路线');
        Log.error('路线 ② 物化失败（' + archiveRaw + ' → ' + staged + '）：' + Ports.describe(e));
        blocked += '路线 ② 判定失败：物化异常（' + Ports.describe(e) + '）｜';
      }
    } else {
      blocked += '路线 ② 未命中：包内归档不存在（' + archiveRaw + '）｜';
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
      const entriesText: string = this.logsToText(runtime, 200);
      const fromLog: number = Ports.parsePortFromLog(entriesText);
      if (fromLog > 0) {
        lastLogEvidence = Ports.evidenceLine(entriesText);
        return new PortResolution(fromLog, 'log:PI_WEB_READY', '第 ' + attempts + ' 次读取命中：' + lastLogEvidence);
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
    return env;
  }

  /** 工作区主目录清单（与 `payload/env.js` 的兜底清单同形；选择器结果就绪后由它接管） */
  private buildWorkspaceRoots(context: common.UIAbilityContext): string {
    const sandbox: string = context.filesDir + '/' + 'workspace';
    const json: string = '['
      + '{"id":"sandbox","label":"沙箱","path":"' + escapeJson(sandbox) + '","permType":null},'
      + '{"id":"desktop","label":"桌面","path":"' + USER_HOME_DIR + '/Desktop","permType":"directory_desktop"},'
      + '{"id":"documents","label":"文档","path":"' + USER_HOME_DIR + '/Documents","permType":"directory_document"},'
      + '{"id":"download","label":"下载","path":"' + USER_HOME_DIR + '/Download","permType":"directory_download"}'
      + ']';
    return json;
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
      + '"node":{"state":"' + state + '","stage":"' + stage + '","bridgeVersion":"' + bridgeVersion + '"'
      + ',"pid":' + pid + ',"isRunning":' + (isRunning ? 'true' : 'false') + ',"lastError":"' + lastError + '"'
      + ',"logPath":"' + logPath + '","logs":' + logsJson + ',"lastCrash":' + crashJson + '}'
      + '}';
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

  private logsToText(runtime: NodeRuntime, count: number): string {
    try {
      const entries: NodeLogEntry[] = runtime.logs(count);
      let out: string = '';
      for (let i = 0; i < entries.length; i++) {
        out += entries[i].text + '\n';
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

  private fileExists(path: string): boolean {
    try {
      return fs.accessSync(path);
    } catch (e) {
      return false;
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

  /**
   * 物化库自带 Node 侧载荷三件（F4）：`bootstrap.js` + 同级 `host.js` + `lib/tar-extract.js`。
   *
   * 为什么必须做：库的 `payload/` **不在 HAR 里**（已知打包缺口），而 `bootstrap.js` 是交给库的
   * `scriptPath` —— 没有它 `node::Start` 跑的不是引导器 ⇒ 归档不会被解包、没有 uncaughtException
   * 兜底、也没有独立日志通道。失败**不吞**：抛给调用方，由路线判定把原因带进 decision（C2）。
   */
  private materializeBridge(context: common.UIAbilityContext, payloadRoot: string): string {
    this.ensureDir(payloadRoot);
    this.ensureDir(payloadRoot + '/lib');
    let bootstrap: string = '';
    for (let i = 0; i < BRIDGE_RAWFILES.length; i++) {
      const rawName: string = BRIDGE_RAWFILES[i];
      const dest: string = payloadRoot + '/' + rawName;
      this.materializeRawfile(context, rawName, dest);
      if (rawName === BRIDGE_BOOTSTRAP_FILE) {
        bootstrap = dest;
      }
    }
    if (bootstrap.length === 0 || !this.fileExists(bootstrap)) {
      throw new Error('库引导器未物化成功：' + payloadRoot + '/' + BRIDGE_BOOTSTRAP_FILE);
    }
    return bootstrap;
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
   * 归档 rawfile → 沙箱（**分块搬运**）。
   *
   * 为什么不能用 `Env.materializeRawfile`：它把整个 rawfile 一次读进内存
   * （`getRawFileContentSync`），150 MB 的归档会直接把应用内存顶穿。
   * 这里走 `getRawFdSync` + 4 MiB 分块 read/write：内存占用恒定，且**只做字节搬运** ——
   * 解包由 Node 自己做（谁写谁读，库契约 C3）。
   */
  private materializeRawArchive(context: common.UIAbilityContext, rawName: string, destPath: string): void {
    const chunkBytes: number = 4 * 1024 * 1024;
    const descriptor: resourceManager.RawFileDescriptor = context.resourceManager.getRawFdSync(rawName);
    const out: fs.File = fs.openSync(destPath,
      fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try {
      let written: number = 0;
      const total: number = descriptor.length;
      while (written < total) {
        const size: number = Math.min(chunkBytes, total - written);
        const buffer: ArrayBuffer = new ArrayBuffer(size);
        const read: number = fs.readSync(descriptor.fd, buffer, {
          offset: descriptor.offset + written,
          length: size
        });
        if (read <= 0) {
          break;
        }
        fs.writeSync(out.fd, buffer, { offset: written, length: read });
        written += read;
      }
      Log.info('归档已物化：' + destPath + '（' + written + ' / ' + total + ' B；由 Node 自己解包）');
      if (written !== total) {
        // 不静默：搬运不完整必须说出来（Node 侧的解包/校验会再报一次）
        throw new Error('归档搬运不完整：写入 ' + written + ' B，声明 ' + total + ' B');
      }
    } finally {
      fs.closeSync(out);
      try {
        context.resourceManager.closeRawFdSync(rawName);
      } catch (e) {
        Log.warn('closeRawFdSync 失败（不影响已写入的数据）：' + Ports.describe(e));
      }
    }
  }

  /** 读 `<rawfile>/pi-web.tar.gz.sha256` 的首个 64 位 hex（幂等键；读不到就留空由库自算） */
  private readArchiveSha256(context: common.UIAbilityContext): string {
    try {
      const data: Uint8Array = context.resourceManager.getRawFileContentSync(ARCHIVE_SHA256_RAWFILE);
      const text: string = this.utf8(data);
      const firstLine: string = text.split('\n')[0].trim().toLowerCase();
      if (this.isSha256(firstLine)) {
        return firstLine;
      }
      Log.warn('归档 sha256 旁文件首行不是 64 位 hex（忽略，交给库自算）：' + firstLine.substring(0, 80));
      return '';
    } catch (e) {
      Log.warn('未读到归档 sha256 旁文件（' + ARCHIVE_SHA256_RAWFILE + '）：交给库计算一次并落盘记下');
      return '';
    }
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

  private utf8(data: Uint8Array): string {
    try {
      const buf: buffer.Buffer = buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
      return buf.toString('utf-8');
    } catch (e) {
      Log.error('rawfile 解码失败：' + Ports.describe(e));
      return '';
    }
  }
}
