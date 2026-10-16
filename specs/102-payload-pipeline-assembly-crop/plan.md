# 102-payload-pipeline-assembly-crop —— plan.md（载荷流水线：组装与裁剪）

> 模块：`102`（规划 §14.2）· 交付物：[`spec.md`](spec.md) + 本文件 · 现状：**未开始**（`resfile/pi-web/` 仅 `README.md`；骨架期载荷 = `rawfile/selfcheck.js`）
> 依据：规划 [`../../docs/000-工程规划.md`](../../docs/000-工程规划.md) **§2.3 / §7 全部 / §8.3 / §8.4 / §11 Phase 1 第 1·2 条 / §12 R5·R6·A1·A2 / 附录 C**；
> 运行时契约 [`../../../ohos-node-bridge/docs/000-工程规划.md`](../../../ohos-node-bridge/docs/000-工程规划.md) **§5.5 / §5.6 / §5.10 第 10 条**；
> 冻结接口契约 [`../../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md`](../../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md) **§3.1~§3.7 / §5**；
> 宪法 [`../constitution.md`](../constitution.md)（A2/A4/A6/A9 + T4/T5/T8/T9）；旧壳资产 [`../../../pi-desktop-hos/src-main/main.js`](../../../pi-desktop-hos/src-main/main.js)。
> 标注：**✅ 已落地/已实测** / **⬜ 规划未实现（Phase N）** / ⚠️ **冲突·风险**。

---

## 1. 技术上下文

| 项 | 值 | 依据 |
|---|---|---|
| 数据面 | 同源 HTTP + SSE：`/`（SPA）、`/api/*`、SSE；零 CORS、零头改写、零 IPC 载体 | ✅ 库 §6.3（loopback 直接放行） |
| 上游服务端 | Next **16.3.8**（**非 standalone**）+ React `^19.2.4`；`pi` 要求 Node `>= 22.19.0` | ✅ `pi-web/package.json`、`pi/package.json:70-71` |
| 设备侧编译器 | 只能用 **WASM SWC**：`node_modules/next/wasm/@next/swc-wasm-nodejs/` 必须在位 | ✅ 规划 §2.3；缺它 ⇒ 服务起不来 |
| 组装输入（首个） | 旧壳构建产物 `pi-desktop-hos/pi-dist`：**884,167,367 B / ≈27.2k 文件**，归档 **156,592,393 B** | ✅ 本机 `du -sb` / `stat`（⚠️ 长期应从 `../pi-web` + `../pi` 重新构建，见 §3 决策 1） |
| 投放目标 | `entry/src/main/resources/resfile/pi-web/`（HAP 内只读安装目录；`.gitignore` 只保留 `README.md`） | ✅ `.gitignore:23-25`、`entry/src/main/resources/resfile/pi-web/README.md:3` |
| 归档路线 | 单个 `tar.gz` + **Node 自己**解包（`zlib` + `fs`），幂等 marker 在可写根 | 库 §5.5、冻结契约 §3.1/§3.2 |
| 可写布局 | `<filesDir>/{payload, tmp, pi-agent, pi-web-cache, pi-cwd}` | `../overall-data-model.md` §4.2 |
| 库侧载荷接口（冻结） | `scriptPath` / `entry` / `payloadRoot` / `archive` / `archiveSha256` / `readonlyRoot` / `argv` / `execArgv` / `flags` / `env` / `cwd` / `capBytes` / `logRingSize` / `jitless` / `libDir` / `homeDir` / `logPath` | ⚠️ **契约已冻结、库实现未到位**：现库 `Types.ets` 只有 5 字段 ⇒ Phase 1 必须与库对齐（`../overall-data-model.md` §1.3） |
| 构建环境 | Git-Bash + Node ≥ 18（host 侧脚本）；`DEVECO_SDK_HOME`、`hvigorw.bat`（HAP 组装） | ✅ `scripts/provision-runtime.sh:17-30`、规划 §14.3 |
| 大小写纪律 | `strictMode.caseSensitiveCheck: true`（✅ `build-profile.json5:38-40`）⇒ 载荷内路径大小写**必须**一致；从大小写不敏感的开发机搬到设备上会暴露冲突 | ⚠️ 本模块组装期必须校验（§6.2 步骤 6） |

---

## 2. 宪法合规检查

### 2.1 十条原则

