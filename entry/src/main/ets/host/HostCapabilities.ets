import { abilityAccessCtrl, bundleManager, common, Permissions, Want } from '@kit.AbilityKit';
import { NodeLogEntry, NodeRuntime } from '@fellow99/node-bridge';
import { CAP_TERMINAL_EVIDENCE, CAP_TERMINAL_REASON, CAP_TERMINAL_SUPPORTED, Log, escapeJson } from '../common/Constants';

/**
 * HostCapabilities —— **宿主能力桥的 ArkTS 侧实现**（工程规划 §5 第 8/9/10 条）。
 *
 * 分工（库契约 §2.7 / §6.1）：库只提供「寄存器 + 传输」，**每个能力的实现属消费方**。
 * 因此这里做的事就是把能力名逐个 `register()` 上去，并让**每个**调用都返回结构化 JSON。
 *
 * 三条纪律：
 *   ① 能力名必须用契约里冻结的字符串（`runtime.facts` / `perm.check` / …）；
 *   ② **不注册**的能力会在 Node 侧得到 `{"ok":false,"error":"unregistered"}` —— 那是对的；
 *      但「注册了却假装能用」更糟，所以 Phase 1 未实现的能力**注册并如实返回 not-implemented**
 *      （C2 不隐藏平台真相：让调用方拿到「为什么不行 + 下一阶段在哪」而不是空值）；
 *   ③ 绝不调用**未注册**的宿主函数 —— 旧壳 `ExternalWeb.Open` 就是这么把应用打崩的（R15）。
 *
 * ⚠️ Phase 1 的**传输层**尚不可用（库契约 §3.5：Node 侧 `invoke()` 一律 reject
 * `transport-unavailable`）。也就是说：这些处理器是**为 Phase 2 预置的注册面**，
 * 现在**不会**被 Node 调用（Node 侧本来也拿不到回值）。这一点在日志里明说，不假装已通。
 */
export class HostCapabilities {
  /** 能力清单（**冻结命名**，契约 §2.7）。顺序即注册顺序，便于日志比对。 */
  static readonly NAMES: string[] = [
    'runtime.facts',
    'perm.check',
    'perm.openAppInfo',
    'fs.pickFiles',
    'fs.pickFolder',
    'shell.openExternal',
    'notify.show',
    'log.hilog'
  ];

  /** Phase 1 只注册但**未实现**的能力（都会返回结构化 not-implemented） */
  private static readonly DEFERRED: string[] = ['perm.openAppInfo', 'fs.pickFiles', 'fs.pickFolder', 'notify.show'];

  /**
   * 注册全部能力。返回人读摘要（同时写日志）：哪些是真实现、哪些是如实占位。
   * @param runtime 库的运行时单例（`runtime.host` 即宿主桥）
   * @param context UIAbilityContext（外链需要它 `startAbility`；权限检查需要 token）
   */
  static install(runtime: NodeRuntime, context: common.UIAbilityContext): string {
    const host = runtime.host;
    const implemented: string[] = [];
    const deferred: string[] = [];

    host.register('runtime.facts', (argsJson: string): string => {
      return HostCapabilities.runtimeFacts(runtime, argsJson);
    });
    implemented.push('runtime.facts');

    host.register('perm.check', (argsJson: string): string => {
      return HostCapabilities.permCheck(context, argsJson);
    });
    implemented.push('perm.check');

    host.register('shell.openExternal', (argsJson: string): string => {
      return HostCapabilities.openExternal(context, HostCapabilities.stringField(argsJson, 'url'));
    });
    implemented.push('shell.openExternal');

    host.register('log.hilog', (argsJson: string): string => {
      const message: string = HostCapabilities.stringField(argsJson, 'message');
      const level: string = HostCapabilities.stringField(argsJson, 'level');
      HostCapabilities.writeLog(level, message);
      return '{"ok":true,"capability":"log.hilog","wrote":true,"level":"' + escapeJson(level) + '"}';
    });
    implemented.push('log.hilog');

    for (const name of HostCapabilities.DEFERRED) {
      host.register(name, (argsJson: string): string => {
        return HostCapabilities.notImplemented(name, argsJson);
      });
      deferred.push(name);
    }

    const missing: string[] = [];
    for (const name of HostCapabilities.NAMES) {
      if (!host.has(name)) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      // 注册面不完整 = 我们自己的 bug，必须吼出来（Node 侧会看到 unregistered）
      Log.error('宿主能力注册不完整，缺：' + missing.join(', '));
    }
    const summary: string = '宿主能力已注册 ' + host.list().length + '/' + HostCapabilities.NAMES.length
      + '；已实现：' + implemented.join(', ')
      + '；Phase 1 占位（返回 not-implemented）：' + deferred.join(', ')
      + '；传输层在 Phase 1 为 transport-unavailable（本注册面为 Phase 2 预置，Node 侧当前拿不到回值）';
    Log.info(summary);
    return summary;
  }

