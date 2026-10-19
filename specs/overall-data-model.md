# overall-data-model.md —— `pi-desktop-ark` 数据模型

> 本文只写**数据与状态**：壳侧常量/状态、状态机迁移、环境变量契约、文件系统布局、权限模型、载荷体积、HTTP 数据面。
> 依据：规划 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) **§6.3 / §7.2 / §7.4 / §10**；库文档 `../../ohos-node-bridge/docs/000-工程规划.md` **§6.2 共享事实 / §D.8 偏差表 / §D.10 ⑰⑱**；本工程实测 [`../docs/ACL配置.md`](../docs/ACL配置.md)。
> 标注：**✅ 已落地**（含 `path:line`）/ **⬜ 规划未实现（Phase N）**。

---

## 1. ArkTS 侧状态与常量模型（✅ as-built）

### 1.1 常量（`entry/src/main/ets/common/Constants.ets`）

| 名称 | 类型 | 值 | 语义 | 备注 |
|---|---|---|---|---|
| `DEFAULT_PORT` | `number` | `15577` | 壳侧探活与 URL 拼接用的端口 | ⚠️ **写死**，违反硬约束 ⑰（端口必须随机/先探测空闲）；与探针工程默认端口相同 ⇒ 必须 `aa force-stop org.fellow99.test.NodeProbe` 否则冲突 |
| `PAYLOAD_DIR` | `string` | `'payload'` | 沙箱内载荷目录（相对 `<filesDir>`） | 与库的 `Env.payloadDir()` = `<filesDir>/payload` 同值 |
| `PAYLOAD_ENTRY` | `string` | `'selfcheck.js'` | 骨架期载荷入口（rawfile 名 = 落盘文件名） | ⬜ Phase 1 改为载荷入口（`resfile` 直读路径） |
| `PROBE_ATTEMPTS` | `number` | `20` | 探活次数上限 | 与 `PROBE_INTERVAL_MS` 相乘 = 10 s 上限 |
| `PROBE_INTERVAL_MS` | `number` | `500` | 探活间隔 | 固定间隔（非指数退避） |
| `DOMAIN` / `TAG` | `number`/`string` | `0xD0033` / `'PI_DESKTOP_ARK'` | hilog 域与标签 | 库用同 DOMAIN、TAG `NODE_BRIDGE` ⇒ 一条 `hilog` 命令可抓全链 |
| `appUrl(port)` | `(number)=>string` | `http://127.0.0.1:<port>/` | 端上渲染入口 | 同时被探活复用 ⇒ **探活判据与渲染入口耦合**（见 `ARCHITECTURE.md` §3.4 的 ⚠️） |

### 1.2 壳侧状态枚举（`PiDesktopRuntime.ets:7-12`）

| 枚举 | 字符串值 | 语义 |
|---|---|---|
| `UIState.IDLE` | `'idle'` | 未启动 |
| `UIState.LAUNCHING` | `'launching'` | 已投递、等待探活 |
| `UIState.READY` | `'running'` | 探活成功（⚠️ 与库 `NodeState.RUNNING` 同字面值，语义同位） |
| `UIState.FAILED` | `'failed'` | 投递失败 / 探活超时 /（⬜）崩溃 |

`PiDesktopRuntime` 单例字段：`state: UIState`（初始 `IDLE`）、`port: number`（初始 `DEFAULT_PORT`）、`lastError: string`（初始 `''`）；只读访问器 `getState()` / `getPort()` / `getLastError()` / `getUrl()`。

### 1.3 库侧类型（消费面，✅ 逐项核实于 `ohos-node-bridge/library`）