| 原则 | 判定 | 理由 / 收口方式 |
|---|---|---|
| **A1 一切经 HTTP** | ✅ | 载荷只提供 HTTP/SSE；本模块不引入任何 IPC 载体；启动脚本不做业务数据镜像 |
| **A2 壳薄、契约硬** | ✅ | 「环境装配 / 入口 / 服务托管 / 日志」属载荷（Node 侧）；壳只负责投放时机与显示（101/103）。⚠️ 边界纪律：启动脚本**不得**决定鉴权与端口策略之外的宿主语义 |
| **A3 运行时结论以库文档为准** | ✅ | 解包、幂等、环境契约全部引用库 §5.5/§5.6/§5.10 与冻结契约 §3，不在本模块重新论证 |
| **A4 不改上游** | ✅ | 组装=拷贝产物；补丁登记 0 条（候选 P-ark-1/P-ark-2 均「优先不补」）；同类问题优先用同名扩展/环境变量解决 |
| **A5 失败可见** | ⚠️ | 载荷侧失败**必须**写结构化日志（FR-102-017）并把「缺失模块名」写清；上屏由 101/103 承担 |
| **A6 不隐藏平台真相** | ✅（本模块负责写明差异） | 同名扩展的输出必须写明忽略规则更宽 / 单文件上限 512 KiB / 不解析版本控制忽略文件；`PI_OFFLINE=1` 禁下载且**可见** |
| **A7 判据可证伪** | ✅ | §7 每条用例都给观测点（`/`、`/api/*`、日志、`du -sb`、`stat`、下载临时目录是否出现） |
| **A8 单实例与随机端口** | ⚠️ | 载荷侧不绑固定端口（由 101 决定策略）；本模块提供**写端口回传**的载荷侧落点（`<filesDir>/payload/port`） |
| **A9 异常兜底** | ❌→Phase 1 | 骨架载荷未装兜底（✅ 现状）；Phase 1 启动脚本**必须**在**最顶部**注册 `uncaughtException`/`unhandledRejection` 并写 `payload/app.log`，**不得**调用进程退出（冻结契约 §3.4） |
| **A10 声明面 ≠ 授权面** | ✅ | 本模块不改权限声明面；不触发 Profile 重生成 |

### 2.2 代码规约

| 规约 | 判定 | 理由 |
|---|---|---|
| T1 ArkTS 严格模式 | ✅（不适用） | 本模块产出的是 Node 侧 JS 与 host 侧脚本，不产出 ArkTS |
| T2 三语资源一致 | ✅（不改） | 不新增资源字符串 |
| T3 签名材料不入库 | ✅ | 组装脚本只写 `resfile/pi-web/`（gitignored）与临时目录 |
| T4 二进制与大载荷不入库 | ✅ | `.gitignore:23-25` 排除载荷本体，仅保留 `README.md`；组装产物**不得** `git add` |
| T5 路径一律绝对 | ⚠️ | 载荷入口/工作目录必须绝对（FR-102-012）；骨架期 `PAYLOAD_ENTRY` 的物化路径用 `context.filesDir`（✅）⇒ 归档路线落地后同样纪律 |
| T6 常量集中 | ⚠️ | 载荷侧常量（探针端点、路径、上限）落在启动脚本顶部常量区；壳侧常量仍在 `common/Constants.ets`（101 负责） |
| T7 原生库只经 HAR | ✅（不适用） | 本模块不含原生库 |
| T8 日志谁写谁读 | ⚠️ | 载荷写 `payload/app.log`（Phase 1）；读回通道由 101 接（现状壳侧未接） |
| T9 阶段分级标注 | ⚠️ | 组装脚本与启动脚本的注释必须写 `⬜ 规划未实现（Phase N）`，不得出现 `TODO` 式含糊表述 |

---

## 3. 研究结论（关键决策 / 替代方案 / 为何否掉）

