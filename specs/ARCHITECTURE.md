# ARCHITECTURE.md —— `pi-desktop-ark` 整体架构

> 一句话：**ArkTS 宿主起库 → 库在同一进程内跑 Node → Node 起 `pi-web` 服务端（同源 HTTP + SSE）→ ArkWeb 渲染 `http://127.0.0.1:<端口>/`**。无 Electron、无 Chromium。
> 依据：规划 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) §4/§5/§6/§7；运行时契约 [`ohos-node-bridge/docs/000-工程规划.md`](https://github.com/fellow99/ohos-node-bridge/blob/main/docs/000-工程规划.md)（上游库仓库）§6；本工程实测 [`../docs/ACL配置.md`](../docs/ACL配置.md)。
> 标注：**✅ 已落地** / **⬜ 规划未实现（Phase N）**；本文只引用运行时结论，不重新论证（宪法 A3）。

---

## 1. 分层与数据流

```
┌─ HAP（Pi Desktop Ark / org.fellow99.pi.PiDesktopArk）───────────────────────────┐
│  entry 模块（唯一模块）                                                        │
│                                                                              │
│  ┌─ L1 ArkTS 宿主（本工程代码）──────────────────────────────────────────┐    │
│  │  EntryAbility：颜色模式 / probeFlags→AppStorage / loadContent        │    │
│  │  pages/Index：状态条 + ArkWeb Web（boot.html → 127.0.0.1:<port>/）    │    │
│  │  app/PiDesktopRuntime：UIState 状态机 / 载荷物化 / start() / 探活      │    │
│  │  common/Constants：端口、路径、探活参数、hilog                       │    │
│  │  ⬜ host/ 宿主能力实现 · shell/ 加载页·错误页·围栏 · panel/ 诊断面板     │    │
│  └───────────▲──────────────────────────────────────┬──────────────────┘    │
│              │ 状态/日志/宿主能力（库的 JSON 桥，非业务数据）│ 渲染            │
│  ┌───────────┴──────────────────────────────────────▼──────────────────┐    │
│  │ L2 库：NodeRuntime（detached pthread 32 MB 栈 + dlopen + node::Start）│    │
│  │     Logger / Env / HostBridge（ArkTS 侧 API）                        │    │
│  └───────────┬──────────────────────────────────────────────────────────┘    │
│              │ 同一进程（无子进程）                                           │
│  ┌───────────▼──────────────────────────────────────────────────────────┐    │
│  │ L3 Node 运行时：v24.2.0（native，platform=openharmony）                │    │
│  │     bootstrap（本工程 Node 侧启动脚本：env 装配 + 进程内 Next 宿主）     │    │
│  │     pi-dist（Next 16.3.8 非 standalone + pi agent）                    │    │
│  │     ⬜ 三个同名扩展 bash/find/grep                                     │    │
│  │     监听 127.0.0.1:<随机端口>：SPA / + /api/* + SSE                    │    │
│  └───────────┬──────────────────────────────────────────────────────────┘    │
│              │ same-origin HTTP / SSE（零 CORS、零头改写、零 IPC 载体）        │
│  ┌───────────▼──────────────────────────────────────────────────────────┐    │
│  │ L4 ArkWeb 渲染进程：标准 Pi Web UI（fetch /api/* + SSE）              │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**数据流规则**

| 方向 | 通道 | 允许承载 | 禁止承载 |
|---|---|---|---|
| L4 → L3 | 同源 HTTP / SSE | 全部业务数据（会话、消息、流式、审批、用量） | — |
| L3 → L1 | 库的日志环 / 状态查询（`NodeRuntime.getState()`、`Logger.tail()`） | 状态、日志尾、能力调用 | 业务数据镜像 |
| L1 → L3 | 库的 `HostBridge.dispatch(name, argsJson)`（⬜ Phase 2 才接实现） | 宿主能力（`perm.check`/`fs.pickFolder`/`shell.openExternal`/`notify`） | 流式内容、会话数据 |
| L2 → L3 | `env` + 启动参数（`flags`/`scriptPath`/`homeDir`/`logPath`） | 路径与运行参数 | 业务配置 |

---

## 2. 启动时序（与「为什么是这个顺序」）

```
[UI 线程] EntryAbility.onCreate
  ├─ setColorMode(COLOR_MODE_NOT_SET)          ← 跟随系统（✅）
  ├─ 读 want.parameters['probeFlags'] → AppStorage['nodeFlags']（✅）
  └─ 只记日志，**不在这里起 Node**（✅ 注释已写明口径：起 Node 在页面里做）
[UI 线程] onWindowStageCreate
  └─ windowStage.loadContent('pages/Index')    ← ✅ 先建窗/加载内容
[UI 线程] Index.aboutToAppear → launchBackend()（✅）
  ├─ ① ArkWeb 用 $rawfile('boot.html') 出首屏（必须有可见页面）
  ├─ ② PiDesktopRuntime.launch(ctx, flags)
  │     ├─ preparePayload：rawfile/selfcheck.js → <filesDir>/payload/selfcheck.js（✅）
  │     ├─ NodeRuntime.start(ctx, {scriptPath, flags})（✅ 投递语义，立即返回）
  │     └─ 探活：GET http://127.0.0.1:15577/ × 20（间隔 500 ms）（✅ 骨架；⚠️ 判据见 §3.4）
  ├─ ③ READY ⇒ controller.loadUrl('http://127.0.0.1:<port>/')（✅）
  └─ ④ FAILED ⇒ 状态条 + detail 文案（✅ 骨架；⬜ 错误页/诊断面板）
[后台线程] 库：dlopen('libnode.so') → node::Start(...) → Node 执行入口脚本（✅ 已验证）
[权限申请] ⬜（Phase 1）必须在 loadContent **之后**触发
```

| 时序决策 | 理由 | 依据 |
|---|---|---|
| **先 `loadContent`，再起 Node** | 权限弹窗在无人点按的设备上会**卡住启动屏**（`APP_INPUT_BLOCK`）；把起 Node 放到页面里可以让「状态先可见」 | 库 §5.10 第 11 条（先例做法）；✅ `EntryAbility.ets:8-10` 注释与代码一致 |
| **权限申请放在 `loadContent` 之后** | 同上；且本工程当前**没有**运行期申请权限的代码路径（权限面已声明，`user_grant` 项在首次访问时弹） | 库 §5.10 第 11 条；⬜ Phase 1 落地 |
| **起 Node 不在 onWindowStageCreate 里同步做** | `node::Start` 在 UI 线程做会 `APP_INPUT_BLOCK`（先例的旧版本因此被系统 ANR 杀掉）；库已在 detached 线程做，但**投递动作本身**也要放在用户可见状态之后 | 库 §5.10 第 1 条；✅ `PiDesktopRuntime.launch` 是 `async` 且 `start()` 立即返回 |
| **探活而不是「等 start() 返回成功」** | `start()` 返回 `ok=true` 只代表「已投递到后台线程」（✅ `Types.ets` 注释、`NodeRuntime.ets:55-59`） | 库 §6.1 状态机；规划 §4 |
| **失败立刻回退，不等满超时** | 旧壳与本工程同口径：失败要「立刻知道坏了」（先例把状态回传成 `failed:<detail>` 并立即回退） | 库 §5.10 第 14 条；规划 §4 时序 |
| **崩溃不重试、提示重启应用** | 进程内 Node 不可重启（`node::Start` 每进程一次） | 库宪法 C5、硬约束 ⑥；✅ `EntryAbility.onDestroy` 注释口径 |

---

## 3. 状态机

### 3.1 双状态机（壳的可用性 × 库的运行时）

| 壳（`PiDesktopRuntime.UIState`，✅ `PiDesktopRuntime.ets:7-12`） | 含义 | 与库状态（`NodeState`）的关系 |
|---|---|---|
| `IDLE = 'idle'` | 未启动（初始） | 库 `IDLE` |
| `LAUNCHING = 'launching'` | 已投递，等待探活 | 库 `STARTING`（`start()` 后为 `starting`） |
| `READY = 'running'` | **探活成功** | 库 `RUNNING`（由 `markRunning()` 设置，✅ `PiDesktopRuntime.ets:84`） |
| `FAILED = 'failed'` | 投递失败 / 探活超时 /（未来）崩溃 | 库 `FAILED`（`markFailed(reason)`，✅ `:90`） |

> ⚠️ **命名陷阱**：壳的 `READY` 与库的 `RUNNING` 是同义状态但字面不同（`READY = 'running'`）；
> 库的 `running` **只由消费方探活成功后 `markRunning()` 写入**，库本身不做轮询（✅ `NodeRuntime.ets:98-106`）。

### 3.2 迁移表（现状实现）

| 当前 | 事件 | 下一状态 | 触发点 | 副作用 |
|---|---|---|---|---|
| `IDLE` | `launch()` 被调用 | `LAUNCHING` | `PiDesktopRuntime.launch()` ✅ | `lastError=''`；物化载荷；`NodeRuntime.start()` |
| `LAUNCHING` | `start()` 返回 `ok=false` | `FAILED` | ✅ `launch()` | `lastError = result.message`；UI 状态条变橙 |
| `LAUNCHING` | 探活成功（GET 返回 200） | `READY` | ✅ `launch()` | `runtime.markRunning()`；`Index` 侧 `loadUrl(本地服务)` |
| `LAUNCHING` | 探活 N 次全失败 | `FAILED` | ✅ `launch()` | `runtime.markFailed('探活超时')`；`lastError` 含日志路径 |
| `READY` | 再次 `launch()` | `READY`（不变） | ✅ `launch()` 早退 | 返回 `'already running: <url>'` |
| `FAILED` | 用户点「重试」 | `FAILED`（不变） | ✅ `Index.ets:87-89` | ⚠️ 当前**只重新 `loadUrl`**，不重新探活/不重新投递 |
| 任意 | 进程内 Node 崩溃 | ⬜ 应到 `FAILED` | ⬜ Phase 1 | 当前**无法自动感知**（需读 `node.log` 的 `CRASH sig=…` 或探活失败兜住） |

### 3.3 崩溃路径（终态）

```
载荷未捕获异常（例：EADDRINUSE）→ 进程内 Node 无优雅退出路径 → 整个 App 进程 abort
（✅ 实测：Cpp Crash，崩溃栈含 libnode_bridge.so；腾出端口后同一构建正常）
```

⇒ 壳侧**不允许**实现「崩了自动重启」（宪法 A5/A8/A9）；只允许「读日志 / 读崩溃记录 / 提示重启应用」。

### 3.4 ⚠️ 骨架期探活判据与载荷不匹配（必须 Phase 1 收口）

| 事实 | 证据 |
|---|---|
| 探活请求的是 `http://127.0.0.1:<port>/`（`appUrl(port)`）并对 200 判成功 | ✅ `Constants.ets:25-27`、`PiDesktopRuntime.ets:98-117` |
| 骨架载荷 `selfcheck.js` 只对 `/facts`、`/log` 返回 200，**其余一律 404**（`server.listen` 前无 `error` 处理） | ✅ `rawfile/selfcheck.js:60-83` |
| ⇒ 用 `selfcheck.js` 当入口时，`/` 返回 **404** ⇒ 探活不可能成功 ⇒ `UIState` 到不了 `READY` | ⚠️ 代码级推断（本机**未**逐次取证） |

**收口方案（Phase 1，任选其一并写进规格）**：① 探活改为探「服务确实活着」的端点（`/facts` 或 pi-web 的 `/api/web-auth`，旧壳用后者：`src-main/main.js:858-873`）；② 直接让 `pi-web` 供应 `/`（进入真实载荷后天然满足）。**不得**只把判据改成「非 0 即成功」。

---

## 4. 必须由 ArkTS 侧重实现的能力（规划 §5 的 16 项 × 现状）

| # | 能力 | 旧壳实现（`src-main/main.js`） | 新宿主落点 | 必要性 | 现状 |
|---|---|---|---|---|---|
| 1 | 主 UI 渲染 | `BrowserWindow` + `loadURL`（`:1151`/`:1269`） | ArkWeb `Web` 组件；`domStorageAccess` + `databaseAccess` | **致命** | ✅ 骨架段（`javaScriptAccess`/`domStorageAccess`）；⬜ `databaseAccess`、清历史、返回键守卫 |
| 2 | 可写沙箱根 | `app.getPath('userData')`（`:238`/`:1189`） | `context.filesDir` | **致命** | ✅（`preparePayload` 用 `filesDir`）；⬜ `pi-agent/` 目录树与预置模板 |
| 3 | 端口与就绪 | `net.listen(0)` 探端口 + 轮询 `/api/web-auth`（`:834-873`） | Node 侧随机取端口；壳侧探活 | **致命** | ⚠️ 探活 ✅（20×500 ms），但**端口写死 15577**（违反硬约束 ⑰）；见 §3.4 |
| 4 | 鉴权 | `session.cookies.set`（`:897`）+ `onBeforeSendHeaders` 注入 Basic（`:911`） | 见 §5 | 高 | ⬜ Phase 1 |
| 5 | 载荷投放与就绪 | `tar-extract.js` + SHA-256 marker | 库（`archive` 选项）+ 本工程载荷投放脚本 | 高 | ⬜ Phase 1（当前只物化 `selfcheck.js`）；`resfile/pi-web/` 仅 README |
| 6 | 环境装配 | `assembleSandboxEnv()`（`:237-307`） | Node 侧启动脚本 + 库原生层（`HOME`/`TMPDIR`） | 高 | 部分 ✅（库原生层设 `HOME/USERPROFILE/TMPDIR/TMP/TEMP/NODE_ENV`、清 `NODE_OPTIONS`）；⬜ `PI_*`（见 `overall-data-model.md` §3） |
| 7 | 窗口生命周期/状态记忆 | `BrowserWindow` 尺寸/位置 + `window-state.json` | ArkTS `window` API + `preferences` | 中 | ⬜ Phase 2 |
| 8 | 外链 | `shell.openExternal`（`:1111`）+ 外链页 | `startAbility(viewData)` 或**真正注册**的外链能力（⚠️ 不得照抄旧壳死代码 `ExternalWeb.Open`，调用即 SIGSEGV） | 中 | ⬜ Phase 2 |
| 9 | 权限预检 / 去系统设置 | `systemPreferences.checkPermission` / `openApplicationInfoEntry`（`:374-408`） | 库宿主桥 `perm.*`（ArkTS 实现） | 中 | ⬜ Phase 2（`HostBridge` 目前是纯 JS 骨架，库 §5.4） |
| 10 | 工作区目录选择与主目录清单 | 硬编码用户目录 + `PI_HOS_ROOTS`（`:339-357`） | ArkTS 选择器 + `fs.pickFolder` 桥 → 回传沙箱路径/授权目录 | 中 | ⬜ Phase 2（O8） |
| 11 | 导航围栏 / 弹窗拦截 | `setWindowOpenHandler`（`:1122`）+ `will-navigate`（`:1129`） | ArkWeb `onWindowNew` / `onLoadIntercept`（+ `isMainFrame()`）+ 真正注册的外链能力 | 中 | ⬜ Phase 1–2 |
| 12 | 加载页与失败可见 | `data:` loading 页 + `setTitle` 阶段文本（`:68-107`/`:153`） | **ArkTS 加载页**（ArkWeb 之上叠 ArkTS 视图）+ 错误页 + 诊断面板 | 中 | 部分 ✅（`boot.html` + 状态条 + detail 文本）；⬜ ArkTS 加载页/错误页/诊断面板（`Index.ets:70` 明标 Phase 1） |
| 13 | 优雅关停 | `before-quit` → `server.close()`（`:1304-1314`） | `EntryAbility.onPrepareToTerminate` → `runtime.shutdown()`（触发 Node 侧钩子） | 中 | ⬜ Phase 2（当前 `onDestroy` 只记日志；Node 侧无优雅停止路径的现状也要如实写） |
| 14 | 非安全上下文开关 | `appendSwitch('unsafely-treat-insecure-origin-as-secure')`（`:222`） | **本工程不需要**（只加载 loopback 本地页，不加载外部站点） | 中 | ✅ 设计上不需要；⬜ P0-3 复核「loopback 下 `crypto.subtle` 是否可用」 |
| 15 | 托盘/状态栏、通知、对话框 | 旧壳**未使用** | v1 不做；需要时走 ArkTS（`statusBarManager`/`notificationManager`）+ 宿主桥 `notify` | 低 | ⬜ v1 不做（`CUSTOM_SCREEN_CAPTURE` 等权限已声明，能力未接） |
| 16 | 单实例 / 深链 | ArkTS 侧已有（`launchType: specified`） | 本工程应为 **`launchType: singleton`**（⑰：多实例互抢端口与数据目录） | 低 | ⚠️ `module.json5` **未显式声明** `launchType`（见 `STRUCTURE.md` §2.3） |

> ✅ 已落地的骨架范围 = 第 1/2/3/5/6/12/16 条的**骨架**（与规划 §5 末尾的说明一致），但其中 3/12/16 只到「部分」：分别缺随机端口、ArkTS 加载页、显式单实例。

---

## 5. 鉴权两条路线的架构位置（规划 §6.2）

| 路线 | 架构位置 | 触发条件 | 需要的组件 | 现状 |
|---|---|---|---|---|
| **① loopback 免密（首选）** | Node 侧：服务只 `listen('127.0.0.1', <随机端口>)`；**不设** `PI_WEB_PASSWORD` ⇒ 上游整体关闭认证（✅ `pi-web/lib/web-auth.ts:15-19`）；Host 围栏对 loopback 直接放行（✅ `lib/request-security.ts:90-102`） | 默认 | 仅需壳侧正确拼 URL 并探活 | ⬜ Phase 1（P0-3 待实测 ArkWeb 能否访问 `127.0.0.1`；🔶 先例已在售） |
| **② 局域网 + 密码 + Cookie（回退）** | Node 侧：绑 `0.0.0.0` + `PI_WEB_HOSTNAME=局域网 IP` + 随机强密码 + 派生会话 cookie `v1.<exp>.<nonce>.<HMAC-SHA256(密码)>`（算法镜像上游，旧壳 `createSessionToken` 同款）；**壳侧：把 cookie 写进 ArkWeb** | 路线 ① 被证伪时 | ArkWeb Cookie 管理 API（⬜ 待实测，P0-3）+ 密码派生 | ⬜ 未实现 |

**两条路线的共同纪律**：不改上游、不加 preload 桥、不引入 IPC 载体（宪法 A1）；鉴权**只决定服务监听在哪里与是否要 cookie**，不在壳里做业务鉴权。

---

## 6. 载荷形态两条路线与可写缓存外置

| 路线 | 载荷在哪 | 谁读 | 首启代价 | 何时选 |
|---|---|---|---|---|
| **① 只读直读（首选）** | `entry/src/main/resources/resfile/pi-web/`（安装目录，只读） | Node 直接读安装目录 | **零解压**（只花起服务与建窗时间） | Next 运行期不需要写自己的目录时 |
| **② `tar.gz` + Node 自解包** | 随 `rawfile` 投放，Node 用 `zlib`+`fs` 解到 `<filesDir>/…`，SHA-256 marker 幂等 | Node 读沙箱 | 解 ≈27.2k 文件（🔶 旧壳首启到就绪约 15 s） | 载荷**必须可写**时 |

**可写外置策略（两条路线都用）**

```
只读载荷（安装目录，或沙箱内已解包）
        │
        ├── 可写缓存  → <filesDir>/pi-web-cache（NEXT_* / TMPDIR 指过去）
        ├── 会话与凭据 → <filesDir>/pi-agent（PI_CODING_AGENT_DIR）
        └── 日志      → <filesDir>/payload/{node.log, app.log}
```

- **禁止**「因为要写缓存就把整份载荷再解一份」（规划 §7.1）；
- **禁止**用 OHOS 侧解压器写业务文件（谁写谁读，库宪法 C3）；
- 幂等判据必须是**内容级**（SHA-256 marker），不是「目录存在」——后者会导致就地升级不生效（🔶 旧壳教训）。

---

## 7. 关键架构决策表

| 决策 | 理由 | 替代方案（为何不选） |
|---|---|---|
| 用**进程内** Node（库）而不是子进程 | 平台封死子进程 JIT/`execve`；子进程事件不可靠 | 子进程 Node（不可用）；纯 ArkTS 重写业务（工作量与上游漂移不可接受） |
| 主界面用 **ArkWeb 加载本地服务页** | 合规正面对上 G1；复用上游 UI 零改写；同源零 CORS | 随包 Chromium（合规 P0 + 181 MB）；纯 ArkTS 重写 UI（等于重写 pi-web） |
| 前后端**只走同源 HTTP/SSE** | 上游天然同源；无头改写、无 CORS、无 IPC | preload 桥/IPC（宪法 A1 禁；旧壳 `callArkTSFunction` 的教训） |
| 鉴权**首选 loopback 免密** | 攻击面最小（同机其它应用）；上游直接放行 | 一律启用密码（需 Cookie 注入 + 局域网暴露面） |
| 载荷**优先只读直读** | 免掉首启解压耗时与失败面 | 一律 `tar.gz`（多一次解包失败面；仅在必须可写时用） |
| **ACL 按本包名申请**（不绕行） | 路线 J′ 绕行违反 G11，属上架红线 | 自签 + 预签名模板 + `mremap`（物理隔离，不进发布物） |
| 端口**随机/先探测空闲** + 单实例 | 端口冲突 ⇒ 整进程 abort（✅ 实测） | 固定端口（现状，⚠️ 待改）；固定端口 + 单实例仍会被「别的应用占端口」打死 |
| 载荷**异常兜底 + 独立日志** | 未捕获异常 = 应用级事故；`node.log` 混入 ArkWeb 原生输出 | 只靠 stdout（现状，⬜ 待改） |
| 库以 **ohpm 包（HAR）** 消费 | OHM 归一化下拒绝跨工程源码相对导入（`00309001`）；库已上架中心仓 ⇒ `ohpm install` 即得 | 源码目录相对导入（编译失败）；`file:` 本地 HAR 旁路（已退役） |

---

## 8. 与库的责任分界

| 面 | 库（`@fellow99/node-bridge`）负责 | 本工程负责 |
|---|---|---|
| 运行时 | `dlopen` + `node::Start`、单例状态机、启动参数、SIGSYS shim、崩溃取证 | 无（**不写 C++**，宪法 A2） |
| 载荷 | `scriptPath`/`libDir`/`homeDir`/`logPath` 选项、幂等保护、CJS/ESM 入口解析（⬜ 库规划 §6.1 另承诺 `entry`/`payloadRoot`/`archive`/`cwd`/`env`，⚠️ 当前 `Types.ets` 只有 5 个字段，见 `overall-data-model.md` §3 备注） | 载荷内容与裁剪、投放时机、首启加载页 |
| 观测 | 日志环 + hilog + `lastCrash()` + `/facts` 自检端点（库侧） | 诊断面板、错误页、阶段文案、真机取证 |
| 宿主能力 | 桥的**传输层**（线程安全 JSON、超时、未注册即报错；⬜ 当前 `dispatch` 仍是同线程直调，库 §5.4） | 每个能力的**实现**（权限、选择器、外链、通知） |
| 渲染 | **不参与** | ArkWeb `Web` 组件、加载页、Cookie 注入、导航围栏 |
| 生命周期 | `start()` / `waitUntilRunning()` / `shutdown()`（⬜ 后两者库侧未实现，`NodeRuntime.ets` 只有 `start`/`markRunning`/`markFailed`/`isRunning`） | `onPrepareToTerminate` 接线、失败态 UX |
| 平台真相 | 如实上报能力标志（不静默降级） | 把失败暴露到 UI（可截图、可断言） |

**壳的调用面（当前实际使用，✅ 逐处核实）**：`NodeRuntime.getInstance()` / `start(context, {scriptPath, flags})` / `markRunning()` / `markFailed(reason)` / `getState()` / `getLogPath()`；`Env.ensureDir(path)` / `materializeRawfile(mgr, name, dest)`；`NodeStartResult`；`NodeState`。⬜ 未使用但已导出：`HostBridge`、`Logger`（`Index.ets:70` 计划用它读日志尾）。

---

## 9. 合规架构位置（G1/G3 × 渲染链）

| 合规项 | 架构上的落点 | 现状 |
|---|---|---|
| **G1 用 ArkWeb 渲染** | L4 就是 ArkWeb 渲染进程；L1 用 `Web` 组件承载；**没有**第二套渲染内核 | ✅ 形态成立 |
| **G3 包内无第三方浏览器内核** | 包内原生件只有 `libnode.so`（Node 运行时）+ `libnode_bridge.so`（库引导件）+ `libc++_shared.so` | ✅ 形态成立；✅ Phase 3 产物核对已做（2026-10-17）：HAP 内 `libs/` 清单 3 个 `.so` + `compress_type` 全为 `8`（DEFLATE），签名 HAP 46,031,244 B |
| **G2 无浏览器语义** | `module.json5` 的 `skills` 只有桌面入口，**没有** `browsable`/`viewData` | ✅ |
| **G9 PoC 清理** | 上架前移除 `--inspect`、诊断开关、`selfcheck` 载荷的 `/facts`、`/log` 调试端点 | ⬜ Phase 3（这些端点目前是**唯一**可读回的取证通道，Phase 1–2 必须保留） |
| **G11 不绕行** | 架构上不存在绕过签名/可执行内存控制的组件（依赖 ACL 正路） | ✅ |

**审核材料口径（预先备好，规划 §13 G1）**：「主界面是应用自带的本地界面，由 ArkWeb 组件加载本机服务，非浏览器上网」。
**架构支撑要点**：① 只加载 `http://127.0.0.1:<端口>/`（同一进程内的本地服务），不加载外部站点；② 外链一律交系统浏览器或在应用内承载（不做浏览器功能）；③ 渲染进程只在应用窗口内（无多窗口/无标签页语义）。