| 类型/成员 | 形态 | 本工程用法 |
|---|---|---|
| `NodeState` | `'idle' \| 'starting' \| 'running' \| 'failed'` | 与壳状态并列存在；`failed` 是终态 |
| `NodeRuntimeOptions` | `flags?` / `scriptPath`(必填) / `libDir?` / `homeDir?` / `logPath?` | 本工程只传 `{scriptPath, flags}`（其余取库默认：`libDir=bundleCodeDir`、`homeDir=filesDir`、`logPath=<homeDir>/payload/node.log`） |
| `NodeStartResult` | `{ok, code, state, message}` | `ok=true` 只代表**已投递**；`code` 非 0 时是 `pthread_create` 错误码（`-1` 表示「状态不允许再启动」） |
| `NodeRuntime`（API） | `getInstance()` / `start(context, options)` / `getState()` / `isRunning()` / `bridgeVersion()` / `getLogPath()` / `getOptions()` / `markRunning()` / `markFailed(reason)` | 本工程用到 6 个（⬜ `isRunning()`/`bridgeVersion()` 尚未用于诊断面板） |
| `Env`（API） | `payloadDir(ctx)` / `tmpDir(ctx)` / `logPath(ctx)` / `ensureDir(path)` / `ensureRuntimeDirs(ctx)` / `materializeRawfile(mgr, name, dest)` | 本工程用 `ensureDir` + `materializeRawfile` |
| `Logger`（API） | `info/warn/error` + `tail(path, maxBytes)` | ⬜ `Index.ets:70` 计划用于日志面板（当前是占位文案） |
| `HostBridge`（API） | `register(name, handler)` / `list()` / `dispatch(name, argsJson)` | ⬜ Phase 2 才接实现 |

> ⚠️ **契约缺口（代码级事实）**：库规划 §6.1 承诺载荷接口含 `entry`/`payloadRoot`/`archive`/`cwd`/`env` 选项，
> 但库当前 `Types.ets` 的 `NodeRuntimeOptions` **只有 5 个字段**（无 `env`/无 `archive`）。
> ⇒ 本工程的环境装配（§3）**只能**由 payload 自己在 JS 里 `process.env.X = …` 完成，或先向库提需求。
> 这条必须在 Phase 1 与库对齐（**不得**在壳侧假设库会帮我们设 `PI_*`）。

### 1.4 键值通道

| 键 / 通道 | 类型 | 生产者 | 消费者 | 语义 |
|---|---|---|---|---|
| `want.parameters['probeFlags']` | `string` | 启动方（`aa start … --ps probeFlags "…"`） | `EntryAbility.onCreate` | Node 命令行参数（调试期覆盖默认值）；空串无效（回退默认） |
| `AppStorage['nodeFlags']` | `string` | `EntryAbility.onCreate`（✅ `:34`） | `pages/Index`（✅ `:47-48`） | 生效的 Node 参数；页面未读到（`undefined`）时回退 `'--no-verify-heap'` |
| 默认 flags | `string` | 壳（两处默认值相同：`EntryAbility.ets:23`、`Index.ets:48`） | 库 | `'--no-verify-heap'`；**无 ACL 时必须显式传 `--jitless`**（代价 = WASM 全废） |
| ⬜ `payload/port`（规划通道） | 文本 | Node 侧（`listen` 成功后写实际端口） | 壳侧探活与 `loadUrl` | 随机端口方案的必要回传通道（**不得**让壳猜端口） |
| ⬜ `preferences`（规划） | KV | 壳 | 壳 | 窗口尺寸/位置（Phase 2 最小版） |

---

## 2. 状态机迁移表

| # | 当前状态 | 事件 | 触发者（✅/⬜） | 新状态 | 副作用 / 可观测痕迹 |
|---|---|---|---|---|---|
| M1 | `IDLE` | 页面挂载后调用 `launch()` | ✅ `Index.aboutToAppear → launchBackend` | `LAUNCHING` | `lastError=''`；`hilog`：`launch: flags=… script=…`；UI 状态条=launching |
| M2 | `LAUNCHING` | 载荷物化成功 | ✅ `preparePayload` | `LAUNCHING` | `hilog`：`载荷已物化：<filesDir>/payload/selfcheck.js`；文件系统出现该文件 |
| M3 | `LAUNCHING` | 载荷物化失败 | ✅（不中断） | `LAUNCHING` | `hilog`：`载荷物化失败（Node 将按原路径启动并在 node.log 报错）`；**不抛异常**（设计如此：让 Node 报更准的错） |
| M4 | `LAUNCHING` | `start()` 返回 `ok=false` | ✅ `launch()` | `FAILED` | `lastError = message`；UI 变橙；返回串 `FAILED: …` |
| M5 | `LAUNCHING` | 探活第 k 次成功（HTTP 200） | ✅ `probeReady` | `READY` | `runtime.markRunning()`（库状态 → `running`）；`hilog`：`READY: http://127.0.0.1:15577/`；`Index` 执行 `controller.loadUrl(url)` |
| M6 | `LAUNCHING` | 20 次探活全失败 | ✅ `probeReady` | `FAILED` | `runtime.markFailed('探活超时')`；`lastError` 含尝试次数/间隔/`node.log` 路径 |
| M7 | `READY` | 再次 `launch()` | ✅（早退） | `READY` | 返回 `already running: <url>`（幂等） |
| M8 | `FAILED` | 用户点「重试」 | ✅ `Index.ets:87-89` | `FAILED`（不变） | ⚠️ 仅 `loadUrl(url)`，**不重新探活/不重新投递**；语义待按宪法 A5 收敛 |
| M9 | 任意 | 进程内 Node 崩溃（如 `EADDRINUSE`） | ⬜ | ⬜ 应 `FAILED` | 当前表现：**整个 App 进程 abort**（✅ 实测）；Phase 1 需靠载荷兜底 + 探活失败兜住 + 终态文案 |
| M10 | 任意 | 应用退出 | ✅ `onDestroy` 只记日志 | 进程结束 | ⬜ `onPrepareToTerminate → runtime.shutdown()`（库侧 `shutdown()` 亦未实现） |