| # | 决策 | 替代方案（为何否掉） | 依据 |
|---|---|---|---|
| 1 | 组装输入**首个**用旧壳已构建产物（`pi-desktop-hos/pi-dist`，体积实测来源）；**长期**由 `../pi-web` + `../pi` 的构建产物生成。⚠️ 两种来源**必须**在 Phase 1 定稿并在组装脚本里固定（版本 + 摘要） | 直接用 `../pi-web` 现场构建：需要一次完整 `next build`（时间与漂移风险），且上游未配 standalone ⇒ 产物形态需验证；只用旧壳产物：随旧壳退役而失效 | 规划 §7.2/§8.3；`resfile/pi-web/README.md:12-13` |
| 2 | 首选**只读直读**（载荷放 `resfile/pi-web/`，零解压） | 一律归档自解包：多一次解包耗时（🔶 旧壳首启到就绪约 15 s）与失败面；且需要可写时**只需外置缓存** | 库 §5.5（v0.2 改为「只读直读为首选」）、规划 §7.1 |
| 3 | 归档路线保留、**单文件 tar.gz**、由 **Node 自己**解包（`zlib` 流式 + `fs`） | ① 系统侧（ArkTS/OHOS）解压器写业务文件：Node **读不到**（硬约束 ④，库宪法 C3）；② 分卷多归档：升级粒度收益不抵消复杂度（库 §5.5 备注留作后手） | 库 §5.5、冻结契约 §3.7 |
| 4 | 幂等判据**内容级**：目标目录 `<payloadRoot>/<sha256 前 12 位>` + marker `<payloadRoot>/.ready-<前 12 位>`（内含完整摘要 + 文件数 + 字节数 + 时间戳）；**缺 marker 但目录存在 ⇒ 重新解包** | 「目录存在即跳过」：🔶 旧壳教训（就地升级不生效）；只比时间戳：换包内容不变时误判 | 冻结契约 §3.2、旧壳 `main.js:502-543` |
| 5 | **四项裁剪逐项删、逐项验**（离线真机起服务）；任一项导致起不来**回退该项** | 一次性删完再看：无法归因、且可能被「联网补下载」掩盖（O2 的 `tmp/next-swc` 判据） | 规划 §7.2、§12 A2、`../overall-test-cases.md` §6（O1/O2） |
| 6 | **保留** `node_modules/next/wasm/@next/swc-wasm-nodejs/`；删除 `node_modules/@next`（win32 原生件） | 连 WASM 版一起删：设备侧无编译器可用；保留 win32 件：106 MB 白给 | 规划 §2.3、§7.2 |
| 7 | 可写需求**只外置缓存目录**（`NEXT_*` / 临时目录 → `<filesDir>/pi-web-cache`、`<filesDir>/tmp`），**不**复制整份载荷 | 「因为要写就把整份再解一份」：体积翻倍 + 首启翻倍（规划 §7.1 明文禁止） | 规划 §7.1、库 §5.5「可写性边界」 |
| 8 | 进程内托管服务端：**候选 A**（服务端的 server-lib 启动导出，逐形态探测 `startServer` / `default.startServer` / 直接函数）+ **候选 A′**（服务对象 API：构造 → `prepare()` → 取请求处理器 → 自建 HTTP 服务） | **命令行入口**（`next/dist/bin/next`）：注册信号处理并调用 `process.exit()`，在宿主进程里会连带杀掉整个应用（旧壳注释已写明） | 🔶 旧壳 `main.js:601-736`（候选 A/A′ 全套 + `loadModule` 的 CJS→ESM 兜底） |
| 9 | 环境装配沿用旧壳 `main.js:237-307` 的**变量集**（数据根 / 离线 / 代理绕过 / 品牌化开关 / 预置模板），但**删掉 Electron 专属**与不可移植项 | 照抄全量：`app.getPath` 不存在于本形态；品牌化开关需按本工程定稿 | ⚠️ 见 §3 决策 10 的冲突项 |
| 10 | ⚠️ **不照抄 `os.tmpdir()` 的 monkey-patch**：旧壳注释称「真机上环境变量对 Node 无效」，但**库原生层已 `setenv TMPDIR` 且 `/facts` 实测 `tmpdir=/data/storage/el2/base/haps/entry/files/tmp`** ⇒ 结论以库文档 + 本工程实测为准；Phase 1 **必须**复核（若发现 `os.tmpdir()` 未跟随，再补 patch 并写进 `docs/`） | 直接照抄 patch：与库的日志/取证口径重复，且掩盖「到底谁设的」；直接不 patch 而不复核：可能出现临时文件写到沙箱外（`EPERM`） | ✅ `/facts`（`docs/evidence/2026-10-16-acl-jit-verified.md`）vs 🔶 旧壳注释（**两份一手材料口径不一致**，按宪法 A3 以库文档 + 本工程实测为准） |
| 11 | 预置模板（`settings.json` / `mcp.json`）**只在缺失时写**；`defaultProjectTrust` 固定 `"ask"` | 每次启动覆盖：抹掉用户设置（旧壳规则 2「壳预置不覆盖用户改动」） | 🔶 `pi-desktop-hos/config/{settings.json,mcp.json}`、旧壳 `main.js:295-306` |
| 12 | 三个同名扩展（命令执行 / 按名查找 / 按内容搜索）**原样搬**进载荷预置资源，落点 `pi-agent/extensions/`；行为与真机验证归 106 | 重写扩展：无收益；用内建工具：平台缺 `rg`/`fd`、内建 `bash` 会挂住 | 规划 §8.3、§11 第 7 条；🔶 旧壳扩展头注释（差异声明） |
| 13 | 资源物化**一律 copy**（禁用符号链接与硬链接），由 **Node 自己**写 | 用符号链接省空间：应用域 `symlink` = `EACCES`（🔶 库/旧壳能力清单） | 规划 §8.4、库宪法 C3 |

---

## 4. 数据模型

### 4.1 体积与裁剪（全部为真实实测或明确标注的预估）

