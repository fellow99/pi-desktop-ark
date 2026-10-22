# ACL 与权限配置（`org.fellow99.pi.PiDesktopArk`）

> **口径**：与 `pi-desktop-hos` **逐项一致**（基准：`pi-desktop-hos/docs/ACL申请清单.md`）。
> 落点：`entry/src/main/module.json5`（单一模块应用，声明面集中在 entry）。
> **规划**：`docs/000-工程规划.md` **§10** 是摘要与验收判据；**本文给完整明细与两次实测的原始证据**。

## 1. 声明面（代码事实）

| 项 | 内容 | 与 hos 的关系 |
| --- | --- | --- |
| `requestPermissions` | **21 项**：`web_engine` 的 23 项 + `KEEP_BACKGROUND_RUNNING`，**已撤销 3 项**（`READ_PASTEBOARD`、`READ_WRITE_DESKTOP_DIRECTORY`、`FILE_ACCESS_PERSIST`）；**保留** `READ_WRITE_{DOCUMENTS,DOWNLOAD}_DIRECTORY`（normal 级、无 ACL，点 Tab 时授权）⇒ **四机实测见 §5** | ✅ 基线逐项一致，撤销/保留项均有依据 |
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

---

## 5. 用户目录权限（`文档` / `下载`）四机实测（2026-10-20）

> 背景：这两项是**唯一**「点了才授权、且不同设备表现可能不同」的权限。本节记录 **2in1 / 平板 / 手机 / TV** 四台真机的同一套步骤结果，
> 用来回答「为什么有的设备打不开 文档/下载」。逐条原始返回体与日志见
> [`docs/001-能力复刻评估.md`](001-能力复刻评估.md) **REV-8 / REV-10 / REV-11**，手机侧另见 `docs/ACL-无ACL评估.md` §10。

### 5.1 一句话结论

**「装完就打不开」是正常的**（`user_grant`，必须先授权一次）；**差别在"能不能授予"**：`2in1` 与 `tablet` 运行时请求**静默授予**、目录随即可读；
`phone` 的运行时请求被平台判**无效**（`authResult:2`）且不弹窗；`TV` 虽授予成功但该机**没有用户主目录**，路径根本不存在。

### 5.2 结果矩阵

| 设备 | 标识 | API / OS | `deviceType` | 装完 `browse` | 运行时 `POST /api/host/perm` | 授权后 `browse` | 重启后 |
|---|---|---|---|---|---|---|---|
| 2in1 | `HAD-W32` | 26 / `OpenHarmony-7.0.0.109` | `2in1` | ❌ 403 `EACCES`（`canRequest:true`） | ✅ `authResult:0`、`granted:true`（**无弹窗，静默授予**） | ✅ 200（文档 3 项 / 下载 7 项） | ✅ 仍 200 |
| 平板 | `MRDI-W00` | 24 / `OpenHarmony-6.1.1.120` | `tablet` | ❌ 403 `EACCES`（`canRequest:true`） | ✅ `authResult:0`（两项均静默授予） | ✅ 200（文档 0 项＝空目录 / 下载 4 项） | ✅ 仍 200 |
| 手机 | `JUY-AL80` | 26 / `OpenHarmony-7.0.0.105` | `phone` | ❌ 403 `EACCES`（`canRequest:true`） | ❌ **`authResult:2`（SDK 语义：请求无效）**、`denied:1`、**无任何系统弹窗** | ❌ 仍 403 | — |
| TV（非标准 OH，**不列为验收对象**） | `shaolingun` | 23 / `OpenHarmony-6.1.0.35` | `default` | ❌ 403 `EACCES` | ⚠️ `authResult:0`（"已授予"） | ❌ 仍 403 —— 该机**无** `/storage/Users/currentUser`（只有 `/storage/cloud`、`/storage/media`） | — |

> OS 列取自设备自报（`<filesDir>/payload/node-mode.json` 的 `osFullName` / `const.ohos.fullname`），四台都形如 `OpenHarmony-x.y.z`。
> TV 已按要求 `hdc uninstall` 卸载（`bm dump` 报未安装、沙箱目录不存在、无进程残留）。

### 5.3 复现步骤（任一台，USB 或 TCP 均可）

```bash
# 0) 干净起点 + 亮屏（手机侧必须先亮屏，否则无法判断"弹窗是不是被锁屏挡掉"）
hdc -t <key> shell "power-shell wakeup"
hdc -t <key> uninstall org.fellow99.pi.PiDesktopArk
hdc -t <key> install -r entry/build/default/outputs/default/entry-default-signed.hap
hdc -t <key> shell "aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility"

# 1) 取真实端口并建隧道（⚠️ hdc 规则寿命只覆盖创建它的那次调用 ⇒ 建规则与用规则要写进同一条命令）
PORT=$(hdc -t <key> shell "cat <filesDir>/payload/pi-web.ready.json" | python -c "import sys,json;print(json.load(sys.stdin)['port'])")
hdc -t <key> fport tcp:18400 tcp:$PORT

# 2) 未授权时：403 + canRequest
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:18400/api/cwd/browse?root=documents"

# 3) 触发授权（白名单只放这两项）→ 看 authResult：0=授予 / -1=用户拒绝 / 2=请求无效
curl -s -X POST http://127.0.0.1:18400/api/host/perm -H 'content-type: application/json' \
  -d '{"permission":"ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY"}'

# 4) 复验（200 + 目录条目 = 真通；403 = 仍不可用）
curl -s "http://127.0.0.1:18400/api/cwd/browse?root=documents"
```

