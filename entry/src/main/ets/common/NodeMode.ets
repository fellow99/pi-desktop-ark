import { abilityAccessCtrl, bundleManager, common, Permissions } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { Log } from './Constants';

/**
 * 108-jitless：**Node 运行形态判定**（jit / compat）。
 *
 * 为什么需要它：无 ACL（`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 未授予）时，
 * V8 只能以 `--jitless` 运行 ⇒ `WebAssembly` 整个对象不存在 ⇒ 载荷里凡依赖 WASM 的模块
 * （Next 的 SWC、undici 的 llhttp、photon）全部失效，**当前形态是启动即崩**（约 0.5 s 后 SIGABRT），
 * 不是"变慢"。反向也成立：有 ACL 却带 `--jitless` 会白白损失 7–10× 性能。
 * 因此形态必须**按设备事实**决定，而不是写死一个默认值。
 *
 * 判定顺序（首个命中为准，见 `specs/108-jitless/spec.md` FR-108-001）：
 *   ① `probeFlags`（仅 debug，直接给整串 flags ⇒ 绕过本判定，由 `EntryAbility` 处理）
 *   ② want 参数 `piNodeMode`（仅 debug；`jit` / `compat` / `auto`）
 *   ③ 持久设置 `preferences('pi-settings').nodeMode`（默认 `auto`）
 *   ④ `auto` ⇒ 权限探测：已授予 ⇒ jit；未授予/查询失败 ⇒ compat（宁慢不崩）
 *
 * 纪律：本文件**不引 UI、不写全局状态**（只用 `Log` 打事实），因此可以脱离页面推演。
 */

/** 形态常量（与 `specs/108-jitless/spec.md` §2 术语一致） */
export const NODE_MODE_AUTO: string = 'auto';
export const NODE_MODE_JIT: string = 'jit';
export const NODE_MODE_COMPAT: string = 'compat';

/** 交给库的 Node 参数（`--jitless` 由本模块按形态追加；库保证 flags 全部排在脚本路径之前） */
const BASE_FLAGS: string = '--no-verify-heap';
const JITLESS_FLAG: string = '--jitless';

/** 调试 want 参数名（仅 debug 构建生效，见合规 G9） */
const PARAM_NODE_MODE: string = 'piNodeMode';
/** 持久设置：偏好文件名与键名（应用内切换入口写入它） */
const PREF_NAME: string = 'pi-settings';
const PREF_KEY_NODE_MODE: string = 'nodeMode';
/** JIT 所需的 ACL（`system_basic` + `provisionEnable`，见 module.json5 与 docs/ACL配置.md） */
const ACL_WRITABLE_CODE_MEMORY: string = 'ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY';

/** 权限探测读数（ArkTS 不接受匿名结构体） */
export class AclProbe {
  readonly granted: boolean;
  readonly detail: string;

  constructor(granted: boolean, detail: string) {
    this.granted = granted;
    this.detail = detail;
  }
}

/** 形态判定结果（含**依据**：只报形态不报依据，出问题时无法归因） */
export class NodeModeDecision {
  readonly mode: string;
  readonly reason: string;

  constructor(mode: string, reason: string) {
    this.mode = mode;
    this.reason = reason;
  }

  isCompat(): boolean {
    return this.mode === NODE_MODE_COMPAT;
  }

  /** 实际交给库的 flags 串 */
  flags(): string {
    return this.isCompat() ? BASE_FLAGS + ' ' + JITLESS_FLAG : BASE_FLAGS;
  }

  /** 一行可读事实（hilog / 诊断串共用） */
  describe(): string {
    return 'mode=' + this.mode + '（依据：' + this.reason + '）';
  }
}

/**
 * 探测 JIT 所需的 ACL 当前是否被授予。
 *
 * 为什么用 `checkAccessTokenSync` 而不是 `requestPermissionsFromUser`：ACL 是**签名 Profile**
 * 授予的系统级权限（`system_basic`），运行时申请不会弹窗也不会通过；我们只需要知道"现在有没有"。
 * 查询失败（无 bundleManager 权限、API 变更）⇒ 按**未授予**处理：compat 形态只是慢，
 * jit 形态在无 ACL 设备上是**必崩**，两害相权只能选慢。
 */