| 条目 | 现值（✅ 实测） | 处置 | 预期收益 | 判据 |
|---|---|---|---|---|
| `pi-dist` 总量 | **884,167,367 B / ≈27.2k 文件** | — | — | `du -sb` |
| 归档（裁剪前） | **156,592,393 B** | — | — | `stat` |
| `.next/**/*.nft.json`（76 文件，内含宿主 `C:/Program Files/WindowsApps/…` 路径） | **348,096,301 B** | 删（先验证） | 30–40 MB（⬜ 预估） | 删除后离线真机起服务成功（O1） |
| `node_modules/@next`（win32 SWC `.node`） | **106,203,772 B** | 删（保留 WASM 版） | 35–42 MB（⬜） | 离线起服务 + `tmp/next-swc` **不出现**（O2） |
| `node_modules/@img`（sharp） | **28,767,709 B** | 删（图片不优化） | 10–12 MB（⬜） | 图片路径不报错 |
| `node_modules/node-pty` | **26,931,902 B** | 删（PTY 不可用 + 残留 win32 `conpty.dll`/`OpenConsole.exe`） | 9–11 MB（⬜） | 无代码路径触发 `require('node-pty')` |
| 其它（`@earendil-works` ≈40 MB、openai/google/anthropic ≈39 MB 等） | — | **保留**（纯 JS，功能必需） | — | — |
| **合计预期** | 归档 156,592,393 B → | — | **70–90 MB**（⬜ 待实测；不得按 5.65:1 线性外推） | `TC-102-006` |
| 签名包预算 | 库侧 ≈44 MB + 载荷 70–90 MB + 其它数 MB | — | **≈115–140 MB** | `../overall-data-model.md` §6.4 |

### 4.2 幂等 marker 实体（冻结契约 §3.2）

| 字段 | 类型 | 语义 |
|---|---|---|
| 目标目录 | `<payloadRoot>/<sha256 前 12 位>` | 解包落点（同一归档内容 ⇒ 同一目录，天然去重） |
| marker 路径 | `<payloadRoot>/.ready-<sha256 前 12 位>` | 就绪标志 |
| marker 内容 | 完整 `sha256` + 文件数 + 字节数 + `epochMs` | 命中 **且**目标目录存在 ⇒ 打印 `[bootstrap] payload ready (skip)` 并附内容 |
| 例外 | 缺 marker 但目录存在 ⇒ **重新解包**；`NODE_BRIDGE_ARCHIVE_SHA256` 给了但实算不符 ⇒ **硬失败** | 宁可重做也不留半成品（禁止静默继续） |

### 4.3 目录与落点

| 路径 | 内容 | 可写 | 状态 |
|---|---|---|---|
| `entry/src/main/resources/resfile/pi-web/**` | 载荷本体（只读直读路线） | ❌ | ⬜ 现仅 `README.md` |
| `<filesDir>/payload/{node.log,app.log,port}` | 运行时日志 / 载荷结构化日志 / 端口回传 | ✅ | ⬜（仅 `selfcheck.js` + `node.log` 存在） |
| `<filesDir>/payload/<sha256 前 12 位>/` + `.ready-*` | 解包落点与 marker（仅归档路线） | ✅ | ⬜ |
| `<filesDir>/pi-agent/{extensions,skills,sessions,settings.json,mcp.json,tmp}` | 助手数据根（会话、凭据、扩展、模板） | ✅ | ⬜ |
| `<filesDir>/pi-web-cache` | 服务端可写缓存（`NEXT_*` 指向它） | ✅ | ⬜ |
| `<filesDir>/tmp`、`<filesDir>/pi-cwd` | 临时目录 / 默认工作目录 | ✅ | 部分（库建 `tmp`） |

### 4.4 环境变量（分「谁设」，唯一落点）

| 变量 | 值 | 谁设 | 现状 |
|---|---|---|---|
| `HOME` / `USERPROFILE` | `<filesDir>` | **库**（原生层，✅ 实测生效） | ✅ |
| `TMPDIR` / `TMP` / `TEMP` | `<filesDir>/tmp` | **库** | ✅ |
| `NODE_ENV` = `production`；`NODE_OPTIONS` 清空；`UV_USE_IO_URING=0` | — | **库** | ✅ |
| `PI_CODING_AGENT_DIR` | `<filesDir>/pi-agent` | **本工程**（载荷启动脚本） | ⬜ |
| `PI_OFFLINE` | `1`（禁联网安装/下载） | **本工程** | ⬜ |
| `PI_WEB_HOSTNAME` / `PI_WEB_PORT` | 路线 ① **不设**（端口由服务端随机/探测后占用） | **本工程** | ⬜ |
| `PI_WEB_PASSWORD` | 路线 ① **不设**（⇒ 上游认证整体关闭） | **本工程** | ⬜ |
| `NO_PROXY` / `no_proxy` | 追加 `127.0.0.1`、`localhost`、（路线 ②）局域网地址 | **本工程** | ⬜ |
| `PI_HOS_ROOTS` | 已授权目录清单（供「选择工作目录」） | **本工程**（106/104 供数） | ⬜ |
| `PI_WEB_SKIP_VERSION_CHECK` / `PI_WEB_APP_NAME` | `1` / `Pi Desktop`（品牌化，Phase 1 定稿） | **本工程** | ⬜ |
| `SELFCHECK_PORT` | 骨架载荷专用（默认 15577） | 骨架载荷 | ✅（Phase 1 移除） |

### 4.5 进程内托管入口候选（🔶 旧壳已验证形态）