**不变式**：库 `node::Start` 每进程一次 ⇒ `M1` 全生命周期内只能成功一次；`FAILED` 为**吸引态**（除 M8 这种「原地重试」外无出边）。

---

## 3. 环境变量契约表（规划 §7.4 全表 + 实测落点）

**「谁设」列的口径**：`库` = 库原生层 `setenv/unsetenv`（✅ 实测于 `library/src/main/cpp/node_bridge.c:142-149`）；
`本工程` = 必须由**本工程**提供（当前唯一可行落点是 payload 在 JS 里赋值，见 §1.3 的契约缺口备注）。

| 变量 | 值 | 谁设 | 为什么 | 状态 |
|---|---|---|---|---|
| `HOME` | `<filesDir>`（真机实测 `/data/storage/el2/base/haps/entry/files`） | **库** | 真机 `homedir()` 默认落在沙箱外不可写目录 ⇒ 不重定向会全线 `EPERM` | ✅ 库已设 |
| `USERPROFILE` | 同 `HOME` | **库** | 兼容按 Windows 习惯取该变量的代码路径 | ✅ 库已设 |
| `TMPDIR` | `<filesDir>/tmp` | **库** | 临时文件必须落沙箱 | ✅ 库已设（`/facts` 报 `tmpdir=/data/storage/el2/base/haps/entry/files/tmp`） |
| `TMP` / `TEMP` | 同 `TMPDIR` | **库** | 同上（跨平台命名） | ✅ 库已设 |
| `NODE_ENV` | `production` | **库** | 避免 Next/依赖走 dev 分支 | ✅ 库已设 |
| `NODE_OPTIONS` | **清空**（`unsetenv`） | **库** | 外来 `NODE_OPTIONS` 会改变 V8/加载行为，破坏可复现性 | ✅ 库已清 |
| `UV_USE_IO_URING` | `0` | **库** | 规避 libuv 的 io_uring 路径（防御性；本机 `io_uring_setup` 返回 8，未见 seccomp trap） | ✅ 库已设 |
| `PI_CODING_AGENT_DIR` | `<filesDir>/pi-agent` | **本工程** | agent 的数据根：会话/凭据/扩展/技能/模板全在这里（§4.3） | ⬜ |
| `PI_OFFLINE` | `1` | **本工程** | 设备无 `npm`/`git`；禁止插件联网安装与 `fd`/`rg` 下载（被禁止的行为必须**可见**） | ⬜ |
| `PI_WEB_HOSTNAME` | 路线 ① **不设**；路线 ② = 局域网 IP | **本工程** | 上游用它做 Host 白名单（`lib/request-security.ts`）；路线 ① 只需 loopback | ⬜ |
| `PI_WEB_PORT` | 路线 ① **不设**（端口由服务端随机/先探测空闲后取）；路线 ② 同 | **本工程** | 硬约束 ⑰；端口必须以「实际监听值」回传壳（§1.4 `payload/port`） | ⬜ |
| `PI_WEB_PASSWORD` | 路线 ① **不设**（⇒ 上游认证整体关闭）；路线 ② 随机强密码（32 字节 → base64url 43 字符） | **本工程** | 路线 ① 攻击面 = 同机其它应用；路线 ② 是 LAN 暴露下的唯一闸门 | ⬜ |
| `PI_HOS_ROOTS` | 桌面/文档/下载三个**已授权**目录（由选择器/授权结果填充） | **本工程** | 旧壳用它给「选择工作目录」对话框填主目录；本工程由 `fs.pickFolder` 桥供数（O8） | ⬜（格式需按旧壳 `installWorkspaceRoots` 复核） |
| `NO_PROXY` / `no_proxy` | 追加 `127.0.0.1`、`localhost`、（路线 ② 时）局域网 IP | **本工程** | 系统代理会让「访问本机服务」走代理而失败 | ⬜ |
| `SELFCHECK_PORT` | （仅骨架载荷读）默认 `15577` | 骨架载荷 | `rawfile/selfcheck.js:18` | ✅（骨架期专用，Phase 1 移除） |
| ⬜ `PI_WEB_SKIP_VERSION_CHECK` / `PI_WEB_APP_NAME` | `1` / `Pi Desktop` | 本工程（待定稿） | 旧壳用它关闭「检测新版本」并钉住 PWA 显示名（上游有运行时开关） | ⬜ 待定（品牌化项，Phase 1） |
| ⬜ `PI_DESKTOP_PASSWORD` | 调试用固定密码 | 本工程（**仅调试**） | 旧壳的调试后门；会出现在环境变量与日志里 ⇒ **不得进 release** | ⬜ 明确禁止（宪法 A5/T9） |