export function probeJitAcl(): AclProbe {
  try {
    const info: bundleManager.BundleInfo = bundleManager.getBundleInfoForSelfSync(
      bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
    const tokenId: number = info.appInfo.accessTokenId;
    const manager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
    // 权限名是常量，但 API 要求 `Permissions` 字面量联合 ⇒ 显式断言（与 HostCapabilities#permCheck 同口径）
    const status: abilityAccessCtrl.GrantStatus =
      manager.checkAccessTokenSync(tokenId, ACL_WRITABLE_CODE_MEMORY as Permissions);
    const granted: boolean = status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    return new AclProbe(granted, ACL_WRITABLE_CODE_MEMORY + ' → ' + status
      + (granted ? '（PERMISSION_GRANTED）' : '（未授予）'));
  } catch (e) {
    const detail: string = '权限查询失败：' + JSON.stringify(e);
    Log.warn('NodeMode：ACL 探测异常，按 compat（宁慢不崩）处理｜' + detail);
    return new AclProbe(false, detail);
  }
}

/** 读取持久设置里的形态偏好（读不到 / 非法值 ⇒ `auto`，不阻断启动） */
export function readPreferredMode(context: common.UIAbilityContext): string {
  try {
    const store: preferences.Preferences = preferences.getPreferencesSync(context, { name: PREF_NAME });
    const raw: preferences.ValueType = store.getSync(PREF_KEY_NODE_MODE, NODE_MODE_AUTO);
    const value: string = typeof raw === 'string' ? raw as string : NODE_MODE_AUTO;
    if (value === NODE_MODE_JIT || value === NODE_MODE_COMPAT || value === NODE_MODE_AUTO) {
      return value;
    }
    Log.warn('NodeMode：偏好设置 nodeMode=' + value + ' 非法，按 auto 处理');
    return NODE_MODE_AUTO;
  } catch (e) {
    Log.info('NodeMode：读取偏好设置失败（按 auto 处理）：' + JSON.stringify(e));
    return NODE_MODE_AUTO;
  }
}

/** 从 want 参数里取调试形态覆盖（只认三个合法值；其余忽略并留痕） */
function modeFromWant(params: Record<string, Object> | undefined): string {
  if (params === undefined) {
    return '';
  }
  const raw: Object | undefined = params[PARAM_NODE_MODE];
  if (raw === undefined) {
    return '';
  }
  const value: string = String(raw);
  if (value === NODE_MODE_JIT || value === NODE_MODE_COMPAT || value === NODE_MODE_AUTO) {
    return value;
  }
  Log.warn('NodeMode：want 参数 ' + PARAM_NODE_MODE + '=' + value + ' 非法（只认 jit/compat/auto），已忽略');
  return '';
}

/**
 * 解析本次启动形态。
 *
 * @param context UIAbilityContext（读偏好设置、探测 ACL）
 * @param debugBuild `applicationInfo.debug`（release 一律忽略调试通道，合规 G9）
 * @param wantParams want.parameters（可能为 undefined）
 */
export function resolve(context: common.UIAbilityContext,
  debugBuild: boolean, wantParams: Record<string, Object> | undefined): NodeModeDecision {
  if (debugBuild) {
    const fromWant: string = modeFromWant(wantParams);
    if (fromWant.length > 0 && fromWant !== NODE_MODE_AUTO) {
      return new NodeModeDecision(fromWant, '调试参数 ' + PARAM_NODE_MODE + '=' + fromWant);
    }
  }

  const preferred: string = readPreferredMode(context);
  if (preferred !== NODE_MODE_AUTO) {
    return new NodeModeDecision(preferred, '偏好设置 ' + PREF_NAME + '.' + PREF_KEY_NODE_MODE
      + '=' + preferred);
  }

  const probe: AclProbe = probeJitAcl();
  /*
   * 2026-10-20 手机真机（`JUY-AL80` / API 26）实测：**权限位授予 ≠ 内核真允许 JIT** ——
   * 该机 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 查询为已授予，但按 jit 启动后
   * 进程在 `libnode_bridge` 里 **SIGTRAP(TRAP_BRKPT)** 秒崩（同一 HAP 改 compat 则可正常就绪 1.6 s）。
   * 也就是说这个权限位**不能**作为 JIT 可用性的预检；而一次误判的代价是整机不可用（终态 failed，
   * 库契约 §2.6：进程内 Node 无法自动重启），远重于 compat 的性能损失（7–10×，但功能完整）。
   * ⇒ `auto` 一律取 compat（宁慢不崩）；要 jit 必须**显式**选择：调试参数 `piNodeMode jit`
   * 或偏好设置 `pi-settings.nodeMode=jit`（在已证实可用的设备上）。依据串里保留权限读数，便于归因。
   */
  const detail: string = probe.granted
    ? 'ACL 探测：' + probe.detail + '；但权限位不能证明内核允许 JIT（手机实测仍 SIGTRAP），auto 保守取 compat'
    : 'ACL 探测（auto 兜底）：' + probe.detail;
  return new NodeModeDecision(NODE_MODE_COMPAT, detail);
}
