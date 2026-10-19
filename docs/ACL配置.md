# ACL 与权限配置（`org.fellow99.pi.PiDesktopArk`）

> **口径**：与 `pi-desktop-hos` **逐项一致**（基准：`pi-desktop-hos/docs/ACL申请清单.md`）。
> 落点：`entry/src/main/module.json5`（单一模块应用，声明面集中在 entry）。
> **规划**：`docs/000-工程规划.md` **§10** 是摘要与验收判据；**本文给完整明细与两次实测的原始证据**。

## 1. 声明面（代码事实）

| 项 | 内容 | 与 hos 的关系 |
| --- | --- | --- |
| `requestPermissions` | **21 项**：`web_engine` 的 23 项 + `KEEP_BACKGROUND_RUNNING`，**已撤销 3 项**（`READ_PASTEBOARD`、`READ_WRITE_DESKTOP_DIRECTORY`、`FILE_ACCESS_PERSIST`）；**保留** `READ_WRITE_{DOCUMENTS,DOWNLOAD}_DIRECTORY`（normal 级、无 ACL，点 Tab 时授权） | ✅ 基线逐项一致，撤销/保留项均有依据 |
| 其中带 `reason` + `usedScene` | **6 项**（`EntryAbility` / `inuse`） | ✅ 文案取自 `web_engine/src/main/resources/{base,zh_CN,en_US}`，**逐字节一致** |
| `definePermissions` | `LOCK_WINDOW_CURSOR`、`kernel.ALLOW_WRITABLE_CODE_MEMORY` | ✅ 一致（受限权限两处成对出现） |
| Ability 后台模式 | `EntryAbility.backgroundModes = ["taskKeeping"]` | ✅ 与 `electron` 模块一致 |

### 1.1 ACL（受限权限，需按本包名申请）：现役 **1 项**

| # | 权限 | 用途 | 判定 |
| --- | --- | --- | --- |
| 1 | `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` | 进程内 Node/V8 的 JIT（**无它 V8 走 JIT 即 SIGTRAP**，属应用级失败） | `system_basic` + `provisionEnable=true` ⇒ 需 ACL |

> 探针实测（`ohos-node-bridge/docs/000-工程规划.md` §D.8）：声明 `kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY`
> 等**开放权限不能替代**第 1 项 —— 仍 SIGTRAP。故第 1 项是刚性前置。

**2026-10-19 撤销三项 / 保留两项**（取证：`docs/001-能力复刻评估.md` REV-5·REV-6·REV-7；零 ACL 评估：`docs/ACL-无ACL评估.md`）：

| 权限 | 等级 | 撤销依据 |
| --- | --- | --- |
| `ohos.permission.READ_PASTEBOARD` | `system_basic` + `user_grant` ⇒ 需 ACL | 页面粘贴由 **ArkWeb 自己**读剪贴板：应用侧 0 处 `@ohos.pasteboard` 调用，pi-web 只用 DOM `paste` 事件；真机该权限 `grantStatus=-1`（从未授予）时 Ctrl+V 仍能粘贴 |
| `ohos.permission.READ_WRITE_DESKTOP_DIRECTORY` | `system_basic` + `user_grant` ⇒ 需 ACL | 桌面目录只是「工作区选择器」的一个根；不申请只少一个 Tab（最终根清单只留「沙箱」） |
| `ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY` | `normal` + `user_grant` ⇒ **不需 ACL** | ✅ **保留**（REV-7）：点「文档」Tab 时经 `perm.request` 弹授权窗，授予后列举 |
| `ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY` | `normal` + `user_grant` ⇒ **不需 ACL** | ✅ **保留**（REV-7）：同上（「下载」Tab） |
| `ohos.permission.FILE_ACCESS_PERSIST` | `normal` + `system_grant` | 随之不再调用 `fileShare.persistPermission`（REV-6） |

## 2. 装机与授权：两次实测（2026-10-16，HAD-W24）

### 2.1 第一次：Profile 不含 ACL ⇒ **装机直接被拒**

```
hdc install -r entry-default-signed.hap
→ error: failed to install bundle.
  code:9568289  error: install failed due to grant request permissions failed.
  PermissionName: ohos.permission.READ_PASTEBOARD
```

