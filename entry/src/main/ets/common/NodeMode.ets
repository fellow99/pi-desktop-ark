import { abilityAccessCtrl, bundleManager, Permissions } from '@kit.AbilityKit';
import { Log } from './Constants';
import { NODE_MODE } from './BuildConfig';

/**
 * 108-jitless：**Node 运行形态**（jit / compat）。
 *
 * 背景：无 ACL（`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 未授予）时 V8 只能 `--jitless`
 * 运行 ⇒ `WebAssembly` 整个对象不存在 ⇒ 载荷里依赖 WASM 的模块（Next 的 SWC、undici 的 llhttp、
 * photon、quickjs）全部失效；无 ACL 却按 jit 起就是**启动即崩**（SIGTRAP/SIGABRT），不是"变慢"。
 *
 * **形态由编译期常量决定**（`BuildConfig.NODE_MODE`，默认 `compat`）—— 运行期**没有**调试参数、
 * 没有设置项、没有 ACL 探测参与决策（2026-10-20 产品决策：不做运行时切换，只在编译期切换）。
 * 理由：`--jitless` 是进程级形态，而进程内 Node 每进程只能起一次、失败即终态（库契约 §2.6），
 * 一次误判 = 整机不可用；权限位也不足以预检（手机 `JUY-AL80` 上 granted 仍 SIGTRAP，见
 * `docs/ACL-无ACL评估.md` §10）。
 *
 * 纪律：本文件**不引 UI、不写全局状态**（只用 `Log` 打事实），因此可以脱离页面推演。
 */

/** 形态常量（与 `specs/108-jitless/spec.md` §2 术语一致） */
export const NODE_MODE_JIT: string = 'jit';
export const NODE_MODE_COMPAT: string = 'compat';

/** 交给库的 Node 参数（`--jitless` 由本模块按形态追加；库保证 flags 全部排在脚本路径之前） */
const BASE_FLAGS: string = '--no-verify-heap';
const JITLESS_FLAG: string = '--jitless';

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

/**
 * 解析本次启动形态 —— **只认编译期常量**（`common/BuildConfig.ets` 的 `NODE_MODE`）。
 *
 * 2026-10-20 产品决策：运行期**不做任何**形态切换。这里仍然做一次 ACL 探测，但**只用于出依据串 /
 * 诊断报告**（`payload/node-mode.json`），不参与决策 —— 因为手机实测已证明「权限位授予 ≠ 内核允许 JIT」
 * （`JUY-AL80` 上 granted 仍 SIGTRAP，见 `docs/ACL-无ACL评估.md` §10）。
 *
 * 切到 jit 的唯一方式：把 `BuildConfig.NODE_MODE` 改成 `'jit'` 后重新构建。
 */
export function resolve(): NodeModeDecision {
  const probe: AclProbe = probeJitAcl();
  const built: string = NODE_MODE === NODE_MODE_JIT ? NODE_MODE_JIT : NODE_MODE_COMPAT;
  const detail: string = '编译期常量 BuildConfig.NODE_MODE=' + built
    + '（运行期不可切换）｜诊断读数：' + probe.detail;
  return new NodeModeDecision(built, detail);
}