**纪律**：本表任何一行若「谁设=本工程」，都必须有**一处**明确落点（payload 启动脚本 / 库 `env` 选项 / 原生层）；不允许「某个环节顺手设一下」。

---

## 4. 文件系统实体与目录布局

### 4.1 真机路径基线（✅ 来自 `/facts` 与旧壳同形态观测）

| 实体 | 真机路径 | 证据 |
|---|---|---|
| `<filesDir>`（= `HOME`） | `/data/storage/el2/base/haps/entry/files` | ✅ `/facts` 的 `homedir` |
| `<filesDir>/tmp`（= `TMPDIR`） | `/data/storage/el2/base/haps/entry/files/tmp` | ✅ `/facts` 的 `tmpdir` |
| 沙箱卷 | `hmfs`（`chmod` 如实回读；支持硬链接） | 🔶 旧壳能力清单 #10/#12 |
| 用户目录卷 | `/storage/Users/currentUser{,/Desktop,/Documents,/Download}` = `hmdfs`，**应用直写一律 `EPERM`**，需 OS 授权 + 重启 | 🔶 旧壳 #14 |
| 包内原生库 | 安装目录 `.../libs/arm64/`（`dlopen` 只认**裸名** `libnode.so`） | ✅ 库 §D.8 偏差表 |

### 4.2 目录与文件清单

```
<filesDir>/                                  # 沙箱根（可写）           [✅ 存在]
├── payload/                                 # 载荷与日志              [✅]
│   ├── selfcheck.js                         #  骨架期入口（rawfile 物化）[✅]
│   ├── node.log                             #  库默认日志（fd1/fd2 dup2）[✅ 含 ArkWeb 原生噪声]
│   ├── app.log                              #  ⬜ 载荷自己的结构化日志（⑱）
│   └── port                                 #  ⬜ 实际监听端口回传（硬约束 ⑰）
├── tmp/                                     # TMPDIR/TMP/TEMP → 库自动建 [✅ 库 ensureRuntimeDirs]
├── pi-agent/                                # PI_CODING_AGENT_DIR      [⬜ 待建]
│   ├── sessions/<cwd-slug>/<ts>_<sid>.jsonl #  会话落点（JSONL）        [⬜]
│   ├── settings.json                        #  预置模板（缺失才写）     [⬜]
│   ├── mcp.json                             #  预置模板                [⬜]
│   ├── extensions/                          #  同名扩展落点            [⬜]
│   ├── skills/ · prompts/ · themes/ · agents/ · tmp/                     [⬜]
├── pi-cwd/                                  # ⬜ 默认工作目录（旧壳口径）
└── pi-web-cache/                            # ⬜ 可写缓存外置点（NEXT_*/TMPDIR 指向它）

entry/src/main/resources/                    # 随包（只读）
├── rawfile/{boot.html, selfcheck.js}        # ArkTS 侧读 + 物化            [✅]
└── resfile/pi-web/**                        # 载荷只读直读落点（安装目录）  [⬜ 仅 README]

⬜ 幂等 marker（tar.gz 路线才需要）：<filesDir>/pi-web.sha256（内容 = 已解包归档的 SHA-256）
   —— 判据必须是**内容级**；「目录存在」不算（🔶 旧壳教训）
```

### 4.3 会话与凭据落点