| 候选 | 入口 | 导出探测 | 关闭句柄 |
|---|---|---|---|
| A | `node_modules/next/dist/server/lib/start-server.js`（及 `…/start-server/index.js`） | `startServer` → `default.startServer` → `default` → 模块本身 | 从返回值挖 `close`：`result` / `result.server` / `result.httpServer` / `result.app`；**拿不到就如实记限制** |
| A′ | `node_modules/next/dist/server/next.js` 的默认导出 | 构造函数 → 实例 → `prepare()` → `getRequestHandler()` → `http.createServer` | 自建 `http.Server` 即句柄，可 `close()` |
| ⛔ | `next/dist/bin/next`（CLI） | — | **禁止**（注册信号 + `process.exit()`，会连带杀宿主） |

### 4.6 预置资源清单

| 资源 | 来源（🔶 旧壳） | 行数 | 落点 |
|---|---|---|---|
| 命令执行同名扩展 | `pi-desktop-hos/extensions/harmony-exec.js` | **503** | `<filesDir>/pi-agent/extensions/` |
| 按名查找 / 按内容搜索同名扩展 | `pi-desktop-hos/extensions/harmony-search.js` | **574** | 同上 |
| 运行时事实自检扩展 | `pi-desktop-hos/extensions/harmony-runtime.js` | **126** | 同上 |
| 工作区主目录扩展 | `pi-desktop-hos/extensions/harmony-workspace-roots.js` | **154** | 同上（主目录供数在 106/104） |
| 预置设置模板 | `pi-desktop-hos/config/settings.json` | **5** | `<filesDir>/pi-agent/settings.json`（仅缺失时写） |
| 预置 MCP 模板 | `pi-desktop-hos/config/mcp.json` | **3** | `<filesDir>/pi-agent/mcp.json`（仅缺失时写） |
| 流式解包器（仅归档路线） | `pi-desktop-hos/src-main/tar-extract.js` | **214** | 载荷内（`payload/lib/`），**Node 侧**运行 |

---

## 5. 接口契约

### 5.1 提供（本模块产出对外的面）

| 契约 | 形态 | 语义 |
|---|---|---|
| 载荷入口 | Node 可 `require`/`import` 的绝对路径文件 | 由运行时按 `entry` 解析；CJS 失败退 ESM（冻结契约 §3.3） |
| `/` | HTTP 200 + SPA HTML（含界面标记） | 主界面首屏（渲染方 103） |
| `/api/*` | HTTP JSON | 业务 API（同源） |
| 自检端点（骨架期） | `/facts`、`/log` | 环境与日志读回；⚠️ 上架前必须移除（G9） |
| 幂等 marker | `<payloadRoot>/.ready-<前12位>` | 见 §4.2 |
| 端口回传 | `<filesDir>/payload/port`（单行十进制） | 服务侧 `listen` 成功后写；壳只读（101） |
| 载荷日志 | `<filesDir>/payload/app.log`（结构化行） | 异常兜底 + 阶段记录（T8） |
| bootstrap 日志行 | `[bootstrap] entry=<abs> mode=<cjs\|esm> root=<runRoot> cwd=<cwd>` / `[bootstrap] payload ready (skip)` | 冻结契约 §3.2/§3.3 |

### 5.2 消费（运行时 / 库）

| 消费项 | 契约 | 差距 |
|---|---|---|
| `entry` / `payloadRoot` / `readonlyRoot` / `archive` / `archiveSha256` / `cwd` / `env` | 冻结契约 §2.3 / §3.1 | ⚠️ 现库未实现（只有 `scriptPath`/`flags`/`libDir`/`homeDir`/`logPath`）⇒ 路线 ① 落地**依赖库推进**；未到位前的临时做法必须显式记录，不得写成既成事实 |
| Node 内置能力 | `node:zlib` / `node:fs` / `node:path` / `node:http`（自解包与自建服务） | ✅ 可用（库 §D.8 结论 1） |
| `worker_threads` | 上游图片缩放 / QuickJS 需要 | ✅ 可用（库 §D.8 结论 1） |
| `WASM`（SWC、llhttp） | 设备侧编译与 `fetch` 依赖 | ✅ 可用（依赖 JIT/ACL） |
| 子进程（`spawn`） | 设计**不依赖**其完成事件 | ✅ 本机三事件齐全，仍按保守设计（R10） |

### 5.3 事件协议

| 协议 | 内容 |
|---|---|
| 兜底异常 | 顶部注册 `process.on('uncaughtException')` 与 `'unhandledRejection'`；把 `时间戳 + 类型 + message + stack` **追加**写 `<HOME>/payload/app.log` + `stderr`；**不调用 `process.exit`**；并导出 `globalThis.__nodeBridgeLastError`（冻结契约 §3.4） |
| 幂等事件 | 命中：`[bootstrap] payload ready (skip)` + 目录与 marker 内容；未命中：解包统计（文件数 / 字节数）并写 marker |
| 端口事件 | `listen` 成功后写 `port` 文件（内容 = 十进制端口） |
| 环境事件 | 启动时打印生效的关键变量（**不回显密码**），供 `/log` 取证 |

---

## 6. 实现策略

### 6.1 架构模式

