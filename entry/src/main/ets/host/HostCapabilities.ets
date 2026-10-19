import { abilityAccessCtrl, bundleManager, common, Permissions, Want } from '@kit.AbilityKit';
import { picker } from '@kit.CoreFileKit';
import { notificationManager } from '@kit.NotificationKit';
import { BusinessError } from '@kit.BasicServicesKit';
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
    'perm.request',
    'perm.openAppInfo',
    'fs.pickFiles',
    'fs.pickFolder',
    'shell.openExternal',
    'notify.show',
    'log.hilog'
  ];

  /**
   * 仍未实现的能力（都会返回结构化 not-implemented）。
   *
   * 2026-10-17：`perm.request` / `perm.openAppInfo`（E17/E19）与
   * `fs.pickFiles` / `fs.pickFolder` / `notify.show`（E20/E21）已全部移出本表。
   * 保留这个机制**本身**：将来新增的能力名先挂在这里如实返回 not-implemented，
   * 而不是注册一个空实现。
   */
  private static readonly DEFERRED: string[] = [];

  /**
   * 注册全部能力。返回人读摘要（同时写日志）：哪些是真实现、哪些是如实占位。
   * @param runtime 库的运行时单例（`runtime.host` 即宿主桥）
   * @param context UIAbilityContext（外链/深链需要它 `startAbility`；权限与选择器都需要 active context）
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

    /*
     * E17：对话框内主动弹授权窗（FR-203-017）。
     *
     * 这是**异步**能力（`requestPermissionsFromUser` 返回 Promise，且要等用户点按），
     * 所以只能走文件信箱的 `dispatchAsync`；原生槽位表那条同步路会如实报
     * `async-handler-on-sync-path`（库侧已实现该判据）。
     */
    host.register('perm.request', (argsJson: string): Promise<string> => {
      return HostCapabilities.requestPermissions(context, argsJson);
    });
    implemented.push('perm.request');

    // E19：权限归因的落地动作 —— 跳到本应用的「应用信息」页（用户在那里改授权）
    host.register('perm.openAppInfo', (argsJson: string): Promise<string> => {
      return HostCapabilities.openAppInfo(context, argsJson);
    });
    implemented.push('perm.openAppInfo');
    /*
     * E21：系统文件选择器（`fs.pickFolder` / `fs.pickFiles`）。
     *
     * 两者是同一个 API 的两种 `selectMode`，所以共用一份实现。
     * **异步且必须放宽超时**：等用户选目录的时间由用户决定 —— 库侧默认 15 s
     * 会"必然超时"（dshm 的原话是"这是必然发生的，不是概率问题"），
     * 调用方要传 `{ timeoutMs: 300000 }` 这类值。
     */
    host.register('fs.pickFolder', (argsJson: string): Promise<string> => {
      return HostCapabilities.pick(context, argsJson, true);
    });
    implemented.push('fs.pickFolder');

    host.register('fs.pickFiles', (argsJson: string): Promise<string> => {
      return HostCapabilities.pick(context, argsJson, false);
    });
    implemented.push('fs.pickFiles');

    /* E20：本地通知（`notificationManager.publish`） */
    host.register('notify.show', (argsJson: string): Promise<string> => {
      return HostCapabilities.notify(context, argsJson);
    });
    implemented.push('notify.show');
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
      // 【必须带引号】`escapeJson` 只转义、**不加**包裹引号：少了这一对引号，产出是
      // `"hostBridge":{"\"count\":8,…` —— 合法 JSON 的前缀 + 一个非法位置，
      // 而 `JSON.parse` 的报错位置（position 282）离真正的原因（缺引号）并不直观。
      // 这个缺陷一直休眠到 E18 的传输打通才暴露（此前永远走不到解析这一步）。
      + '"hostBridge":"' + escapeJson(runtime.host.stats()) + '",'
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
      // E19：**归因**与**下一步**。只报 granted 是不够的 —— 调用方需要知道
      // 「这个权限是干什么的、缺了会怎样、现在该点哪里」，否则用户只看到一句"没权限"。
      + '"attribution":"' + escapeJson(HostCapabilities.attribution(permission)) + '",'
      + '"nextStep":"' + HostCapabilities.nextStep(permission, granted) + '",'
      + '"hint":"真机已知假阴性：授予后仍可能报 false；判断能不能用请看真实读写结果（旧壳结论，规划 §5 第 9 条）"}';
  }

  /**
   * 权限 → **归因话术**（E19）。
   *
   * 只覆盖本工程真正会碰到的几个（`module.json5` 的 requestPermissions + 签名 profile 的 acls），
   * 其余给通用话术 —— 但**不编造**："不在已知清单里"本身就是一条有用的事实判断。
   */
  private static attribution(permission: string): string {
    if (permission === 'ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY') {
      return '「下载」目录读写：本版**已撤掉该声明**（user_grant，但撤销后即可零弹窗）'
        + ' ⇒ 下载目录不再作为工作区根；外部文件请用 fs.pickFolder 选择器（URI、仅本会话）';
    }
    if (permission === 'ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY') {
      return '「文档」目录读写：本版**已撤掉该声明**（同上）⇒ 文档目录不再作为工作区根';
    }
    if (permission === 'ohos.permission.READ_WRITE_DESKTOP_DIRECTORY') {
      return '「桌面」目录读写：本版**已撤掉该声明**（system_basic + 必须 ACL，普通应用弹窗无效）'
        + ' ⇒ 桌面目录不再作为工作区根';
    }
    if (permission === 'ohos.permission.FILE_ACCESS_PERSIST') {
      return '持久化选择器授权：本版**已撤掉该声明** ⇒ `fileShare.persistPermission` 不再调用，'
        + '选择器返回的 URI 只在**本次会话**有效（重启后需重选）';
    }
    if (permission === 'ohos.permission.INTERNET') {
      return '访问网络：调模型 API 用；本工程的 Host 走 loopback，不授予不影响本机对话';
    }
    return '该权限不在本工程的已知清单里：请确认它已在 module.json5 的 requestPermissions 或签名 profile 的 acls 中声明';
  }

  /**
   * 权限 → **下一步动作**（E19）。`granted` 时返回 `none`。
   *
   * 判定依据是「能不能靠用户点一下就解决」：
   *   · user_grant（文档 / 下载 / 持久化授权）⇒ 先 `perm.request` 弹窗，被拒后 `perm.openAppInfo`；
   *   · 已撤掉声明的权限（桌面 / 文档 / 下载 / 持久化 / 剪贴板）⇒ 没有下一步，如实回 `none`
   *     （别把用户引到注定失败的弹窗上）。
   */
  private static nextStep(permission: string, granted: boolean): string {
    if (granted) {
      return 'none';
    }
    if (permission === 'ohos.permission.READ_WRITE_DESKTOP_DIRECTORY'
      || permission === 'ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY'
      || permission === 'ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY'
      || permission === 'ohos.permission.FILE_ACCESS_PERSIST'
      || permission === 'ohos.permission.READ_PASTEBOARD') {
      // 本版未声明这些权限（用户目录 / 持久化 / 剪贴板）：任何引导都不会生效。
      return 'none';
    }
    return 'perm.request';
  }

  /**
   * E17：**对话框内主动弹授权窗**（`FR-203-017`）。
   *
   * 为什么必须"主动申请"：`checkAccessTokenSync` 只读当前状态；user_grant 类权限若从不申请，
   * 调用方永远看到 `granted:false`，而用户也不知道该去哪儿点 —— 这正是 hos 自己也没通过的那条。
   *
   * 参数（`permissions` 优先，`name` 作为单值简写）：
   *   `{ "permissions": ["ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY"] }`
   *   `{ "name": "ohos.permission.…" }`
   *
   * 返回逐项 `authResult`（0 = 已授予，-1 = 拒绝）：**逐项上报**，不聚合成一个布尔 ——
   * 一次申请多个权限时，"部分授予"才是常见形态。
   */
  private static async requestPermissions(context: common.UIAbilityContext, argsJson: string): Promise<string> {
    const list: string[] = HostCapabilities.stringArrayField(argsJson, 'permissions');
    if (list.length === 0) {
      const single: string = HostCapabilities.stringField(argsJson, 'name');
      if (single.length > 0) {
        list.push(single);
      }
    }
    if (list.length === 0) {
      return '{"ok":false,"capability":"perm.request","error":"bad-args",'
        + '"detail":"需要 permissions 数组或 name 字段"}';
    }
    // 权限名来自能力参数（动态字符串）：协议要求 Permissions 字面量联合，这里显式断言；
    // 非法名字由 API 自己报错并落在 request-failed 里 —— 不预判、不吞错。
    const typed: Permissions[] = [];
    for (const p of list) {
      typed.push(p as Permissions);
    }
    try {
      const manager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
      const result = await manager.requestPermissionsFromUser(context, typed);
      let grantedCount: number = 0;
      let deniedCount: number = 0;
      const rows: string[] = [];
      for (let i = 0; i < result.permissions.length; i++) {
        const code: number = i < result.authResults.length ? result.authResults[i] : -1;
        const ok: boolean = code === 0;
        if (ok) {
          grantedCount = grantedCount + 1;
        } else {
          deniedCount = deniedCount + 1;
        }
        rows.push('{"permission":"' + escapeJson(result.permissions[i]) + '","authResult":' + code
          + ',"granted":' + (ok ? 'true' : 'false') + '}');
      }
      Log.info('perm.request：申请 ' + list.length + ' 项，授予 ' + grantedCount + '，拒绝 ' + deniedCount);
      return '{"ok":true,"capability":"perm.request","requested":' + list.length
        + ',"granted":' + grantedCount + ',"denied":' + deniedCount
        + ',"results":[' + rows.join(',') + ']'
        + ',"nextStep":"' + (deniedCount > 0 ? 'perm.openAppInfo（被拒后改授权只能去系统设置）' : 'none') + '"}';
    } catch (e) {
      const err = e as BusinessError;
      const code: number = typeof err.code === 'number' ? err.code : -1;
      const message: string = typeof err.message === 'string' ? err.message : HostCapabilities.describe(e);
      Log.error('perm.request 失败：' + code + '｜' + message);
      return '{"ok":false,"capability":"perm.request","error":"request-failed","code":' + code
        + ',"detail":"' + escapeJson(message) + '"}';
    }
  }

  /**
   * E19：跳到本应用的「应用信息」页（权限归因的落地动作）。
   *
   * 为什么不是 `openApplicationInfoEntry`：**本 SDK 没有这个 API**（实测 `ets/api/` 全量检索无命中）。
   * 系统设置页的公开入口是 want 的 action `ohos.settings.application.details`
   * （`@ohos.ability.wantConstant` 的 `Action.ACTION_APPLICATION_DETAILS_SETTINGS` 同值）。
   * 目标 bundle 是设置应用；`parameters` 里同时给 `bundleName` 与 `pushParams` 两种键 ——
   * 不同版本设置应用取的是不同的键，两个都给才不至于"打开设置但停在首页"。
   */
  private static async openAppInfo(context: common.UIAbilityContext, argsJson: string): Promise<string> {
    let self: string = '';
    try {
      const info: bundleManager.BundleInfo = bundleManager.getBundleInfoForSelfSync(
        bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      self = info.name;
    } catch (e) {
      return '{"ok":false,"capability":"perm.openAppInfo","error":"bundle-info-unavailable",'
        + '"detail":"' + escapeJson(HostCapabilities.describe(e)) + '"}';
    }
    if (self.length === 0) {
      return '{"ok":false,"capability":"perm.openAppInfo","error":"bundle-info-unavailable",'
        + '"detail":"getBundleInfoForSelfSync 返回的 name 为空"}';
    }
    const params: Record<string, Object> = {
      'bundleName': self,
      'pushParams': self
    };
    const want: Want = {
      bundleName: 'com.huawei.hmos.settings',
      abilityName: 'com.huawei.hmos.settings.MainAbility',
      action: 'ohos.settings.application.details',
      parameters: params
    };
    try {
      await context.startAbility(want);
      return '{"ok":true,"capability":"perm.openAppInfo","bundleName":"' + escapeJson(self) + '",'
        + '"target":"system-settings","action":"ohos.settings.application.details"}';
    } catch (e) {
      const err = e as BusinessError;
      const code: number = typeof err.code === 'number' ? err.code : -1;
      const message: string = typeof err.message === 'string' ? err.message : HostCapabilities.describe(e);
      Log.warn('perm.openAppInfo 失败：' + code + '｜' + message);
      return '{"ok":false,"capability":"perm.openAppInfo","error":"deep-link-failed","code":' + code
        + ',"detail":"' + escapeJson(message) + '"'
        + ',"hint":"没有可用深链时，请让用户手动打开「设置 → 应用和元服务 → Pi Desktop → 权限」"}';
    }
  }


  /**
   * E21：系统文件选择器（`fs.pickFolder` / `fs.pickFiles` 共用）。
   *
   * 三个必须写死的判据：
   *   ① **返回 URI，不是路径**。picker 给的是 `file://…`，ArkTS 侧可直接 `fileIo` 打开；
   *      Node 侧的 `node:fs` 不认 URI，需要经 `/api/cwd` 或转换 —— 这一点必须回给调用方，
   *      否则调用方会拿 URI 当路径去 stat，然后得到"文件不存在"的假象。
   *   ② **用户取消不是错误，但必须显式区分**（`cancelled`）：返回空数组会让调用方以为
   *      "选到了空目录"，而真正的失败又被吞掉 —— 两者必须能分开。
   *   ③ **不做持久化**：本版不申请 `ohos.permission.FILE_ACCESS_PERSIST`（见
   *      docs/ACL-无ACL评估.md）⇒ 不调用 `fileShare.persistPermission`，URI 授权只在
   *      **本次会话**有效，重启后失效。返回 `persisted:false` + 原因，不假装持久化成功。
   */
  private static async pick(context: common.UIAbilityContext, argsJson: string, folder: boolean): Promise<string> {
    const capability: string = folder ? 'fs.pickFolder' : 'fs.pickFiles';
    try {
      const options: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
      options.selectMode = folder ? picker.DocumentSelectMode.FOLDER : picker.DocumentSelectMode.FILE;
      options.maxSelectNumber = folder ? 1 : 32;
      const view: picker.DocumentViewPicker = new picker.DocumentViewPicker(context);
      const uris: string[] = await view.select(options);
      if (uris === undefined || uris.length === 0) {
        return '{"ok":false,"capability":"' + capability + '","error":"cancelled",'
          + '"detail":"用户取消或未选择任何项（不是失败，调用方不应重试）"}';
      }
      const rows: string[] = [];
      for (const u of uris) {
        rows.push('"' + escapeJson(u) + '"');
      }
      return '{"ok":true,"capability":"' + capability + '","count":' + uris.length
        + ',"uris":[' + rows.join(',') + ']'
        + ',"persisted":false'
        + ',"persistReason":"本版不申请 ohos.permission.FILE_ACCESS_PERSIST（见 docs/ACL-无ACL评估.md）'
        + '⇒ 未调用 fileShare.persistPermission；URI 授权只在本次会话有效"'
        + ',"kind":"uri","hint":"返回的是 URI（file://…），不是文件系统路径：ArkTS 侧可直接 fileIo 打开；'
        + 'Node 侧 node:fs 不认 URI，需先转成路径"}';
    } catch (e) {
      const err = e as BusinessError;
      const code: number = typeof err.code === 'number' ? err.code : -1;
      const message: string = typeof err.message === 'string' ? err.message : HostCapabilities.describe(e);
      Log.error(capability + ' 失败：' + code + '｜' + message);
      return '{"ok":false,"capability":"' + capability + '","error":"pick-failed","code":' + code
        + ',"detail":"' + escapeJson(message) + '"}';
    }
  }

  /**
   * E20：发一条本地通知（`notificationManager.publish`）。
   *
   * 参数：`{ "title": "…", "text": "…", "id": 1001 }`（`id` 可选，缺省按时间取）。
   * `text` 为空按 `bad-args` 拒绝 —— 一条没有正文的通知对用户毫无意义。
   *
   * 为什么不做 `requestEnableNotification`：那会**再弹一次系统窗**，属于用户设置面；
   * 首次 publish 失败时把错误码原样回给调用方（11800001 一类通常就表示通知总开关没开），
   * 由调用方决定是否引导用户去设置。
   */
  private static async notify(context: common.UIAbilityContext, argsJson: string): Promise<string> {
    const title: string = HostCapabilities.stringField(argsJson, 'title');
    const text: string = HostCapabilities.stringField(argsJson, 'text');
    if (text.length === 0) {
      return '{"ok":false,"capability":"notify.show","error":"bad-args",'
        + '"detail":"需要非空的 text 字段（title 可缺省）"}';
    }
    const idRaw: string = HostCapabilities.stringField(argsJson, 'id');
    const parsedId: number = idRaw.length > 0 ? Number(idRaw) : NaN;
    const id: number = Number.isFinite(parsedId) ? Math.trunc(parsedId) : (Date.now() % 100000000);
    const content: notificationManager.NotificationBasicContent = {
      title: title.length > 0 ? title : 'Pi Desktop',
      text: text
    };
    const request: notificationManager.NotificationRequest = {
      id: id,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: content
      }
    };
    try {
      await notificationManager.publish(request);
      Log.info('notify.show 已发布：id=' + id + ' len=' + text.length);
      return '{"ok":true,"capability":"notify.show","id":' + id + ',"published":true}';
    } catch (e) {
      const err = e as BusinessError;
      const code: number = typeof err.code === 'number' ? err.code : -1;
      const message: string = typeof err.message === 'string' ? err.message : HostCapabilities.describe(e);
      Log.warn('notify.show 失败：' + code + '｜' + message);
      return '{"ok":false,"capability":"notify.show","error":"publish-failed","code":' + code
        + ',"detail":"' + escapeJson(message) + '"'
        + ',"hint":"1600004/11800001 一类通常是通知总开关或该应用的通知被关闭 —— 需要在系统设置里打开"}';
    }
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
  /**
   * 从 JSON 里取一个**字符串数组**字段（`{"permissions":["a","b"]}`）。
   *
   * 为什么手写而不用 `JSON.parse`：本文件其余字段读取都是手写的 `stringField`（不引入
   * 类型断言与 any）。这里保持同一风格，但**只做最小解析**：找到键、跳到 `[`、
   * 逐个取引号内文本。畸形输入返回空数组 —— 由调用方按 `bad-args` 拒绝，不猜。
   */
  static stringArrayField(json: string, key: string): string[] {
    const out: string[] = [];
    if (json.length === 0) {
      return out;
    }
    const keyAt: number = json.indexOf('"' + key + '"');
    if (keyAt < 0) {
      return out;
    }
    let i: number = json.indexOf('[', keyAt);
    if (i < 0) {
      return out;
    }
    i++;
    while (i < json.length) {
      const ch: string = json.charAt(i);
      if (ch === ']') {
        break;
      }
      if (ch !== '"') {
        i++;
        continue;
      }
      let j: number = i + 1;
      let text: string = '';
      while (j < json.length) {
        const c: string = json.charAt(j);
        if (c === '\\' && j + 1 < json.length) {
          // 只支持 JSON 必需的几个转义；遇到其它序列原样保留（权限名里不会有）
          const next: string = json.charAt(j + 1);
          if (next === '"' || next === '\\' || next === '/') {
            text += next;
            j += 2;
            continue;
          }
          text += c;
          j++;
          continue;
        }
        if (c === '"') {
          break;
        }
        text += c;
        j++;
      }
      if (text.length > 0) {
        out.push(text);
      }
      i = j + 1;
    }
    return out;
  }

  /** 异常 → 一行可读文本（`BusinessError` 带 code 时一并带上；自身绝不抛） */
  static describe(e: Object): string {
    try {
      const err = e as BusinessError;
      const code: string = typeof err.code === 'number' ? String(err.code) : '';
      const message: string = typeof err.message === 'string' && err.message.length > 0
        ? err.message
        : JSON.stringify(e);
      return code.length > 0 ? (code + '｜' + message) : message;
    } catch (ignored) {
      return '(unserializable thrown value)';
    }
  }

  /** 从 JSON 里取一个**字符串**字段（畸形/缺失都返回空串，绝不抛） */
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