| 数据 | 落点 | 说明 |
|---|---|---|
| 会话记录（JSONL） | `<filesDir>/pi-agent/sessions/<cwd-slug>/<ts>_<sid>.jsonl` | 🔶 旧壳同形态实测样例：`pi-agent/sessions/--data-…-pi-workspace-test--/<ts>_<sid>.jsonl`（8 行含 `session`/`model_change`/`thinking_level_change`/`message×5`） |
| 模型凭据 | `<filesDir>/pi-agent/`（具体文件名由 `pi` 决定） | **不得**进日志/崩溃记录/导出物（NFR-ARK-011） |
| 崩溃取证 | `<filesDir>/payload/node.log` 内的 `CRASH sig=… si_addr=… pc=… lr=…` | 由库原生 handler 追加；`hdc` 读不到沙箱文件 ⇒ 必须经 `/log` 读回 |
| 导出物 | ⬜ 用户可导出会话（上游「导出」能力）；导出目标是**用户可见位置**，需授权 |

### 4.4 沙箱文件能力约束（决定实现方式）

| 能力 | 结论 | 对本工程的含义 |
|---|---|---|
| `symlink` | ❌（应用域 `EACCES`） | 一切资源物化用 **copy**，**不得** symlink |
| 硬链接 | ✅（沙箱 `hmfs`） | 可用于同卷去重（可选） |
| 原子写 | ✅（临时文件 + `rename`） | 写配置/会话的推荐方式 |
| 用户目录直写 | ❌（需 OS 授权 + 重启） | 降级提示（宪法 A6） |
| `chmod` | ✅ 如实回读 | 敏感文件可收紧权限 |

---

## 5. 权限数据模型（声明面 ✅ as-built）

### 5.1 总量与配对关系

| 项 | 数量 | 说明 |
|---|---|---|
| `requestPermissions` | **24** | `web_engine` 的 23 项 + `electron` 模块的 `KEEP_BACKGROUND_RUNNING`；与 `pi-desktop-hos` **逐项一致**（脚本比对，无多无少） |
| 其中带 `reason` + `usedScene` | **8** | 文案取自旧壳 `web_engine` 资源，**逐字节一致**；`usedScene = {abilities:["EntryAbility"], when:"inuse"}` |
| `definePermissions` | **2** | `LOCK_WINDOW_CURSOR`、`kernel.ALLOW_WRITABLE_CODE_MEMORY`（与 `requestPermissions` **成对出现**） |
| `backgroundModes` | **1** | `["taskKeeping"]`（配合 `KEEP_BACKGROUND_RUNNING`） |
| **ACL（受限权限，按本包名申请）** | **3** | 见下表 ★ |

### 5.2 逐项分类（分组依据：`docs/ACL配置.md` §1 + `module.json5` 注释 + 规划 §10）