host 侧**流水线脚本**（组装 + 裁剪 + 校验 + 投放）+ 载荷内**启动脚本**（环境 → 入口 → 服务 → 日志）+ 运行时的**投放/解包契约**（库负责）。三者职责单一、边界只经「路径 + 环境 + 归档摘要」传递。

### 6.2 组装算法（host 侧，⬜ Phase 1 新建）

```
① 固定来源：SOURCE=<pi-dist | ../pi-web+../pi 构建产物>（版本 + 摘要写入清单）
② 复制到临时组装目录（不原地改上游）
③ 四项裁剪（逐项）：
     rm -rf .next/**/*.nft.json
     rm -rf node_modules/@next            # 保留 node_modules/next/wasm/@next/swc-wasm-nodejs
     rm -rf node_modules/@img
     rm -rf node_modules/node-pty
④ 断言必需物在位：node_modules/next/wasm/@next/swc-wasm-nodejs/**  （缺 ⇒ 硬失败）
⑤ 校验：无 win32 原生件（*.node 中的 win32/conpty/OpenConsole）、无 .pdb
⑥ 大小写一致性校验（caseSensitiveCheck=true）：对全部相对路径做「忽略大小写去重」，
     冲突即报错并给出冲突对（从大小写不敏感的开发机搬来的经典坑）
⑦ 产出清单 manifest：版本 + SHA-256(清单) + 文件数 + 总字节数
⑧ 投放：拷贝到 entry/src/main/resources/resfile/pi-web/（保留 README.md）
     （或）打包单 tar.gz → rawfile（归档路线）
```

### 6.3 载荷启动算法（Node 侧，⬜ Phase 1 新建）

```
0) 最顶部：注册 uncaughtException / unhandledRejection → payload/app.log（禁止 exit）
1) 解析运行根：archive 解包根 → 只读根 → 可写根（冻结契约 §3.1 顺序）
   1a) 归档路线：算/比对 SHA-256 → marker 命中则跳过 → 否则 Node 自解包（流式）→ 写 marker
2) 环境装配（§4.4，唯一落点）：PI_CODING_AGENT_DIR / PI_OFFLINE / NO_PROXY / 品牌化开关
   2a) 建目录树（pi-agent 及其子目录、pi-web-cache、pi-cwd），模板「仅缺失时写」
   2b) 物化扩展（copy，覆盖同名；skills 以用户为准）
3) chdir 到运行根（真机 cwd=/ ⇒ 必须显式设置；满足 resolve(cwd,'package.json') 类约定）
4) 起服务（进程内，候选 A → A′）：占端口（随机/探测空闲）→ 写 payload/port
5) 打印阶段日志；保持事件循环；服务句柄交给关停钩子（Phase 2 与 101 联调）
```

### 6.4 错误处理

| 失败面 | 处置 |
|---|---|
| 组装期缺必需物（WASM SWC 不在位、归档缺失） | **硬失败**（脚本 `exit 2` + 明确提示），不产出半成品 |
| 大小写冲突 | 硬失败并打印冲突相对路径对 |
| 归档摘要不符 | 硬失败（`NODE_BRIDGE_ARCHIVE_SHA256` 与实算不一致，禁止静默继续） |
| 依赖缺失 | 运行时打印 `MODULE_NOT_FOUND` + `requireStack`（**不 catch 吞掉**）；`/log` 可读回 |
| `listen` 失败（端口占用） | 捕获 `error` 事件 → 写 `payload/app.log` + 退出前留下可读原因（避免整进程 abort；与 101 的 ⑰ 共同收口） |
| 未捕获异常 | 兜底写 `app.log`，**不退出**（保留现场） |

### 6.5 性能

- 直读路线**零解压**；首启只花「起服务 + 首次请求编译」的时间（⬜ 待计时，`TC-102-007`）。
- 归档路线：解 ≈27.2k 文件（🔶 旧壳 ≈15 s）⇒ 引擎必须**流式**（固定内存：header ≤512 B 缓冲，数据随到随写；不得 `Buffer.concat` 全量）。
- 幂等命中时**不做任何 IO 扫描全树**（只 stat marker + 目标目录）。
- 组装脚本只做拷贝/删除/校验，不引入构建步骤（不做 `next build`）。

---

## 7. 测试考虑