  /**
   * 平台能力事实的**唯一序列化点**（P2）。UI / 诊断串 / `runtime.facts` 都读这里。
   *
   * 为什么必须这么写：`/api/terminal` 现在的失败是
   * 「Cannot load the node-pty native terminal module for openharmony-arm64」——
   * 那被记成**加载错误**，而事实是**平台没有 PTY**（无 devpts、无 /dev/pts/N）。
   * 能力缺失必须以能力标志出现，而不是以异常出现；本方法就是那份标志。
   * **不伪造支持**：`supported:false` 是硬编码事实，不给任何「也许能用」的余地。
   */
  static capabilitiesJson(): string {
    return '{"terminal":{'
      + '"capability":"terminal.pty",'
      + '"supported":' + (CAP_TERMINAL_SUPPORTED ? 'true' : 'false') + ','
      + '"reason":"' + escapeJson(CAP_TERMINAL_REASON) + '",'
      + '"evidence":"' + escapeJson(CAP_TERMINAL_EVIDENCE) + '",'
      + '"plan":"§4.4 平台无 PTY；不实现伪终端，终端面板按 unsupported 降级"'
      + '}}';
  }

  /** `runtime.facts`：本进程的运行事实（诊断面板与 Node 侧都能读） */
  private static runtimeFacts(runtime: NodeRuntime, argsJson: string): string {
    let logs: number = -1;
    try {
      const entries: NodeLogEntry[] = runtime.logs(20);
      logs = entries.length;
    } catch (e) {
      logs = -1;
    }
    const json: string = '{'
      + '"ok":true,'
      + '"capability":"runtime.facts",'
      + '"state":"' + escapeJson(runtime.getState() as string) + '",'
      + '"stage":"' + escapeJson(runtime.getStage()) + '",'
      + '"bridgeVersion":"' + escapeJson(runtime.bridgeVersion()) + '",'
      + '"isRunning":' + (runtime.isRunning() ? 'true' : 'false') + ','
      + '"pid":' + runtime.getPid() + ','
      + '"logPath":"' + escapeJson(runtime.getLogPath()) + '",'
      + '"lastError":"' + escapeJson(runtime.getLastError()) + '",'
      + '"logEntries":' + logs + ','
      + '"hostBridge":' + escapeJson(runtime.host.stats()) + ','
      + '"args":"' + escapeJson(argsJson) + '",'
      + '"capabilities":' + HostCapabilities.capabilitiesJson()
      + '}';
    return json;
  }

