# ACL 与权限配置（`org.fellow99.pi.PiDesktopArk`）

> **口径**：与 `pi-desktop-hos` **逐项一致**（基准：`pi-desktop-hos/docs/ACL申请清单.md`）。
> 落点：`entry/src/main/module.json5`（单一模块应用，声明面集中在 entry）。

## 1. 声明面（代码事实）

| 项 | 内容 | 与 hos 的关系 |
| --- | --- | --- |
| `requestPermissions` | **24 项**：`web_engine` 的 23 项 + `electron` 的 `KEEP_BACKGROUND_RUNNING` | ✅ 逐项一致（已用脚本比对，无多无少） |
| 其中带 `reason` + `usedScene` | **8 项**（`EntryAbility` / `inuse`） | ✅ 文案取自 `web_engine/src/main/resources/{base,zh_CN,en_US}`，**逐字节一致** |
| `definePermissions` | `LOCK_WINDOW_CURSOR`、`kernel.ALLOW_WRITABLE_CODE_MEMORY` | ✅ 一致（受限权限两处成对出现） |
| Ability 后台模式 | `EntryAbility.backgroundModes = ["taskKeeping"]` | ✅ 与 `electron` 模块一致 |

### 1.1 三项 ACL（受限权限，需按本包名申请）

| # | 权限 | 用途 | 判定 |
| --- | --- | --- | --- |
| 1 | `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` | 进程内 Node/V8 的 JIT（**无它 V8 走 JIT 即 SIGTRAP**，属应用级失败） | `system_basic` + `provisionEnable=true` ⇒ 需 ACL |
| 2 | `ohos.permission.READ_PASTEBOARD` | 剪贴板文本/图片粘贴到对话输入框 | 同上 |
| 3 | `ohos.permission.READ_WRITE_DESKTOP_DIRECTORY` | 工作目录位于桌面目录时 agent 文件工具直写 | 同上 |

> 探针实测（`ohos-node-bridge/docs/000-工程规划.md` §D.8）：声明 `kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY`
> 等**开放权限不能替代**第 1 项 —— 仍 SIGTRAP。故第 1 项是刚性前置。

## 2. ⚠️ 实测：Profile 不含 ACL 时**装机直接被拒**（2026-10-16，HAD-W32）

声明面配好、HAP 已用 DevEco 调试证书签名后，装机结果：

```
hdc install -r entry-default-signed.hap
→ error: failed to install bundle.
  code:9568289  error: install failed due to grant request permissions failed.
  PermissionName: ohos.permission.READ_PASTEBOARD
```

同时检查调试 Profile（`~/.ohos/config/default_pi-desktop-ark_*.p7b`）：`type = debug`，
**不含任何权限项**（0 项）——即**声明面 ≠ 授权面**，安装时的授权校验以 **Profile** 为准。

> 这条把 `ACL申请清单.md` §3.1 里那条「⬜ 待实测的已知风险」**从待办变成结论**：
> 在 Profile 拿到 ACL 之前，**留着声明就装不上**（`hdc install -r` 覆盖安装也救不了 —— 已实测）。

### 2.1 解法（二选一，都不需要改代码）

| 路径 | 做法 |
| --- | --- |
| **A. 走 ACL（目标态）** | AGC 获批后**重建 Profile**（Profile 与权限集合绑定；ACL 变化必须重建），或在 AGC 申请**试用调试 Profile**（5 天 / 每应用最多 5 个，可含受限权限）；随后在 DevEco 重新生成签名材料（`File → Project Structure → Signing Configs`），再按 §3 复验 |
| **B. 获批前先跑通其它链路** | 临时把 §1.1 的 3 项 ACL **注释掉**重新构建 → 可装机；此时必须给 Node 传 `--jitless`（代价：**WebAssembly 全废**、热循环约 300 ms/5 轮）。**验完把这 3 项恢复** |

## 3. 验收判据（ACL 生效后可证伪）

装机后（`aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk --ps probeFlags "--no-verify-heap"`）：

1. 不出现 `Cpp Crash`（无 ACL 时必现 `CRASH sig=5 si_addr==pc`）；
2. `<filesDir>/payload/node.log` 出现 `(target MAGLEV)` 之类的编译日志；
3. 自检接口 `curl -s http://127.0.0.1:15577/facts`（或 pi-web 探活）返回 200；
4. 热循环耗时显著低于 300 ms/5 轮（解释器基线）。

## 4. 与运行时投放的关系

ACL 只决定**内存权限**，不影响库与原生库的加载：`libnode.so` 仍需由
`scripts/provision-runtime.sh`（委托 `ohos-node-bridge/tools/provision.mjs`）投放进
`entry/libs/arm64-v8a/`，`libnode_bridge.so` 随 `@fellow99/node-bridge` HAR 打包。