| # | 权限 | 分组 | 用途 | 声明位置（`entry/src/main/module.json5`） |
|---|---|---|---|---|
| 1 | `ohos.permission.INTERNET` | 开放 | 模型接口出网 | `:52` |
| 2 | `ohos.permission.GET_NETWORK_INFO` | 开放 | 网络状态/局域网地址判定（路线 ②） | `:53` |
| 3 | `ohos.permission.ACCESS_CERT_MANAGER` | 开放 | 证书管理（旧壳 Web 引擎能力面） | `:54` |
| 4 | `ohos.permission.RUNNING_LOCK` | 开放 | 长时任务运行锁 | `:55` |
| 5 | `ohos.permission.PRINT` | 开放 | 打印（旧壳能力面，当前未用） | `:56` |
| 6 | `ohos.permission.PREPARE_APP_TERMINATE` | 开放 | 关停前回调（`onPrepareToTerminate`，规划 §5 第 13 条） | `:57` |
| 7 | `ohos.permission.ACCESS_BIOMETRIC` | 开放 | 生物识别（旧壳能力面，当前未用） | `:58` |
| 8 | `ohos.permission.FILE_ACCESS_PERSIST` | **已撤销（2026-10-19，REV-6）** | 原：持久化文件访问（用户目录授权留存） | 已删除 |
| 9 | `ohos.permission.PRIVACY_WINDOW` | 开放 | 隐私窗口/防截屏（当前未用） | `:60` |
| 10 | `ohos.permission.WINDOW_TOPMOST` | 开放 | 窗口置顶（当前未用） | `:61` |
| 11 | `ohos.permission.KEEP_BACKGROUND_RUNNING` | 开放 | 长时任务（`taskKeeping`，agent 长任务不被挂起） | `:64` |
| 12 | `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` | ★ **ACL 1/3** | 进程内 Node/V8 的 **JIT**（无它走 JIT 即 SIGTRAP）；**不能用开放权限替代** | `:65` |
| 13 | `ohos.permission.INHERIT_PARENT_PERMISSION` | 开放（带 reason） | 随包运行时继承父进程权限 | `:67-76` |
| 14 | `ohos.permission.kernel.IGNORE_LIBRARY_VALIDATION` | 开放（带 reason） | 加载随包签名原生库时跳过库校验 | `:78-87` |
| 15 | `ohos.permission.kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY` | 开放（带 reason） | 随包运行时申请匿名可执行内存（辅助；✅ 实测**不能**替代 #12） | `:89-98` |
| 16 | `ohos.permission.GYROSCOPE` | 开放 | 传感器（旧壳能力面） | `:99` |
| 17 | `ohos.permission.ACCELEROMETER` | 开放 | 传感器（旧壳能力面） | `:100` |
| 18 | `ohos.permission.GET_FILE_ICON` | 开放 | 文件图标（选择器展示） | `:101` |
| 19 | `ohos.permission.LOCK_WINDOW_CURSOR` | 开放 + `definePermissions` | 锁定光标（旧壳 Web 引擎需要） | `:102` / `:159` |
| 20 | `ohos.permission.READ_PASTEBOARD` | **已撤销（2026-10-19）**：原 ★ ACL 2/3，真机证明 ArkWeb 自行读剪贴板 | 页面粘贴（DOM `paste` 事件）不需应用侧读剪贴板 | 删除（原 `:104-113`） |
| 21 | `ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY` | **已撤销（2026-10-19，REV-6）** | 原：下载目录读写 | 已删除 |
| 22 | `ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY` | **已撤销（2026-10-19，REV-6）** | 原：文档目录读写 | 已删除 |
| 23 | `ohos.permission.READ_WRITE_DESKTOP_DIRECTORY` | ★ **ACL 3/3**（user_grant） | 桌面目录读写（工作目录可能在此） | `:135-144` |
| 24 | `ohos.permission.CUSTOM_SCREEN_CAPTURE` | 开放（带 reason） | 应用内截图 | `:145-154` |

> ⬜ **待复核**：逐项的 `level` / `provisionEnable` 未在本工程逐条核对（分组口径来自 `docs/ACL配置.md` 的判定规则与旧壳清单）；
> Phase 3 出上架材料时应按 AGC「权限列表」逐项复核并写回 `docs/ACL配置.md`。

### 5.3 授权面（Profile）与运行期

| 面 | 内容 | 判据 |
|---|---|---|
| Profile 必须包含 | 现役 **1 项 ACL**（`kernel.ALLOW_WRITABLE_CODE_MEMORY`）；目录授权与 `FILE_ACCESS_PERSIST` 已于 2026-10-19 全部撤销（Profile 保留旧条目无害） | `hdc install -r` 成功；历史失败样例：`code:9568289 / PermissionName: ohos.permission.READ_PASTEBOARD` |
| 运行期申请（`user_grant`） | **本版已无**（剪贴板与三个目录均已撤销）；`perm.request` 能力保留给未来新增 `user_grant` 项 | ✅ 无需首屏后申请，`APP_INPUT_BLOCK` 风险随之消失 |
| 拒绝后的行为 | 界面提示「未授权 + 去系统设置」；**不得**伪造成功 | ⬜ |

---

## 6. 载荷体积数据模型

### 6.1 现状（✅ 本机实测）

| 实体 | 数值 | 来源 |
|---|---|---|
| `pi-dist` 总量 | **884,167,367 B** / ≈**27.2k** 文件 | `du -sb` |
| `pi-dist` → `tar.gz` | **156,592,393 B**（≈149 MiB） | `stat` |
| 库产物 `libnode.so` | 126,809,264 B（部署名；上游名 `libnode-arm64.so`；SHA-256 `3019bf5f…51a1`） | `entry/libs/arm64-v8a/` |
| 库产物 `libc++_shared.so` | 1,262,504 B（取自 ohos-sdk） | 同上 |
| 库 HAR | **479,190 B**（2026-10-17 本机重建；含 `package/libs/arm64-v8a/libc++_shared.so` 1,262,504 B 与 `libnode_bridge.so` 28,040 B；**不含** `libnode.so`） | `library/build/default/outputs/default/library.har`（`tar -tzvf`） |
| 签名 HAP（含载荷） | **46,031,244 B**（2026-10-17 实测；压缩开关落地前为 129,535,202 B / 全条目 STORED） | `entry/build/default/outputs/default/entry-default-signed.hap` |