  /**
   * `perm.check`：权限预检（对齐旧壳的 `systemPreferences.checkPermission`）。
   *
   * ⚠️ 真机已知偏差（旧壳证据，工程规划 §5 第 9 条）：授予权限后 `checkPermission`
   * 仍可能返回 **false（假阴性）**。因此返回值里带 `hint`，让调用方知道「false 不等于不能用」。
   */
  private static permCheck(context: common.UIAbilityContext, argsJson: string): string {
    const permission: string = HostCapabilities.stringField(argsJson, 'name');
    if (permission.length === 0) {
      return '{"ok":false,"capability":"perm.check","error":"bad-args","detail":"缺少 name 字段"}';
    }
    let granted: boolean = false;
    let detail: string = '';
    try {
      const info: bundleManager.BundleInfo = bundleManager.getBundleInfoForSelfSync(
        bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
      const tokenId: number = info.appInfo.accessTokenId;
      const manager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
      // 权限名来自能力参数（动态字符串）：这里做一次**显式断言**（协议要求 Permissions 字面量联合），
      // 非法名字由 API 自己报错并被 catch 成结构化 detail —— 不预判、不吞错。
      const status: abilityAccessCtrl.GrantStatus = manager.checkAccessTokenSync(
        tokenId, permission as Permissions);
      granted = status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
      detail = 'checkAccessTokenSync 返回 ' + status
        + '（' + (granted ? 'PERMISSION_GRANTED' : '未授予') + '）';
    } catch (e) {
      detail = '权限查询失败：' + JSON.stringify(e);
      Log.error('perm.check 失败：' + detail);
    }
    return '{"ok":true,"capability":"perm.check","permission":"' + escapeJson(permission) + '",'
      + '"granted":' + (granted ? 'true' : 'false') + ','
      + '"detail":"' + escapeJson(detail) + '",'
      + '"hint":"真机已知假阴性：授予后仍可能报 false；判断能不能用请看真实读写结果（旧壳结论，规划 §5 第 9 条）"}';
  }

  /**
   * `shell.openExternal`：外部链接**交给系统浏览器**（规划 §5 第 8 条的落点）。
   *
   * ⚠️ 纪律：只用 `startAbility(viewData)`（系统层解析，找不到处理器时**抛错被我们接住**），
   * 绝不调用未注册的 ArkTS 函数（旧壳 `ExternalWeb.Open` = 调用即 SIGSEGV，R15）。
   */
  static openExternal(context: common.UIAbilityContext, url: string): string {
    if (url.length === 0) {
      return '{"ok":false,"capability":"shell.openExternal","error":"bad-args","detail":"缺少 url"}';
    }
    if (!(url.startsWith('http://') || url.startsWith('https://'))) {
      // 只放行 http(s)：其它 scheme 交系统解析等于把控制权交出去
      Log.warn('外链被拒（非 http(s)）：' + url);
      return '{"ok":false,"capability":"shell.openExternal","error":"scheme-not-allowed","url":"'
        + escapeJson(url) + '"}';
    }
    const want: Want = {
      action: 'ohos.want.action.viewData',
      uri: url,
      entities: ['entity.system.browsable']
    };
    try {
      context.startAbility(want).then(() => {
        Log.info('外链已交系统浏览器：' + url);
      }).catch((err: Object) => {
        // 失败可见：没有能处理该 want 的应用时如实记日志（不静默）
        Log.error('外链打开失败（可能没有浏览器可处理 viewData）：' + url + '｜' + JSON.stringify(err));
      });
      return '{"ok":true,"capability":"shell.openExternal","url":"' + escapeJson(url) + '","mode":"system-browser"}';
    } catch (e) {
      Log.error('startAbility(viewData) 抛错：' + JSON.stringify(e));
      return '{"ok":false,"capability":"shell.openExternal","error":"start-ability-threw","url":"'
        + escapeJson(url) + '","detail":"' + escapeJson(JSON.stringify(e)) + '"}';
    }
  }

  /** 未实现能力的统一答复（**结构化 + 原因 + 阶段**，绝不返回空值） */
  private static notImplemented(name: string, argsJson: string): string {
    let hint: string = 'Phase 2 实现';
    if (name === 'fs.pickFiles' || name === 'fs.pickFolder') {
      hint = 'Phase 2：待 ArkTS 选择器（工程规划 §5 第 10 条 / O8）接上；当前不提供任何「假装选过了」的返回';
    } else if (name === 'perm.openAppInfo') {
      hint = 'Phase 2：去系统设置页的 Want 需真机验证后再接线（规划 §5 第 9 条）';
    } else if (name === 'notify.show') {
      hint = 'v1 不做通知/状态栏（工程规划 §5 第 15 条）';
    }
    Log.warn('能力 ' + name + ' 被调用但未实现：' + hint);
    return '{"ok":false,"capability":"' + escapeJson(name) + '","error":"not-implemented","hint":"'
      + escapeJson(hint) + '","args":"' + escapeJson(argsJson) + '"}';
  }

  private static writeLog(level: string, message: string): void {
    const text: string = '[payload] ' + message;
    if (level === 'error') {
      Log.error(text);
    } else if (level === 'warn') {
      Log.warn(text);
    } else {
      Log.info(text);
    }
  }

  /**
   * 从能力参数 JSON 里取字符串字段。
   *
   * 为什么手写而不用 `JSON.parse(...) as Record<string, string>`：能力参数是**外部输入**
   * （Node 侧拼出来的），解析失败必须退化成「字段为空」，而不是把异常抛进宿主桥。
   * 这里只支持字符串值（v1 的能力参数都是字符串或数字），取不到就返回空串。
   */
  static stringField(json: string, key: string): string {
    if (json.length === 0) {
      return '';
    }
    const needle: string = '"' + key + '"';
    const keyAt: number = json.indexOf(needle);
    if (keyAt < 0) {
      return '';
    }
    let i: number = keyAt + needle.length;
    while (i < json.length) {
      const ch: string = json.charAt(i);
      if (ch === ':' || ch === ' ' || ch === '\t' || ch === '\n') {
        i++;
        continue;
      }
      break;
    }
    if (i >= json.length || json.charAt(i) !== '"') {
      return '';
    }
    i++;
    let out: string = '';
    while (i < json.length) {
      const ch: string = json.charAt(i);
      if (ch === '\\') {
        const next: string = i + 1 < json.length ? json.charAt(i + 1) : '';
        if (next === 'n') {
          out += '\n';
        } else if (next === 't') {
          out += '\t';
        } else {
          out += next;
        }
        i += 2;
        continue;
      }
      if (ch === '"') {
        break;
      }
      out += ch;
      i++;
    }
    return out;
  }
}