| 用例 | 覆盖 FR | 判据（看哪里） | 现状 |
|---|---|---|---|
| `TC-102-001` 只读直读投放 | FR-102-008/020 | 载荷在只读目录；`require` 全链成功；首启无可观测解压等待 | ⬜ 待执行（Phase 1，P0-13） |
| `TC-102-002` 裁剪 1：`.nft.json` | FR-102-005/006 | 删除后离线真机仍起服务（无 `Cannot find module`） | ⬜ 待执行（O1） |
| `TC-102-003` 裁剪 2：win32 SWC | FR-102-004/007 | 离线起服务；`tmp/next-swc` **不出现** | ⬜ 待执行（O2） |
| `TC-102-004` 裁剪 3：`@img` | FR-102-005 | 图片相关路径不报错 | ⬜ 待执行 |
| `TC-102-005` 裁剪 4：`node-pty` | FR-102-005 | 无代码路径触发 `require('node-pty')` | ⬜ 待执行 |
| `TC-102-006` 体积实测与预算更新 | FR-102-018 | `du -sb` / `stat` / `ls -l $HAP` 三项写入数据模型文档 | ⬜ 待执行（O6） |
| `TC-102-007` 首启与阶段文本 | FR-102-022 | 若走解包：耗时与阶段可见、可重试；若直读：无可观测解压阶段 | ⬜ 待执行 |
| `TC-102-008` 幂等（内容级） | FR-102-011 | 二次启动 marker 命中跳过；改动归档后重新就位 | ⬜ 待执行 |
| `TC-102-009` 进程内托管 | FR-102-013 | `/` 200 且含 UI 标记；`/api/*` 至少一条 200 | ⬜ 待执行 |
| `TC-102-010` `resfile` 读取边界 | FR-102-020 | 真机读大文件成功、`require` 全链成功；写该目录失败且报错可读 | ⬜ 待执行（A6） |
| `TC-106-004` 预置模板不覆盖 | FR-102-016 | 篡改模板后重启内容保持 | ⬜ 待执行（归属 106） |
| `TC-106-002` 扩展差异可见 | FR-102-015 | 输出含跳过规则与 512 KiB 上限 | ⬜ 待执行（归属 106） |

> **禁止的判据**：以「目录存在」判载荷就位（必须内容级 marker）；以「重试后成功」掩盖首次解包失败；用 hilog「有没有那一行」判解包完成。

---

## 8. 文件清单（真实行数：`wc -l`）

| 文件 | 作用 | 行数 | 状态 |
|---|---|---|---|
| `entry/src/main/resources/resfile/pi-web/README.md` | 载荷落点说明（其余内容 gitignored） | **19** | ✅ 占位 |
| `entry/src/main/resources/rawfile/selfcheck.js` | 骨架期载荷（`/facts`、`/log`）；Phase 1 由真实载荷取代 | **83** | ✅ 骨架（⬜ Phase 1 移除调试端点，G9） |
| `.gitignore` | 载荷/二进制/HAR/签名材料不入库 | **25** | ✅ |
| `../../../pi-desktop-hos/src-main/main.js` | 🔶 环境装配（`:237-307`）、进程内 Next 宿主（`:601-736`）、幂等解包（`:502-543`）、就绪轮询（`:834-873`）、优雅关停（`:1304-1314`） | **1314** | 🔶 资产来源 |
| `../../../pi-desktop-hos/src-main/tar-extract.js` | 🔶 流式 ustar 解包器（固定内存状态机） | **214** | 🔶 资产来源 |
| `../../../pi-desktop-hos/extensions/harmony-exec.js` | 🔶 命令执行同名扩展（哨兵行判定） | **503** | 🔶 资产来源 |
| `../../../pi-desktop-hos/extensions/harmony-search.js` | 🔶 查找/搜索同名扩展（差异声明） | **574** | 🔶 资产来源 |
| `../../../pi-desktop-hos/extensions/harmony-runtime.js` | 🔶 运行时事实自检扩展 | **126** | 🔶 资产来源 |
| `../../../pi-desktop-hos/extensions/harmony-workspace-roots.js` | 🔶 主目录解析扩展 | **154** | 🔶 资产来源 |
| `../../../pi-desktop-hos/config/settings.json` | 🔶 预置设置模板（`shellPath`/`defaultTools`/`defaultProjectTrust:"ask"`） | **5** | 🔶 资产来源 |
| `../../../pi-desktop-hos/config/mcp.json` | 🔶 预置 MCP 模板（`{mcpServers:{}}`） | **3** | 🔶 资产来源 |
| `scripts/assemble-payload.mjs` | 组装：复制即裁剪（源目录只读）、默认 dry run、`--apply` 才写盘、两条投放路线、归档 SHA-256 | **620** | 🔶 工作区已有（未入库、未验证） |
| `scripts/crop-rules.mjs` | 裁剪**规则数据**（四项 + 保留白名单 + 每条的 `reason`/期望体积/证据标记），不做 IO | **221** | 🔶 工作区已有 |
| `payload/pi-web-launch.js` | Node 侧入口：环境装配 + 端口先探测空闲 + 进程内 Next + 就绪后写端口回传 + 自有日志通道 | **536** | 🔶 工作区已有（未验证） |
| `payload/env.js` | 应用语义环境契约的**唯一落点**（`PI_*` / 代理绕过） | **173** | 🔶 工作区已有 |
| `payload/extensions/{harmony-exec,harmony-search,harmony-runtime,harmony-workspace-roots}.js` | 预置同名扩展（旧壳原样；行数与旧壳一致） | **503 / 574 / 126 / 154** | 🔶 工作区已有 |
| `payload/config/{settings.json,mcp.json}` | 预置模板（仅缺失时写） | **5 / 3** | 🔶 工作区已有 |
| ⬜ `entry/src/main/resources/resfile/pi-web/**` | 投放产物（`--apply` 后出现；gitignored） | —（万级文件） | ⬜ 未投放（脚本默认 dry run） |
| 库侧（非本工程文件） | `payload/bootstrap.js`（运行根决策 / 幂等 marker / 兜底异常）由**库**提供，本工程只消费 | 契约 §3.1~§3.4 | ⚠️ 库实现 ⬜ 未到位 |

