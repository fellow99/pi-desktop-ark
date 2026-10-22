# TECH.md —— `pi-desktop-ark` 技术选型

> 口径：**✅ 已落地** 与 **⬜ 规划未实现（Phase N）** 分开标注；每条给出「选型理由」，且理由**引用规划 §号或库文档 §号**，不重复论证运行时结论（宪法 A3）。
> 依据：规划 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) §1.2/§2.3/§2.4/§7/§8/§14.3；库文档 [`ohos-node-bridge/docs/000-工程规划.md`](https://github.com/fellow99/ohos-node-bridge/blob/main/docs/000-工程规划.md)（上游库仓库）§6/§D.8/§D.10/附录 G。

---

## 1. 技术选型表

| 类别 | 技术/版本 | 用途 | 选型理由 |
|---|---|---|---|
| 应用框架 | **ArkTS + ArkUI（Stage 模型）**，`@Entry` / `@Component` / `@State` | 宿主壳：Ability、页面、组件、状态 | 平台一等公民；不用任何自建 UI 框架；`@State` 足以驱动「状态条 + 加载页 + 诊断面板」这类低复杂度界面（✅ `entry/src/main/ets/pages/Index.ets:18-23`） |
| 渲染 | **ArkWeb `Web` 组件**（`@kit.ArkWeb`，`webview.WebviewController`） | 主界面（本地服务页 `http://127.0.0.1:<port>/`） | ① 正面对上 AppGallery 的 ArkWeb 驳回项（合规刚性，规划 §2.1/G1）；② 替代 181 MB 的随包 Chromium；③ 同形态先例已在售：ArkWeb 加载 `http://127.0.0.1:5577`（🔶 库 §5.10 第 6 条），本工程仍需 P0-3 自测 |
| ArkWeb 配置（已落） | `javaScriptAccess(true)` + `domStorageAccess(true)` | 让 SPA 能跑 | 缺 `domStorageAccess` ⇒ `localStorage = null` ⇒ SPA 首屏崩（🔶 旧壳 PoC / 库 §5.10 第 7 条）；✅ `Index.ets:108-109` |
| ArkWeb 配置（待补） | ⬜ `databaseAccess(true)`、`clearHistory()`、返回键守卫、`onLoadIntercept`（`isMainFrame()`）、`onWindowNew` | SPA 存储、历史清理、导航围栏、弹窗拦截 | 不清历史 ⇒ 返回键把用户永久卡在加载页（库 §5.10 第 8 条）；围栏等价旧壳 `setWindowOpenHandler` + `will-navigate`（规划 §5 第 11 条） |
| 应用上下文 | **`@kit.AbilityKit`**：`UIAbility`、`common.UIAbilityContext`、`Want`、`AbilityConstant` | 生命周期、取 `filesDir`/`bundleCodeDir`、读启动参数 | `context.filesDir` 是沙箱**唯一可写根**（规划 §5 第 2 条）；`want.parameters['probeFlags']` 是调试期传 Node 参数的零成本通道（✅ `EntryAbility.ets:24-34`）；页面取 context 用 `this.getUIContext().getHostContext()`（宪法 T1） |
| 窗口 | **`@kit.ArkUI` `window`（`window.WindowStage`）** | `loadContent('pages/Index')`；⬜ Phase 2 尺寸记忆 | Ability → 页面标准路径；窗口尺寸记忆按规划 §5 第 7 条走 ArkTS `window` API（不能复用旧壳 `BrowserWindow` + `screen`） |
| 本地偏好 | ⬜ **`preferences`** | 窗口尺寸/最近状态（最小版） | 规划 §5 第 7 条指定「先做记忆尺寸最小版」；用平台 KV 而不是自建 JSON，避免沙箱文件格式漂移 |
| 网络探活 | **`@kit.NetworkKit` `http`** | 就绪探活（当前 20 次 × 500 ms） | 与渲染解耦：探活失败**不依赖 Web 组件**报错（旧壳靠 HTTP 轮询 `/api/web-auth`，`src-main/main.js:858-873`）；平台自带，无额外依赖 |
| 日志（宿主） | **`@kit.PerformanceAnalysisKit` `hilog`**（DOMAIN `0xD0033`，TAG `PI_DESKTOP_ARK`） | 宿主侧阶段与错误 | 与库同 DOMAIN（`NODE_BRIDGE` TAG）便于一条 `hilog` 命令抓全链；✅ `common/Constants.ets:3-4,29-37` |
| 运行时 | **`@fellow99/node-bridge@0.1.0`（ohpm 中心仓）** | 进程内 Node（`dlopen` + `node::Start`，detached 线程） | 唯一可行形态：应用域子进程 JIT 被拦（seccomp/SIGSYS）、`execve` 全 EACCES ⇒ 不做子进程（规划 §0.3、§8.4；库 §4.6 路线 A）。**以 ohpm 包（HAR）消费**而不是源码目录：`useNormalizedOHMUrl: true` 下跨工程相对导入被拒（`00309001`，✅ 本机踩坑）；库已上架中心仓 ⇒ 直接 `ohpm install`（历史 `file:./libs/…har` 旁路已退役） |
| 运行时产物 | **Node v24.2.0**（`libnode-arm64.so` → 部署名 `libnode.so`，126,809,264 B）+ `libc++_shared.so`（1,262,504 B，取自 ohos-sdk） | 真 Node 运行时 | 满足上游 `engines.node >= 22.19.0`（✅ `pi/package.json:70-71`、`pi-web/package.json`）；共享库形态（非 PIE）才能 `dlopen`（库附录 D）；运行时二进制由独立包 **`@fellow99/node-runtime@24.2.0`**（ohpm 中心仓）分发，版本与 SHA-256 锁在库侧 `runtime.lock.json`（库附录 G）；本工程**不手工投放**、二进制**不入库** |
| 端上服务端 | **`pi-web`（Next 16.3.8，非 standalone）+ `pi` agent** | SPA `/`、`/api/*`、SSE `/api/agent/*` | 与旧壳**同一份上游 UI** ⇒ 功能对标零改写（规划 §8.1）；**非 standalone** 是上游事实（✅ `pi-web/package.json`）⇒ 载荷必须带**完整** `node_modules` |
| 模块格式 | **CJS + ESM 混用**（`pi-dist/package.json` 无 `type`；`.next/package.json` = commonjs；`@earendil-works/*` = module） | 载荷加载器 | 上游事实（规划 §2.3）⇒ 需要「`require()` 失败退 `import()`」的加载器（旧壳已有，直接复用） |
| SWC | **WASM 版**：`node_modules/next/wasm/@next/swc-wasm-nodejs/`（`wasm_bg.wasm` ≈30.4 MB，🔶 旧壳实测） | 编译 `next.config.ts` | 设备无 aarch64-ohos 原生 SWC（✅ 规划 §2.3）⇒ **WebAssembly 是硬需求** ⇒ 与 JIT/ACL 强耦合（库 §4.7） |
| 工具扩展 | ⬜ **三个同名工具扩展**：`bash`（`harmony-exec.js`：常驻非 PTY `/system/bin/sh` + 随机哨兵行）、`find`/`grep`（`harmony-search.js`：纯 JS 走查） | 顶替内建 `bash`/`find`/`grep` | 内建 `bash` 依赖子进程事件（本平台不达）会永久挂住；内建 `find`/`grep` 依赖 `fd`/`rg`（设备无）⇒ 同名顶替对模型与 UI 透明（规划 §8.1/§8.3；🔶 旧壳已真机验证） |
| 数据面协议 | **同源 HTTP + SSE**：`/`（SPA）、`/api/*`、SSE、鉴权端点 | 前后端唯一通道 | 页面由本地服务渲染 ⇒ 天然同源、零 CORS、零头改写（✅ 上游源码事实，规划 §6.1）；宪法 A1 禁 preload/IPC 载体 |
| 鉴权 | **路线 ① loopback 免密（首选）**；路线 ② 局域网 + 密码 + Cookie 注入（回退） | 本地服务访问控制 | ①：只监听 `127.0.0.1` + 不设 `PI_WEB_PASSWORD` ⇒ 上游直接放行（✅ `pi-web/proxy.ts:42-47`）；②：`v1.<exp>.<nonce>.<HMAC-SHA256(密码)>` 会话 cookie 对 `/api/*` 同样生效（✅ `proxy.ts:50-70`、`lib/web-auth.ts`），壳只做 Cookie 写入 |
| 构建链 | **DevEco Studio 6.1 / command-line-tools `hvigorw` / ohos-sdk（API 26 设备）**，`useNormalizedOHMUrl: true`，`nativeLib.collectAllLibs: true` | 出 HAP | 与库同一条链（规划 §14.3）；OHM 归一化是必需项（否则跨 HAR 符号解析不一致）；module 级 `nativeLib` **不吃** `abiFilters`（✅ 踩坑） |
| 签名 | **DevEco 生成的调试证书/Profile（与 `bundleName` 绑定）** + 含 ACL 的 Profile（现役 1 项：`kernel.ALLOW_WRITABLE_CODE_MEMORY`） | 装机与 ACL 生效 | 自签 OpenHarmony 证书被 HarmonyOS 真机拒（`fail to verify pkcs7 file`，库 §D.7）⇒ 只能用 DevEco/AGC 链路；材料**不入库**（宪法 T3） |
| 目标设备 | **2in1 / tablet，arm64-v8a**；真机 **HAD-W24 / 7.0.0.107(SP7C00E100R13P5) / OpenHarmony-7.0.0.105 / API 26** | 运行目标 | 不做 phone、不做 x86_64（规划 §0.3/§1） |
| 观测/取证 | **`hdc`**：`snapshot_display`（截图）、`uitest uiInput`（点按）、`rport`（日志回传）、`hilog`、`fport` + `curl /facts` `/log` | 真机判据 | 旧壳与本工程共同结论：`uitest dumpLayout` 在本机拿不到结果 ⇒ 判据改走 HTTP 端点（✅ 库 §D.8；规划 附录 A） |
| host 侧脚本 | **Bash（Git-Bash）+ Node** | 构建/组装/取证 | `hvigorw.bat` 经 `cmd //c` 调用；运行时获取由 ohpm 中心仓包承担（`ohpm install`），不再有本地投放脚本 |

---

## 2. 明确**否掉**的选项

| 选项 | 为什么否掉 |
|---|---|
| **Chromium / Electron 随包** | ① 合规：AppGallery 以 P0 驳回「未使用 ArkWeb 组件」（🔶 同型工程原文，规划 §2.1）；② 体积：`libelectron.so` 单件 181 MB、HAP 320.3 MB，换来的只是「渲染一个本地页面」 |
| **子进程形态的 Node**（spawn `node` / 子进程跑服务端） | 平台封死（规划 §0.3）：应用域子进程 JIT 被拦（库 §D.8 轮次①）、`execve` 任何新镜像被拒（EACCES，库 §5.10 第 16 条）；且子进程退出事件不可靠（旧壳 R14）⇒ 服务端必须**同进程** |
| **`--inspect` 进 release** | 旧壳 R7 的教训；仅 debug 构建允许，Phase 1 明确「停用（不进生产）」 |
| **PTY / 终端面板** | 应用域 `/dev/ptmx` 可 open，但 `node-pty` 无 openharmony-arm64 预编译产物（🔶 旧壳能力清单 #16）⇒ L2 缺失；不做（规划 §8.1/§8.4） |
| **`git` / worktree 功能** | 设备无 `git` 二进制（🔶 旧壳 #23）；降级为不可用并提示（宪法 A6） |
| **后台常驻 / 开机自启 / 自动更新** | 平台级不可用（2in1 最小化不算后台、无公开 setter，🔶 旧壳 #29/#31）；规划 §0.3 已列为非目标 |
| **应用内解压（ArkTS/OHOS 侧解压器写业务文件）** | 「谁写谁读」硬约束：ArkTS 写出的文件 Node **读不到**（`MODULE_NOT_FOUND`）⇒ 解包只能由 Node 自己做（库宪法 C3） |
| **跨工程源码导入（`ohos-node-bridge/library`）** | `useNormalizedOHMUrl: true` 下报 `00309001 Cannot import files from an external module using relative paths`（✅ 本机踩坑，规划 附录 B #1）。现役方案 = ohpm 包（HAR 已编译产物，不受此限） |
| **二进制入库**（`libnode.so` 120.9 MiB） | GitHub 单文件 100 MiB 硬限；且每次换版本都留永久历史（库附录 G.1/G.5） |
| **制品库（Nexus/OSS/私有 registry）** | 没有现成制品库；为一枚可校验的 `.so` 引入一套服务，运维成本 > 收益（库附录 G.5） |
| **把 `resfile` 当可写目录** | `resfile` 是安装目录（只读）；需要可写就把**缓存目录**指向沙箱，而不是把整份载荷再解一份（规划 §7.1） |
| **ArkWeb 外链页（旧壳 `ExternalWeb.Open`）** | 该桥在旧壳 ArkTS 侧**从未注册**，调用即空指针 SIGSEGV（🔶 旧壳 #28）⇒ 不得照抄；本工程用「应用内地址窗口内承载 + 第三方地址交系统浏览器」或**真正注册**的能力（规划 §5 第 8 条） |

---

## 3. 版本与工具链基线

| 项 | 值 | 取证 |
|---|---|---|
| 应用 | `Pi Desktop Ark` / `org.fellow99.pi.PiDesktopArk` / versionName `0.1.0` / versionCode `100` | ✅ `AppScope/app.json5` |
| 模块 API 口径 | `compatibleSdkVersion 5.0.5(17)`、`targetSdkVersion 6.1.1(24)`；`app.json5` 的 `minAPIVersion 17` / `targetAPIVersion 24` | ✅ `build-profile.json5`、`AppScope/app.json5`（⚠️ 与规划「API 26」口径的差异见 `STRUCTURE.md` §2.1） |
| Node | **v24.2.0**（`platform=openharmony`、`arch=arm64`、`modules=137`、`v8 13.6.233.10-node.17`、`uv 1.51.0`、`undici 7.10.0`、`openssl 3.0.16`） | ✅ 本机 `/facts`（`docs/evidence/2026-10-16-acl-jit-verified.md`） |
| 运行时产物锁 | `@fellow99/node-runtime@24.2.0`（ohpm 包）内 `libnode.so` SHA-256 `3019bf5f…51a1`、`libc++_shared.so` SHA-256 `388e0df2…b2f9`（锁值见库侧 `runtime.lock.json`，随主包 rawfile 分发） | ✅ 库 §D.9 + 干净目录 `ohpm install` 实测 + 本工程 HAP 内核对（规划 附录 B #2） |
| 上游 | `pi`（`engines.node >= 22.19.0`）、`pi-web`（`next 16.3.8`、`react ^19.2.4`、`engines.node >= 22.19.0`） | ✅ `pi/package.json:70-71`、`pi-web/package.json:61` |
| 构建产物 | `entry-default-signed.hap` **129,347,874 B**（未签名 128,255,687 B） | ✅ 本机 `entry/build/default/outputs/default/` + `docs/evidence/…` |
| 设备 | HAD-W24（HUAWEI MateBook Pro）/ 7.0.0.107(SP7C00E100R13P5) / OpenHarmony-7.0.0.105 / API 26 / arm64-v8a；序列号 `3QC0226526001227` | ✅ 本机真机记录 |
| 工具链路径 | `DEVECO_SDK_HOME=D:\oh-workspace\command-line-tools\sdk`、`hvigorw.bat`、`hdc.exe`（DevEco sdk 的 `toolchains/`） | ✅ 规划 §14.3/附录 A |
| 库 | `@fellow99/node-bridge` version `0.1.0` ＋ `@fellow99/node-runtime` version `24.2.0`（均来自 ohpm 中心仓） | ✅ `oh-package-lock.json5` |

---

## 4. 关键版本约束与兼容矩阵

| 约束 | 来源 | 结论 |
|---|---|---|
| 上游要求 Node **`>=22.19.0`** | ✅ `pi/package.json:70-71`、`pi-web/package.json` `engines` | 库投放的 Node **v24.2.0** 满足；换低版本运行时**直接违反上游契约** |
| Next **16.3.8 非 standalone** | ✅ `pi-web/package.json:61` | 不能靠 `next build --output standalone` 缩小载荷（上游未配置）⇒ 必须带完整 `node_modules` 或等价的**可解析结构** |
| 设备侧只有 **WASM SWC** | ✅ 规划 §2.3 | `node_modules/next/wasm/@next/swc-wasm-nodejs/` **必须**在位 ⇒ **WASM 必须可用** ⇒ **JIT/ACL 是硬前置**（`--jitless` 下 WASM 全废） |
| `fetch`（undici + `serverExternalPackages`） | ✅ `pi-web/lib/http-dispatcher.ts:5` | undici 的 llhttp 是 WASM ⇒ 与上一条同因；`--jitless` 下 `fetch` 直接失败 |
| CJS + ESM 混用 | ✅ 规划 §2.3 | 加载器要「`require()` 失败退 `import()`」；不要写死一种解析方式 |
| 43 个服务端编译产物引用 `child_process` | ✅ 规划 §2.3 | 靠同名扩展顶替（`bash`/`find`/`grep`）或补丁；设计**不依赖** `spawn` 的完成事件（尽管本机实测三事件齐全，库 §D.8） |
| `process.version < 22.19.0` ? | 库侧只 warn 不阻断（库宪法 C2） | 本工程在验收里**自己判**（`/facts` 的 `node` 字段），不依赖库替我们拦 |
| `targetSdkVersion 6.1.1(24)` vs 设备 API 26 | ✅ `build-profile.json5` | 设备 API 26 只说「能跑」，不代表用到了 26 的新接口；⚠️ 口径需在 Phase 1 明确（见 `STRUCTURE.md` §2.1） |

---

## 5. 选型带来的硬性代码约束（谁影响谁）

| 选型 | 由此产生的代码约束 | 落点 / 现状 |
|---|---|---|
| 进程内 Node（无子进程） | 端口冲突/未捕获异常 = **整进程 abort** ⇒ 随机端口 + 单实例 + 载荷自装兜底 | ⚠️ 现固定 15577；⬜ `uncaughtException` 未装（宪法 A8/A9） |
| ArkWeb 主界面 | 必须开 `domStorageAccess`；起来后 `clearHistory()` + 返回键守卫；外链走围栏 | ✅ 前两项；⬜ 后两项（规划 §5 第 1/11 条） |
| 载荷只读直读（`resfile`） | Node 读安装目录、**不写**安装目录；可写部分（缓存）指到沙箱 | ⬜ Phase 1（`resfile/pi-web/` 现只有 README） |
| 载荷由 Node 自解包（若走 `tar.gz`） | 解包器必须是 Node 代码（`zlib`+`fs`）+ SHA-256 marker 幂等；**禁用** OHOS 侧解压器写业务文件 | 🔶 解包器在旧壳（`src-main/tar-extract.js`，214 行）可直接搬 |
| 以 ohpm 包消费库 | 库与运行时的发版节奏受中心仓约束（要新能力须等库发版）；不能直接引用库源码 | ✅ `oh-package.json5` |
| 运行时产物不入库 | 新机器/CI 必须先 `ohpm install` 再 `assembleHap`；中心仓不可达时无法构建 | ✅ `oh-package.json5` |
| 签名与 ACL 绑定包名 | 改包名 ⇒ 全套重来（证书、Profile、ACL 申请） | ✅ 现状包名已固定 |
| `hilog` 为宿主观测通道 | 阶段文案要进 hilog（可被 `hdc shell hilog` 抓到）；判据不能只靠 UI 文字 | ✅ `common/Constants.ets` 的 `Log` |
| `uitest dumpLayout` 不可用 | 所有「界面上出现了 X」的判据必须能截图或经 HTTP 端点读回 | ✅ 测试用例纪律（`overall-test-cases.md` §4） |

---

## 6. 待定稿的选型（Phase 1–2 的决策点）

| 决策点 | 选项 | 判据（可证伪） | 时限 |
|---|---|---|---|
| ArkWeb 能否访问 `127.0.0.1` | 路线 ① 免密（首选） / 路线 ② 局域网 + 密码 + Cookie | 截图出现 Pi Web UI 首屏；`/facts` 或服务侧访问日志出现来自渲染进程的请求 | Phase 1（P0-3） |
| 载荷形态 | `resfile` 只读直读（首选） / `tar.gz` + Node 自解包 | 直读下 `require` 全链成功且首启无可观测解压等待；否则退路线 ② | Phase 1（P0-13） |
| 裁剪四项 | `.nft.json`（348 MB）、`@next` win32 SWC（106 MB）、`@img`（29 MB）、`node-pty`（27 MB） | 逐项删后：离线真机仍能起服务、无联网补下载（`tmp/next-swc` 不出现） | Phase 1（O1/O2） |
| `databaseAccess` 是否需要 | 开 / 不开 | 关闭状态下 SPA 首屏与索引库功能是否报错（截图 + 控制台） | Phase 1（P0-3） |
| 目录选择器形态 | ArkTS picker + 授权（`fs.pickFolder`）/ 宿主侧 browse | 两方案各一次真机：能选到目录、返回值能被 agent 用作 cwd | Phase 2（O8） |
| MCP stdio 是否可用 | 用 / 不用（保守设计） | 真机起一个 stdio 服务器：`data`/`exit`/`close` 三事件是否齐全（本机已 ✅，仍需端到端） | Phase 2（O5） |
| ArkWeb 渲染进程模型 | 独立进程 / 同进程 | `aa dump`/`hilog` 观测 `:render`/`:gpu` 子进程行为 | Phase 1（O9） |
| SSE 长连接在前后台切换下的行为 | 保持 / 重连策略 | 真机长连接计时 + 前后台切换后流式是否续上 | Phase 1（A5） |

---

## 7. 选型被推翻时的替换路径（预案，避免返工）

| 若…被推翻 | 替换为 | 代价 |
|---|---|---|
| ArkWeb 访问不到 `127.0.0.1` | 路线 ②：绑局域网 IP + 随机密码 + Cookie 注入（`pi_web_session` 派生算法已定） | 需要 Cookie 注入通道（⬜ ArkWeb Cookie API 实测）+ 局域网暴露面 |
| `resfile` 直读不可接受（数万小文件） | `tar.gz` + Node 自解包（解包器与幂等 marker 已备） | 首启解压耗时与失败面（必须配加载页与重试） |
| 裁剪导致 Next 起不来 | **逐项回退**（先回 `.nft.json`，再回 win32 SWC），保持「能起」优先 | 体积回升到 156.6 MB 量级 |
| ACL 最终未获批 | `--jitless` 兜底（但 **WASM 全废** ⇒ Next 的 WASM SWC 与 undici `fetch` 必须先改造） | 属**触发式**备选，默认不投入（规划 §12、库 §D.8 结论 2） |
| ArkWeb 有 API 缺失（SSE/Worker/`crypto.subtle`） | `javaScriptOnDocumentStart` 注入兜底（规划 R4） | 增加注入维护面 |
| 载荷体积仍过大 | 分卷 / 进一步裁剪（如实记录首启耗时，规划 R5） | 首启体验与上架材料 |

---

## 8. 选型证据锚点（评审时逐条可查）

| 选型结论 | 证据锚点 | 类型 |
|---|---|---|
| 主界面由本地服务渲染、同源免 CORS | `pi-web/lib/request-security.ts:90-102`（loopback 直接放行） | ✅ 上游源码 |
| 未设密码 ⇒ 认证整体关闭 | `pi-web/lib/web-auth.ts:15-19`、`proxy.ts:42-47` | ✅ 上游源码 |
| Cookie 对 `/api/*` 同样生效 | `pi-web/proxy.ts:50-70` | ✅ 上游源码 |
| 同形态先例：ArkWeb 直连 `127.0.0.1` | 库 §5.10 第 6 条（`electerm-harmony`，只读核实） | 🔶 沿用 |
| 进程内 Node 是唯一可行形态 | 库 §4.6 路线 A、§5.10 第 16 条（子进程 `execve` 全 EACCES） | ✅ 库结论 |
| JIT 需要 ACL、`--jitless` 会让 WASM 全废 | 库 §D.8 轮次 ①/①′/②；本工程 `/facts` 作为反证 | ✅ 双方 |
| 设备侧只能走 WASM SWC | 库 §D.8 结论 3 + 规划 §2.3 | ✅ 库结论 |
| 库以 HAR 消费 | `00309001`（本机构建日志）+ `oh-package.json5:12` | ✅ 本机 |
| `libnode.so` 只能用裸名 `dlopen` | 库 §D.8 实现偏差表 | ✅ 库结论 |
| 签名必须走 DevEco/AGC | 库 §D.7（自签证书被真机拒：`fail to verify pkcs7 file`） | 🔶 库结论 |
| `uitest dumpLayout` 不可用于取证 | 库 §D.8（本机拿不到结果） | ✅ 库结论 |