排查：解调试 Profile（`~/.ohos/config/default_pi-desktop-ark_*.p7b`）→ `type=debug` 且**权限项为 0**。
⇒ **声明面 ≠ 授权面**，安装时的授权校验以 **Profile** 为准。这条把 `ACL申请清单.md` §3.1 的
「⬜ 待实测的已知风险」**从待办变成结论**：Profile 里没有 ACL 时，**留着声明就装不上**
（`hdc install -r` 覆盖安装也救不了 —— 已实测）。

### 2.2 第二次：重新生成签名（Profile 含 ACL）⇒ **装机成功、JIT 生效**

2026-10-16 21:44 重新生成的 Profile 带 **6 项授权**（3 项 ACL 全在）：

```
ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY   ← JIT 关键项
ohos.permission.READ_PASTEBOARD                     ← ACL
ohos.permission.READ_WRITE_DESKTOP_DIRECTORY        ← ACL
ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY
ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY
ohos.permission.FILE_ACCESS_PERSIST
```

> ⚠️ 2026-10-19 起：本节的 6 项里有两项（`READ_PASTEBOARD`、`READ_WRITE_DESKTOP_DIRECTORY`）**已从声明面撤销**，
> Profile 里对应的两条 ACL 因此成为多余项（保留无害，重建 Profile 时可以去掉）。本节其余内容为当日实测原始记录，不改写。

随后 `hdc install -r` → `install bundle successfully.`；启动（**不带 `--jitless`**）后 `/facts`：

| 判据 | 结果 |
| --- | --- |
| Node | `v24.2.0` / `platform openharmony` / `modules 137` |
| **JIT（ACL 生效）** | ✅ `wasm.available=true`、`wasm.validate=true`、`execArgv=['--no-verify-heap']` |
| 性能 | ✅ 热循环 **6–9 ms / 2e6 次**（同型解释器基线约 59 ms/2e6）⇒ 约 **7–10×** |
| 崩溃 | ✅ `hilog` 中 `Cpp Crash` **0 条**，应用进程（含 ArkWeb `:gpu`/`:render`）稳定存活 |

> 完整证据（原始 JSON + 复现命令）：`docs/evidence/2026-10-16-acl-jit-verified.md`（本地留存，不入库）

### 2.3 复验步骤（Profile 变更后必做）

1. 重新生成签名材料（DevEco → `File → Project Structure → Signing Configs`）；
2. `hdc install -r entry/build/default/outputs/default/entry-default-signed.hap` —— **能装上**即说明 Profile 授权面已就位；
3. `hdc shell "aa force-stop org.fellow99.test.NodeProbe"`（**先腾出 15577**，见 §3.1），再
   `hdc shell "aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk --ps probeFlags '--no-verify-heap'"`；
4. `hdc fport tcp:15577 tcp:15577 && curl -s http://127.0.0.1:15577/facts` —— 看 `wasm.validate` 与 `hotloop_ms_2e6`。

## 3. 两条实测设计规则

### 3.1 端口冲突会把**整个 App 进程**带走（⇒ 随机端口 + 单实例）

实测：15577 被别的应用占着时启动本应用 → `Cpp Crash`（进程消失，崩溃栈里有 `libnode_bridge.so`）；
腾出端口后同一构建完全正常。链路：载荷 `server.listen()` 抛 `EADDRINUSE` → **进程内 Node 的未捕获异常**
→ 整个 App 进程 abort（进程内 Node 没有优雅退出路径）。
⇒ 工程规划 §5.10 ⑫「默认随机端口 + 单实例」由此**从建议变为硬约束**。

### 3.2 载荷必须自装兜底异常，且日志不能只靠 stdout

载荷应装 `process.on('uncaughtException')` / `'unhandledRejection'` 并把错误写进**自己的**日志
（如 `payload/app.log`）；否则任何未捕获异常都是应用级事故（见 §3.1）。
附带发现：`node_bridge.c` 的 `dup2` 会把 **ArkWeb/Chromium 的原生输出**也写进同一份 `node.log`（噪声很大），
Phase 1 按 §5.10 ⑤ 改成「pipe + 独立 reader 线程排空」并分离日志通道。

## 4. 与运行时投放的关系

ACL 只决定**内存权限**，不影响库与原生库的加载：`libnode.so` 仍需由
`scripts/provision-runtime.sh`（委托 `ohos-node-bridge/tools/provision.mjs`）投放进
`entry/libs/arm64-v8a/`，`libnode_bridge.so` 随 `@fellow99/node-bridge` HAR 打包。