`authResult` 三个取值的依据（本地 SDK）：`security/PermissionRequestResult.d.ts` —— `0` 已授予、`-1` 未授予（用户拒绝）、**`2` 请求无效**。

### 5.4 根因（已逐条排除/坐实）

| 假设 | 结论 | 证据 |
|---|---|---|
| 没声明 / 级别不对 | ❌ 排除 | 四项声明在 `module.json5`（21 项之一，带 `reason`+`usedScene`）；手机 `/system/etc/access_token/permission_definitions.json`：`user_grant` / `normal` / `NORMAL` / `provisionEnable:true`，**与 2in1、平板一致** |
| 应用在后台/锁屏，弹窗被系统立即关闭 | ❌ 排除（手机侧） | 请求期间每 1 s 抓 `uitest dumpLayout` 连续 6 次无任何弹窗；同刻屏幕内容就是本应用（`resource:/RAWFILE/boot.html` + pi-web UI「开始使用」）⇒ 前台可见 |
| 需要 ACL（`system_basic`） | ❌ 排除 | 两项 `availableLevel: normal`，本版**不需要** ACL；现役 ACL 只有 `kernel.ALLOW_WRITABLE_CODE_MEMORY` |
| **签名 profile 未预授权** | ✅ **坐实** | `openssl smime -verify` 解 p7b ⇒ `type:"debug"`、`acls.allowed-acls:["ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY"]`、`permissions: []` |
| **平台对 phone 形态拒绝该运行时请求** | ✅ **坐实（现象层）** | 同一 HAP、同一 API 家族，仅手机返回 `authResult:2`；2in1/平板为 `authResult:0` 静默授予 |
| TV 目录不可用与权限无关 | ✅ 坐实 | 授权后仍 403；`ls /storage/Users` → `No such file or directory`（该机没有用户目录体系） |

### 5.5 影响与后续路线（均**未**实施）

1. **profile 预授权**（最省事，推荐先试）：该权限 `provisionEnable: true`，可在 AGC/DevEco 重新生成 profile，把
   `READ_WRITE_{DOCUMENTS,DOWNLOAD}_DIRECTORY` 放进 `permissions`（或 `acls`）⇒ **装完即授予**，手机上也不需要弹窗。
   注意：改 profile 属签名材料变更，需重新签名重装，并在 `REV-x` 记录指纹。
2. **改走系统选择器**：手机形态改用 `DocumentViewPicker` / `PhotoViewPicker` 取**一次性授权 URI**，无需任何目录权限。
   现状：ArkTS 侧 `fs.pickFolder` / `fs.pickFiles` 已实现并注册，缺的是「UI 入口 + 选中后作为 cwd」的接线。
3. **如实呈现**：`browse` 目前会把"目录不存在"也报成 `403 EACCES + permission`（TV 上就是这样误导的）。
   建议区分 `ENOENT`（设备没有该目录）与 `EACCES`（没授权），并让 UI 分别提示。
4. "应用设置里看不到权限开关"是**结果不是原因**：`user_grant` 权限只有**成功授予过**才会在「应用 → 权限」里出现可点项；
   手机上从未授权成功，所以没有开关。2in1/平板授权成功后即出现。

---

## 附录：ohos-node-bridge → ohpm 双包迁移说明（2026-10-22）

> 本文档正文保留写作时的历史口径（旁路同级目录、手工投放等描述**不逐处改写**），迁移变动以本附录为准：

1. **库与运行时已上架 OpenHarmony ohpm 中心仓**（2026-10-22）：`@fellow99/node-bridge@0.1.0`（ArkTS API + NAPI 引导件）
   与 `@fellow99/node-runtime@24.2.0`（`libnode.so` + `libc++_shared.so`，版本 = Node 版本）。库源码仓库：
   [github.com/fellow99/ohos-node-bridge](https://github.com/fellow99/ohos-node-bridge)。
2. **`pi-desktop-ark` 改为常规 ohpm 版本号依赖**（`oh-package.json5`），父工程已移除 `ohos-node-bridge` submodule；
   历史的 `file:./libs/@fellow99/node-bridge.har` 本地旁路与 `scripts/build-bridge-har.sh` **退役**。
3. **运行时不再手工投放**：`scripts/provision-runtime.sh`（委托 `tools/provision.mjs`）退役，
   `libnode.so`/`libc++_shared.so` 由 `@fellow99/node-runtime` 的 HAR 经 hvigor 随 HAP 合并
   （`libnode.so` SHA-256 = `3019bf5f…51a1`，与锁值逐字一致，HAP 解包实测）。
4. **库载荷三件 vendored**：`bootstrap.js` / `host.js` / `lib/tar-extract.js` 不随 HAR 分发，
   已自持到 `vendor/node-bridge-payload/`（与原 `ohos-node-bridge/payload/` 逐字一致），
   `scripts/assemble-payload.mjs` 默认源改指该目录。
5. **相对路径引用失效**：正文中指向 `../ohos-node-bridge/` 的运行时契约 / 冻结契约链接，一律改为 GitHub 仓库对应路径。
6. **迁移后真机复测通过**（2026-10-22，HUAWEI MateBook Pro `3QC0226526001227`）：
   构建 → 安装 → Node v24.2.0 进程内就绪 → `GET /` 200（pi-web SPA）→ `/api/web-auth` 免密放行。

> 迁移不影响本文结论：ACL 申报口径（按宿主包名、Profile 含 ACL 才能装机）不变；仅运行时二进制来源改为 ohpm 包。