### 6.2 HAP 内压缩状态（✅ 实测 2026-10-17；B4/R2 已修）

**产生命令**（`pi-desktop-ark/` 下执行）：

```bash
python -c "import zipfile,os;z=zipfile.ZipFile('entry/build/default/outputs/default/entry-default-signed.hap');print('hap size',os.path.getsize('entry/build/default/outputs/default/entry-default-signed.hap'));print([(i.filename,i.file_size,i.compress_type) for i in z.infolist() if i.filename.endswith('.so') or 'resfile' in i.filename])"
```

实测输出（原文）：

```
hap size 46031244
resources/rawfile/boot.html 1270 0
resources/rawfile/bootstrap.js 17044 0
resources/rawfile/error.html 4114 0
resources/rawfile/host.js 7301 0
resources/rawfile/lib/tar-extract.js 13370 0
resources/rawfile/selfcheck.js 3022 0
resources/resfile/pi-web/README.md 944 0
libs/arm64-v8a/libc++_shared.so 1262504 8
libs/arm64-v8a/libnode.so 126809264 8
libs/arm64-v8a/libnode_bridge.so 28040 8
```

| HAP 内条目 | `file_size` | `compress_type` |
|---|---|---|
| `libs/arm64-v8a/libc++_shared.so` | 1,262,504 | **8（DEFLATE）✅** |
| `libs/arm64-v8a/libnode.so` | 126,809,264 | **8（DEFLATE）✅** |
| `libs/arm64-v8a/libnode_bridge.so` | 28,040 | **8（DEFLATE）✅** |
| `resources/rawfile/{boot.html,bootstrap.js,error.html,host.js,lib/tar-extract.js,selfcheck.js}`、`resources/resfile/pi-web/README.md` | 1,270 / 17,044 / 4,114 / 7,301 / 13,370 / 3,022 / 944 | **0（STORED）**（资源条目不随 `compressNativeLibs` 压缩） |

✅ **已修**：消费方 `entry/src/main/module.json5` 在 module 级声明 `compressNativeLibs: true` + `extractNativeLibs: true`；三个 `.so` 全部 DEFLATE，签名 HAP 从 **129,535,202 B → 46,031,244 B**。
⚠️ 规划附录 A 的核对口径写「`compress_type` **应为 8（DEFLATE）**」——按实测应限定为「**原生库**为 8」：`rawfile`/`resfile` 仍为 0（属资源打包行为，需在材料中按实测说明或修订规划口径）。

### 6.3 四项裁剪（⬜ Phase 1，现值与预期收益）

| 条目 | 现值 | 处置 | 预期收益 | 判据 |
|---|---|---|---|---|
| `.next/**/*.nft.json`（76 文件，内含宿主 `C:/Program Files/WindowsApps/…` 路径） | 348,096,301 B | 先实测「剔除后 Next 是否仍能起」 | 30–40 MB（压缩后） | 删除后真机起服务成功（O1） |
| `node_modules/@next`（win32 SWC `.node`） | 106,203,772 B | 删；只要 `node_modules/next/wasm/@next/swc-wasm-nodejs/` 在位 | 35–42 MB | 离线真机起服务且无联网补下载（O2） |
| `node_modules/@img`（sharp） | 28,767,709 B | 删（`images.unoptimized = true` ⇒ 服务端不需要） | 10–12 MB | 图片路径不报错 |
| `node_modules/node-pty` | 26,931,902 B | 删（PTY 不可用 + 残留 win32 `conpty.dll`/`OpenConsole.exe`） | 9–11 MB | 无代码路径触发 `require('node-pty')` |
| 其它（`@earendil-works` ≈40 MB、openai/google/anthropic ≈39 MB 等） | — | **保留**（纯 JS，功能必需） | — | — |
| **合计** | 884,167,367 B → `tar.gz` 156,592,393 B | — | `tar.gz` 预估 **70–90 MB** | ⬜ 待实测（被删项压缩比高于均值，不得线性外推） |

### 6.4 包体预算与「回归四件套」