---

## 9. Phase 1 / Phase 2 待实现清单

> ⚠️ **并行落地提示**：写入本文件时，工作区已存在另一实现者产出的载荷流水线脚本（`scripts/assemble-payload.mjs`、`scripts/crop-rules.mjs`、`payload/*` —— 见 §8 的 🔶 行），但**未入库、未做真机验证**。因此第 1/2/3/5/6/7 条的**脚本部分**已具备，剩余工作 = §7 的真机判据 + 与库侧契约对齐（第 12 条）；**不得**把「文件存在」当成「已通过」。

| # | 待实现项 | 实现需求 | 验收判据（可证伪） | 依据 |
|---|---|---|---|---|
| 1 | 组装脚本 + 来源定稿（旧壳产物 vs 从上游重建），产出清单（版本 + 摘要 + 文件数 + 字节数） | FR-102-001/002 | 重复执行两次产出清单一致（除时间戳）；来源版本记录在案 | 规划 §7.2、§3 决策 1 |
| 2 | 四项裁剪 + 逐项离线验证（O1/O2） | FR-102-005/006/007 | `TC-102-002`~`005` 全绿；`tmp/next-swc` 不出现 | 规划 §7.2、§12 A2 |
| 3 | 断言 WASM SWC 在位 + 无 win32 原生件 + 大小写一致性校验 | FR-102-004 | 组装脚本对缺件/冲突**硬失败**并打印证据 | 规划 §2.3、`build-profile.json5:38-40` |
| 4 | 投放路线 ①：拷贝到 `resfile/pi-web/` 并真机直读（P0-13） | FR-102-008/020 | `TC-102-001`/`TC-102-010` 通过（`/` 200、`require` 全链） | 规划 §7.1、库 §5.5 |
| 5 | 归档路线（备选）：单 `tar.gz` + Node 自解包 + 内容级 marker | FR-102-009/011 | `TC-102-008` 通过；marker 内容 = 归档摘要；缺 marker 重解 | 冻结契约 §3.2、旧壳 `:502-543` |
| 6 | 载荷启动脚本：兜底异常 + 环境装配 + 目录树/模板（仅缺失写）+ 扩展物化（copy） | FR-102-014/015/016/017 | `TC-101-005`（env 生效）+ `TC-106-004`（模板不覆盖）+ 兜底后进程存活 | 冻结契约 §3.4、⑱ |
| 7 | 进程内托管（候选 A/A′）+ 端口随机/探测 + 写 `payload/port` | FR-102-013 | `TC-102-009` + `TC-101-006`（端口回传一致） | ⑰、旧壳 `:601-736` |
| 8 | `listen` 的 `error` 处理（把 `EADDRINUSE` 变成可读错误，**不** abort） | FR-102-013 | 占用候选端口后进程存活且 `app.log` 有可读原因（`TC-ARK-009` 转为失败态） | ⑰、宪法 A9 |
| 9 | 可写缓存外置（`NEXT_*`/临时目录 → `<filesDir>/pi-web-cache`），不复制整份载荷 | FR-102-010/021 | 只读目录零写入（`AC-102-09`）；缓存文件出现在私有目录 | 规划 §7.1、库 §5.5 |
| 10 | 离线纪律：`PI_OFFLINE=1` + 禁下载；被禁止行为可见 | FR-102-019 | `AC-102-12` + 日志无下载尝试 | 规划 §7.4、A6 |
| 11 | 体积实测回写（组装后 / 归档后 / 签名包）并更新预算表 | FR-102-018 | `TC-102-006`；数值与预算对照 | 规划 §7.2、`../overall-data-model.md` §6 |
| 12 | 与库对齐 `entry`/`readonlyRoot`/`archive`/`env` 契约（未到位前记录临时做法） | FR-102-008/014 | 契约字段可用后直读路线无需壳侧补丁；缺口写进证据文档 | 冻结契约 §2.3、库 §6.1 |
| 13 | Phase 2：可从载荷内触发的关停钩子（服务 `close`）与 101 的 `shutdown()` 联调 | FR-102-022 | 关停日志可见 + 端口释放；再次启动能就绪（`TC-101-009`） | 规划 §5 第 13 条 |

> 依赖顺序：`[1 组装] → [3 校验] → [2 裁剪] → [4 直读] → [6+7 启动脚本/托管] → [8,9,10 收口] → [11 体积]`；`[5 归档路线]` 仅在 P0-13/A6 判否时启动；`[12,13]` 与库侧进度联动。