| 组成 | 量级 | 备注 |
|---|---|---|
| 库侧（`libnode.so` + 引导件） | ≈44 MB（压缩后口径，库附录 C）；当前压缩关着 ⇒ 实际上限≈127 MB | ⚠️ 取决于 §6.2 的压缩配置 |
| 本工程载荷（裁剪后） | 70–90 MB（估） | ⬜ |
| ArkTS/HAP 其它 | 数 MB | — |
| **签名 HAP 合计** | **≈115–140 MB**（对照旧壳 320.3 MB） | ⬜ Phase 1 后重新量 |

**回归四件套**（Phase 4）：① 签名产物 SHA-256；② 首启耗时；③ 包体（体积 + 压缩方式）；④ `/facts` 关键字段（`node`/`wasm.available`/`wasm.validate`/`hotloop_ms_2e6`/`execArgv`）。

---

## 7. HTTP 数据面模型

### 7.1 端点与消费者

| 路径 | 提供者 | 消费者 | 语义 | 状态 |
|---|---|---|---|---|
| `/` | `pi-web`（SPA） | ArkWeb 渲染进程 | 主界面首屏 | ⬜ Phase 1 |
| `/api/*` | `pi-web` | SPA | 会话、模型、文件、工具等业务 API | ⬜ |
| `/api/agent/*`（SSE） | `pi-web` | SPA | **流式回复**与服务端事件 | ⬜ |
| `/api/web-auth` | `pi-web` | 旧壳的就绪探针 | 认证状态端点（旧壳 `READY_PROBE_PATH`）；本工程可复用为「服务活着」探针 | 🔶 上游存在（旧壳用它） |
| `/login` | `pi-web` | 用户 | 密码路线下的登录页；路线 ① 下上游会重定向回 `/` | ✅ 源码事实 |
| `/facts` | **骨架载荷** `selfcheck.js` | 壳 / `hdc fport`+`curl` | 环境与 JIT 自检 JSON（`node`/`platform`/`execArgv`/`wasm.*`/`hotloop_ms_2e6`/`homedir`/`tmpdir` 等） | ✅（骨架期）；⚠️ G9 上架前必须移除 |
| `/log` | **骨架载荷** `selfcheck.js` | 壳 / `curl` | `node.log` 尾部（最多 16 KB） | ✅（骨架期）；⚠️ 同上 |

### 7.2 请求/响应模型要点

| 面 | 形态 | 备注 |
|---|---|---|
| 源 | `http://127.0.0.1:<port>` | 页面与 API 同源 ⇒ 无需 CORS、无需头改写（✅ `pi-web/lib/request-security.ts:90-102` 对 loopback 直接放行） |
| 认证（路线 ①） | 无 | 不设 `PI_WEB_PASSWORD` ⇒ 上游整体关闭认证（✅ `lib/web-auth.ts:15-19`、`proxy.ts:42-47`） |
| 认证（路线 ②） | 会话 cookie **或** `Authorization: Basic` | cookie 对**包括 `/api/*`** 的所有请求生效；Basic 只是额外路径（✅ `proxy.ts:50-70`） |
| Cookie 名 | `pi_web_session` | 与上游常量同名（✅ `lib/web-auth.ts:4`） |
| Cookie 值形态 | `v1.<exp>.<nonce>.<HMAC-SHA256>` | 签名消息 = `pi-web-session:<payload>`，`payload = "v1.<exp>.<nonce>"`（🔶 旧壳 `createSessionToken` 镜像上游；本工程未复现） |
| Cookie 属性（旧壳口径） | `path='/'`、`httpOnly=true`、`sameSite='lax'`、`maxAge=30 天` | 本工程按路线 ② 落地时沿用 |
| Basic 用户名 | `pi` | ✅ 上游常量 `PI_WEB_AUTH_USERNAME` |
| 鉴权失败节流 | 有（上游对 Basic 猜测与登录表单共享节流） | 实现细节引用上游 `proxy.ts`，本工程不改 |

### 7.3 探活与就绪的数据流（现状 vs 目标）

```
现状（骨架）:  壳 → GET http://127.0.0.1:15577/  → 期望 200
               骨架载荷只答 /facts、/log，其余 404  ⇒ ⚠️ READY 不可达（ARCHITECTURE.md §3.4）

目标（Phase 1）:Node 侧 listen(0)/探测空闲 → 实际端口写入 <filesDir>/payload/port
               壳 读 port → GET http://127.0.0.1:<port>/api/web-auth（或 /）
               → 200 即 READY → loadUrl('http://127.0.0.1:<port>/')
```

**数据面不变式**：壳**不猜**端口、**不解析**业务响应；壳只判「服务是否活着」，其余交给渲染进程。
