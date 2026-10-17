# 101-runtime-integration-launch-orchestration —— plan.md（运行时接入 / 启动编排）

> 模块：`101`（规划 §14.2）· 交付物：[`spec.md`](spec.md)（要什么 + 验收判据）+ 本文件（怎么做）· 现状：**Phase 0 骨架已落地，Phase 1 未开始**
> 依据：规划 [`../../docs/000-工程规划.md`](../../docs/000-工程规划.md) **§4 / §5 第 1·2·3·4·5·6·12·13·16 条 / §6.1 / §6.3 / §7.1 / §7.4 / §11 / §12 / §14.2 / §14.3**；
> 运行时契约 [`../../../ohos-node-bridge/docs/000-工程规划.md`](../../../ohos-node-bridge/docs/000-工程规划.md) **§5.3 / §5.6 / §5.7 / §5.10 / §6.1 / §6.2**；
> 冻结接口契约 [`../../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md`](../../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md)（**库侧唯一口径**）；
> 宪法 [`../constitution.md`](../constitution.md)（A2/A3/A5/A8/A9/A10 为主约束）；本工程实测 [`../../docs/ACL配置.md`](../../docs/ACL配置.md)、[`../../docs/evidence/2026-10-16-acl-jit-verified.md`](../../docs/evidence/2026-10-16-acl-jit-verified.md)。
> 标注：**✅ 已落地**（带 `path:line`）/ **⬜ 规划未实现（Phase N）** / ⚠️ **与规划冲突或风险**。

---

## 1. 技术上下文

| 项 | 值 | 依据 |
|---|---|---|
| 宿主形态 | ArkTS Stage 模型单模块应用（`entry`），设备类型 `2in1` / `tablet`；唯一页面 `pages/Index` | ✅ `entry/src/main/module.json5:7-10`、`entry/src/main/resources/base/profile/main_pages.json` |
| 真机基线 | HAD-W24 / 7.0.0.107(SP7C00E100R13P5) / API 26 / OpenHarmony-7.0.0.105 / arm64-v8a；序列号 `3QC0226526001227` | ✅ `docs/evidence/2026-10-16-acl-jit-verified.md` |
| API 口径 | `compatibleSdkVersion 5.0.5(17)`、`targetSdkVersion 6.1.1(24)`；⚠️ 与规划「API 26」口径不一致 | ⚠️ `build-profile.json5:33-36`、`AppScope/app.json5:11-12`（登记于 `../STRUCTURE.md` §2.1） |
| 消费的库 | `@fellow99/node-bridge` **0.1.0**，以**构建好的 HAR**（441,353 B）经 `file:` 依赖接入 | ✅ `oh-package.json5:12`、`oh-package-lock.json5:14-20`、宪法 T7 |
| 运行时产物 | `libnode.so` **126,809,264 B**（Node v24.2.0，SHA-256 `3019bf5f…51a1`）+ `libc++_shared.so` **1,262,504 B**（`388e0df2…b2f9`），由锁文件固化 | ✅ `entry/libs/arm64-v8a/`、库 `runtime.lock.json`（库 §D.9） |
| 构建工具链（host） | Git-Bash + `hvigorw.bat`（`DEVECO_SDK_HOME=D:\oh-workspace\command-line-tools\sdk`）+ DevEco 自带 node（host 侧 `provision.mjs` 需 Node ≥ 18） | ✅ `scripts/provision-runtime.sh:17-30`、规划 §14.3 |
| 接口契约来源 | 冻结契约：`NodeState` 6 值、`NodeRuntimeOptions` 全字段、`logs()`/`lastCrash()`/`shutdown()`/`waitUntilRunning()`、日志行格式、崩溃 JSON、`envPairs` 编码 | ⚠️ 契约是**目标面**；当前库实现只暴露 6 个 API、`NodeRuntimeOptions` 仅 5 字段（`../overall-data-model.md` §1.3 已登记该缺口） |
| 状态口径 | 壳侧 `UIState` 4 值（`idle`/`launching`/`running`/`failed`）与库 `NodeState` 并列；就绪**只**由壳侧探活成功后 `markRunning()` 写入 | ✅ `entry/src/main/ets/app/PiDesktopRuntime.ets:7-12,84,90` |

---

## 2. 宪法合规检查

### 2.1 十条原则（`../constitution.md` §一）

| 原则 | 判定 | 理由（现状证据 / 收口方式） |
|---|---|---|
| **A1 一切经 HTTP** | ✅ | 本模块不承载任何业务数据；宿主能力桥（Phase 2）在设计上只走能力调用（库 `dispatch` 的 JSON 契约），业务全在 Node 侧（`../ARCHITECTURE.md` §1 数据流表） |
| **A2 壳薄、契约硬** | ⚠️ | 编排/观测/投放属壳（合规）；但**端口分配与就绪判定当前落在壳侧常量**（`common/Constants.ets:7`）——规划要求「端口由 Node 侧随机取、壳不猜」，Phase 1 必须把端口决策移回 Node 侧（实现 FR-101-008/009） |
| **A3 运行时结论以库文档为准** | ✅ | 本模块只引用库 §5.3/§5.6/§5.7/§5.10/§6 与冻结契约，不复制论证；应用层新结论（端口 abort、`dup2` 混流）回引 `docs/ACL配置.md` |
| **A4 不改上游** | ✅ | 本模块 0 条上游补丁；投放在 host 侧（`scripts/`），运行时不改上游 |
| **A5 失败可见** | ⚠️ | 状态机 + `detail` 文案 + 「重试/日志」按钮已落（`pages/Index.ets:81-95`）；⬜ 错误页/诊断面板归 103；⚠️ 「重试」当前只重新 `loadUrl`（`pages/Index.ets:87-89`）⇒ 语义必须按 FR-101-011/AC-101-11 收敛 |
| **A6 不隐藏平台真相** | ⚠️ | 平台缺口的**上屏**归 103/104；本模块负责把「端口冲突/投递失败/探活超时/崩溃终态」如实写成可读原因（FR-101-011/012） |
| **A7 判据可证伪** | ✅ | 本文件 §7 每条用例都给「看哪里」（截图 / HTTP 端点 / hilog / 产物 stat），并回避禁用判据 |
| **A8 单实例与随机端口** | ❌ | **与本宪法冲突的唯一硬项**：端口写死 `15577`（`common/Constants.ets:7`）；`EntryAbility` **未显式声明** `launchType`（`module.json5:15-39`）⇒ Phase 1 必做（§9 第 1/2 条） |
| **A9 异常兜底** | ❌ | 骨架载荷 `rawfile/selfcheck.js` 未装 `uncaughtException`/`unhandledRejection`，`listen` 无 `error` 处理（`:81-83`）⇒ 端口冲突仍会 abort（✅ 已实测后果）；Phase 1 由载荷侧补齐（102 承载，101 验收） |
| **A10 声明面 ≠ 授权面** | ✅ | 本模块**不改** `module.json5` 的权限项与 `definePermissions`；仅新增 `launchType` ⇒ **不触发** Profile 重生成（`docs/ACL配置.md` §2.3 的复验条件不变） |

### 2.2 代码规约（`../constitution.md` §二）

| 规约 | 判定 | 理由 |
|---|---|---|
| T1 ArkTS 严格模式 | ✅ | `pages/Index.ets:32-38` 用 `getUIContext().getHostContext()`；全模块无 `any`/`unknown` |
| T2 资源字符串三语一致 | ✅（本模块不改） | 本模块不新增字符串资源；`module_desc` 等仅 base 的欠账归 107 |
| T3 签名材料不入库 | ✅ | `build-profile.json5` 的 `signingConfigs` 为本机未提交改动；`hvigorfile.ts:107-147` 不覆盖、只在缺指针时补 `products[].signingConfig` |
| T4 二进制与大载荷不入库 | ✅ | `.gitignore:17-25` 排除 `entry/libs/`、`libs/**/*.har`、`resfile/pi-web/*`、`*.hap` |
| T5 路径一律绝对 | ✅（本模块段） | `PiDesktopRuntime.ets:136-137` 用 `context.filesDir`；未依赖 `process.cwd()`（真机 `/`）与 `process.execPath`（真机 `/system/bin/appspawn`） |
| T6 常量集中在 `common/Constants.ets` | ⚠️ | 端口/载荷/探活参数已集中（`Constants.ets:7,10,18,21,22,25-27`）；但阶段文案仍散在页面与编排层（`Index.ets:51`、`PiDesktopRuntime.ets:91`）⇒ Phase 1 把阶段文案收进常量模块（与 103 联做） |
| T7 原生库只经 HAR 消费 | ✅ | `oh-package.json5:12` + `scripts/build-bridge-har.sh:4-11`（`00309001` 的处置） |
| T8 日志谁写谁读 | ⚠️ | 读回通道存在（`/log` 端点、库 `Logger.tail`），但**壳侧未接**：`pages/Index.ets:69-72` 仍是占位文案 ⇒ Phase 1 实现（§9 第 5 条） |
| T9 阶段分级标注 | ⚠️ | 代码注释用的是 `TODO(Phase 3)`（`entryability/EntryAbility.ets:57`）与 `TODO(Phase 1)`（`pages/Index.ets:70`），**不是** `⬜ 规划未实现（Phase N）` 口径；且 `onDestroy` 注释写 Phase 3，而规划把优雅关停列在 **Phase 2** ⇒ 注释与规划不一致，实现时必须按 T9 改写（登记于 §3 决策 9） |

---

## 3. 研究结论（关键决策 / 替代方案 / 为何否掉）

| # | 决策 | 替代方案（为何否掉） | 依据 |
|---|---|---|---|
| 1 | 库以**构建好的 HAR** 消费（`scripts/build-bridge-har.sh` 产出 → `libs/@fellow99/node-bridge.har`） | 跨工程**源码相对导入**：`useNormalizedOHMUrl: true` 下被 hvigor 拒 `00309001`（✅ 实测），且与真实消费方式不符 | 宪法 T7、规划 §7.5 |
| 2 | 运行时投放**只保留一份实现**：`scripts/provision-runtime.sh` → `ohos-node-bridge/tools/provision.mjs` | 应用侧自写拷贝脚本：两份实现漂移 + 无 SHA/ELF 门禁；`--download` 的网络与代理细节也无处复用 | 规划 §14.3、库附录 G |
| 3 | 编排采用**三段式 + 就绪探活**（物化 → 投递 → 探活） | ① 等 `start()` 的 `Promise` 代表可用：语义错误（只代表已投递，`NodeStartResult.ok` 定义如此）；② 只轮询库状态 `waitUntilRunning()`：⬜ 库侧尚未实现（冻结契约 §2.6 已承诺，当前 `NodeRuntime.ets` 无此方法）⇒ 现状自建探活循环，Phase 1 改为「库方法 + 端点收口」并存 | 冻结契约 §2.6、规划 §4 时序 |
| 4 | 探活端点收口到**服务真实存在的路径**：候选 `/api/web-auth`（旧壳 `READY_PROBE_PATH`，`pi-desktop-hos/src-main/main.js:48`）；pi-web 供应 `/` 后也可用 `/` | 「非 0 即成功」或「只要连上就算」：会掩盖 404/错误页面（❌ 明确禁止） | ⚠️ `../ARCHITECTURE.md` §3.4（骨架载荷只答 `/facts`、`/log` ⇒ `/` 必 404 ⇒ `READY` 不可达） |
| 5 | 端口**随机或先探测空闲**，实际端口由 **Node 侧回传**（`<filesDir>/payload/port`），壳只读不猜 | 固定 `15577`：✅ 实测会被别的应用占用 ⇒ `EADDRINUSE` ⇒ 整进程 abort；壳侧猜端口：§4.6 明确禁止 | ⑰、规划 §6.3、`docs/ACL配置.md` §3.1 |
| 6 | 失败**立刻回退**（不等满超时），探活上限 = 20 × 500 ms | 旧壳 30 s × 400 ms 等满：体验差、失败面被时间掩盖；先例口径「失败立刻知道坏了」 | 库 §5.10 第 14 条、规划 §4 |
| 7 | **崩溃是终态**，不做自动重启、不做「重试=重启运行时」 | 任何自动重启/恢复：进程内 `node::Start` 每进程一次，假装恢复 = 误导（库宪法 C5、硬约束 ⑥） | 宪法 A5、冻结契约 §5.1 |
| 8 | 日志**双通道**：`payload/node.log`（库标准输出落盘，含渲染组件原生噪声）+ `payload/app.log`（载荷结构化日志） | 只靠 `node.log`：⚠️ ✅ 实测 16 KB 返回里大部分是 `arkweb/chromium_ext/…` | ⑱、库 §5.10 第 5 条、宪法 T8 |
| 9 | 关停：`EntryAbility.onPrepareToTerminate` → `runtime.shutdown()`（Phase 2）；当前 `onDestroy` **只记日志**且不假装能做 | 在 `onDestroy` 里做关闭：进程已进入结束流程，做不到；伪造「已优雅停止」：违反 A5/FR-101-013。⚠️ 现状**代码注释写 Phase 3**、规划写 **Phase 2** ⇒ 以规划为准并在实现时改写注释 | 规划 §5 第 13 条、§11 Phase 2、冻结契约 §2.6（`shutdown()` 亦未经 Node 侧钩子实现） |
| 10 | `launchType: "singleton"` 显式声明 | `specified`/`multiton`：多实例互抢端口与数据目录（⑰）；现状**未声明**（平台默认值未在本机复核，⬜） | 宪法 A8、`../STRUCTURE.md` §2.3 |
| 11 | 顺序纪律：**先建窗/加载内容 → 再投递运行时 → 再申请运行期权限** | 在 `onWindowStageCreate` 里同步起运行时：`APP_INPUT_BLOCK`（先例旧版被系统 ANR 杀掉）；权限弹窗卡启动屏 | 库 §5.10 第 1/11 条、`entryability/EntryAbility.ets:8-10` 注释已写明 |
| 12 | 投递前**物化入口**（只读物化到 `<filesDir>/payload/`），物化失败**不抛**、交给运行时如实报错 | 物化失败直接失败：会把「路径问题」与「运行时问题」混成一个错误，定位更难 | ✅ `PiDesktopRuntime.ets:126-146`（失败只记日志） |

---

## 4. 数据模型（全部来自真实代码 / 配置）

### 4.1 壳侧常量（`entry/src/main/ets/common/Constants.ets`）

| 名称 | 类型 | 值 | 语义 | 备注 |
|---|---|---|---|---|
| `DEFAULT_PORT` | number | `15577` | 探活与 URL 拼接端口 | ⚠️ 写死，违反 ⑰；Phase 1 改为「Node 侧回传」 |
| `PAYLOAD_DIR` | string | `'payload'` | 沙箱内载荷目录（相对 `<filesDir>`） | 与库 `Env.payloadDir()` 同值 |
| `PAYLOAD_ENTRY` | string | `'selfcheck.js'` | 骨架期入口（rawfile 名 = 落盘名） | ⬜ Phase 1 换成载荷入口（`resfile` 直读路径） |
| `PROBE_ATTEMPTS` / `PROBE_INTERVAL_MS` | number | `20` / `500` | 探活次数 / 间隔（≈10 s 上限） | 固定间隔（非指数退避） |
| `DOMAIN` / `TAG` | number / string | `0xD0033` / `'PI_DESKTOP_ARK'` | hilog 域与标签 | 库用同域、TAG `NODE_BRIDGE` ⇒ 一条命令抓全链 |
| `appUrl(port)` | 函数 | `http://127.0.0.1:<port>/` | 渲染入口（被探活复用） | ⚠️ 探活判据与渲染入口耦合，见 §3 决策 4 |

### 4.2 状态枚举与单例字段

| 实体 | 定义 | 值 | 依据 |
|---|---|---|---|
| `UIState`（壳） | 枚举 | `IDLE='idle'` · `LAUNCHING='launching'` · `READY='running'` · `FAILED='failed'` | ✅ `PiDesktopRuntime.ets:7-12` |
| `NodeState`（库，冻结） | 枚举 | `idle` · `starting` · `running` · `failed` · `stopping` · `stopped` | ⚠️ 冻结契约 §2.2 为 6 值；现库实际导出 4 值（`../overall-data-model.md` §1.3） |
| 单例字段 | `state: UIState`（初始 `IDLE`）、`port: number`（初始 `DEFAULT_PORT`）、`lastError: string`（初始 `''`） | — | ✅ `PiDesktopRuntime.ets:27-29` |
| 只读访问器 | `getState()` / `getPort()` / `getLastError()` / `getUrl()` | — | ✅ `:38-52` |

### 4.3 壳 ↔ 库状态映射

| 壳 `UIState` | 库 `NodeState` | 由谁写 | 依据 |
|---|---|---|---|
| `IDLE` | `IDLE` | 初始态 | ✅ |
| `LAUNCHING` | `STARTING` | `launch()` 投递成功后台隐式 | ✅ |
| `READY='running'` | `RUNNING` | 壳探活成功后 `runtime.markRunning()`（库**不做**轮询） | ✅ `:84`；⚠️ 字面同值但语义归属不同（`../ARCHITECTURE.md` §3.1 命名陷阱） |
| `FAILED` | `FAILED` | 投递失败 / 探活超时 → `markFailed(reason)` | ✅ `:74-77,89-93` |

### 4.4 迁移表（as-built）

| # | 当前 | 事件 | 下一 | 触发点 | 副作用 / 痕迹 |
|---|---|---|---|---|---|
| M1 | `IDLE` | 页面挂载后 `launch()` | `LAUNCHING` | `Index.aboutToAppear → launchBackend` ✅ | `lastError=''`；hilog `launch: flags=… script=…` |
| M2 | `LAUNCHING` | 载荷物化成功 | `LAUNCHING` | `preparePayload` ✅ | hilog `载荷已物化：<filesDir>/payload/selfcheck.js` |
| M3 | `LAUNCHING` | 载荷物化失败 | `LAUNCHING` | ✅（不中断） | hilog 记录失败原因，仍按原路径投递（让 Node 报更准的错） |
| M4 | `LAUNCHING` | `start()` 返回 `ok=false` | `FAILED` | ✅ | `lastError = result.message`；UI 变橙 |
| M5 | `LAUNCHING` | 探活第 k 次返回 200 | `READY` | ✅ | `markRunning()`；hilog `READY: <url>`；页面 `loadUrl(url)` |
| M6 | `LAUNCHING` | 20 次探活全失败 | `FAILED` | ✅ | `markFailed('探活超时')`；`lastError` 含次数/间隔/日志路径 |
| M7 | `READY` | 再次 `launch()` | `READY`（不变） | ✅ 早退 | 返回 `already running: <url>`（幂等） |
| M8 | `FAILED` | 点「重试」 | `FAILED`（不变） | ✅ `pages/Index.ets:87-89` | ⚠️ 仅 `loadUrl(url)`，**不重新探活/不重新投递** ⇒ 按 FR-101-011/012 收敛 |
| M9 | 任意 | 进程内运行时崩溃 | ⬜ 应 `FAILED` | ⬜ Phase 1 | 当前表现：**整个应用进程 abort**（✅ 实测）；Phase 1 靠载荷兜底 + 探活失败兜住 + 终态文案 |
| M10 | 任意 | 应用退出 | 进程结束 | ✅ `onDestroy` 只记日志 | ⬜ `onPrepareToTerminate → shutdown()`（Phase 2） |

**不变式**：① 运行时每进程只能启动一次 ⇒ `M1` 全生命周期最多成功一次；② `FAILED` 是吸引态（除 M8 的原地重试外无出边）；③ `port` 一旦被回传覆盖，本进程内不得再改（避免「探活用旧端口、渲染用新端口」的类型错误）。

### 4.5 键值 / 参数通道

| 通道 | 类型 | 生产者 | 消费者 | 语义 |
|---|---|---|---|---|
| `want.parameters['probeFlags']` | string | 启动方（`aa start … --ps probeFlags "…"`） | `EntryAbility.onCreate` ✅ `:23-33` | 调试期覆盖 Node 参数；空串无效（回退默认） |
| `AppStorage['nodeFlags']` | string | `EntryAbility.onCreate` ✅ `:34` | `pages/Index` ✅ `:47-48` | 生效参数；页面读不到时回退 `'--no-verify-heap'` |
| 默认 flags | string | 两处默认值一致（`EntryAbility.ets:23`、`Index.ets:48`） | 库 | `'--no-verify-heap'`；**无授权时必须显式 `--jitless`**（代价 = WASM 全废） |

### 4.6 ⬜ 待新增实体（Phase 1，字段与校验已定稿）

| 实体 | 字段 / 格式 | 生产者 → 消费者 | 校验规则 |
|---|---|---|---|
| 端口回传记录 `<filesDir>/payload/port` | 单行十进制端口 | Node 侧 `listen` 成功后写 → 壳读 | 必须匹配 `^[0-9]{4,5}$` 且落在 `1024–65535`；**缺失/非法 ⇒ 直接 `FAILED`**（不得猜、不得回退 `DEFAULT_PORT`） |
| 探活目标 | `<appUrl>(port) + PROBE_PATH` | 壳 | `PROBE_PATH` 必须是服务真实存在的路径（`/api/web-auth` 或 `/`），且**必须**能在 `AC-101-02` 的反例中被证伪 |
| 日志条目 | `{at:number, stream:'stdout'\|'stderr'\|'system', text:string}` | 库 `logs()` → 壳诊断面板 | 解析失败保留原文（不丢信息） |
| 崩溃记录 | `{at,stage,signal,hint,logTail:string[]}` | 库 `lastCrash()` → 壳 | 缺文件 ⇒ 「无记录」（不是错误）；`logTail` 由壳补日志尾 20 行 |
| 环境变量契约 | 变量名 → 值 → 唯一落点 | 本工程（payload 内赋值 或 库 `env` 选项） | ⚠️ 库现状**无** `env` 字段（冻结契约 §2.3 有）⇒ Phase 1 先按 payload 自设，禁止两处都设 |

---

## 5. 接口契约

### 5.1 提供（本模块对外）

| 契约 | 形态 | 语义 | 现状 |
|---|---|---|---|
| `PiDesktopRuntime.getInstance()` | 静态单例 | 编排器唯一实例 | ✅ |
| `launch(context, flags): Promise<string>` | ArkTS | 执行三段式；返回人读状态串（`READY: url` / `FAILED: …` / `already running: url`）；**不抛**（除非参数异常） | ✅ |
| `getState()` / `getPort()` / `getUrl()` / `getLastError()` | ArkTS | 状态查询（供 103 的 UI 与测试断言） | ✅ |
| `Log.info/error(msg)` | ArkTS | hilog（`DOMAIN=0xD0033`、`TAG=PI_DESKTOP_ARK`） | ✅ `Constants.ets:29-37` |
| `AppStorage['nodeFlags']` | KV | 生效的 Node 参数 | ✅ |
| `scripts/build-bridge-har.sh` | CLI | 构建库 HAR 并拷贝到 `libs/@fellow99/node-bridge.har`；环境变量 `BRIDGE` / `HVIGORW`；失败 `exit 2` | ✅ `:26-33` |
| `scripts/provision-runtime.sh [--check\|--download]` | CLI | 转发 `provision.mjs --out entry/libs/<ABI>`；环境变量 `BRIDGE` / `NODE` / `ABI` / `OHOS_NODE_RUNTIME_DIR`；失败 `exit 2` | ✅ `:20-46` |
| ⬜ 端口回传读取 | 文件读取 | 见 §4.6 | ⬜ Phase 1 |
| ⬜ 关停入口 | ArkTS | `onPrepareToTerminate → runtime.shutdown(reason)` | ⬜ Phase 2 |

### 5.2 消费（库 / 冻结契约）

| 消费项 | 当前用法 | 契约（冻结） | 差距 |
|---|---|---|---|
| `NodeRuntime.getInstance()` | ✅ `PiDesktopRuntime.ets:71` | 进程内唯一 | — |
| `start(context, {scriptPath, flags})` | ✅ `:72` | **投递**语义 + 幂等保护（非 idle ⇒ `code=-1`） | — |
| `markRunning()` / `markFailed(reason)` | ✅ `:84,90` | 仅 `STARTING→RUNNING`；`markFailed` 非 idle 即 `FAILED` | — |
| `getState()` / `getLogPath()` | ✅ `:91` | 状态查询 / 日志路径 | — |
| `Env.ensureDir` / `materializeRawfile` | ✅ `:139-140` | 幂等建目录 / rawfile 物化 | — |
| `NodeStartResult` / `NodeState` | ✅ `:72,3` | `{ok,code,state,message}` | — |
| `isRunning()` / `bridgeVersion()` / `getStage()` / `getLastError()` / `getOptions()` / `getPid()` | ⬜ 未用 | 诊断必需（阶段 + 最近失败） | ⬜ Phase 1（诊断面板） |
| `logs(count?)` / `lastCrash()` | ⬜ 未用 | **永不抛**；读失败返回单条提示 | ⬜ Phase 1（FR-101-014） |
| `waitUntilRunning(timeoutMs?)` | ⬜ 未用 | 轮询原生 `isRunning()`；超时 `markFailed` + reject | ⬜ 库侧未实现；Phase 1 对齐后改用 |
| `shutdown(reason)` | ⬜ 未用 | `RUNNING/STARTING→STOPPING`；**不假装能停 Node** | ⬜ Phase 2（与库同步） |
| `options.env` / `readonlyRoot` / `archive` / `entry` | ⬜ 不可用 | 冻结契约 §2.3 | ⚠️ 现库 `Types.ets` 只有 5 字段 ⇒ **不得**在壳侧假设这些字段存在 |

### 5.3 事件协议

| 协议 | 细节 |
|---|---|
| 就绪探活 | `GET http://127.0.0.1:<port><PROBE_PATH>`；`connectTimeout=800 ms`、`readTimeout=1200 ms`；判定 `responseCode === 200`；间隔 `PROBE_INTERVAL_MS`、上限 `PROBE_ATTEMPTS`；每次必须 `destroy()` 释放句柄（✅ `PiDesktopRuntime.ets:109-123`） |
| 状态迁移 | 壳侧同步调用 `markRunning()` / `markFailed()`；库**不做**轮询（所有权在壳） |
| hilog | `domain 0xD0033`；壳 TAG `PI_DESKTOP_ARK`、库 TAG `NODE_BRIDGE`；阶段文案全部走 `Log.*`（可被 `hdc shell hilog -x` 抓取） |
| 日志文件行（库契约 §1.3） | `<stream> <epochMs> <text>`；`stream ∈ {out,err,sys}`；`sys` 行的文本以 `[node_bridge] ` 或 `CRASH ` 开头；`fd1/fd2` 各接一条 pipe + 独立 reader 线程排空 |
| 崩溃记录（库契约 §1.4） | `<home>/node-bridge/last-crash.json` = `{"at":<ms>,"stage":"running","signal":"SIGSEGV","hint":"…"}`（覆盖写，仅 4 字段） |
| 环境注入（库契约 §1.2） | `envPairs = "K1=V1\nK2=V2"`，上限 4096 B，`setenv(K,V,1)`，在原生默认值之后生效 ⇒ 可覆盖 `HOME`/`TMPDIR`/`NODE_ENV` |

---

## 6. 实现策略

### 6.1 架构模式

单例编排器（`PiDesktopRuntime`）+ 页面驱动（`Index.aboutToAppear` 触发）+ 双状态机（壳可用性 / 库运行时）+ 「投递即返回、就绪靠探活」。壳只做**编排与观测**；端口决策、服务托管、业务全在 Node 侧（宪法 A2）。

### 6.2 关键算法（`launch()` 六步）

```
launch(ctx, flags):
  1) READY 早退 → 'already running: <url>'                      # 幂等（FR-101-019）
  2) state = LAUNCHING；lastError = ''
  3) scriptPath = preparePayload(ctx)                            # ① 物化（失败不抛）
     └ Phase 1 起：改为「读端口回传 + 解析载荷入口（resfile 直读/解包根）」
  4) r = NodeRuntime.start(ctx, {scriptPath, flags})             # ② 投递
     └ !r.ok ⇒ state = FAILED；lastError = r.message；返回 'FAILED: …'
  5) ok = probeReady()                                           # ③ 探活（20 × 500 ms）
     └ ok  ⇒ state = READY；markRunning()；返回 'READY: <url>'
  6)      ⇒ state = FAILED；markFailed('探活超时')
          lastError = '探活超时（N 次 × M ms）；Node 日志：<logPath>'
```

**端口解析（Phase 1 目标形态）**：`port = readPortFile(<filesDir>/payload/port)`（§4.6 校验规则）→ 再探活；读不到端口则**直接 `FAILED`**，绝不回退固定端口。

### 6.3 错误处理

| 失败面 | 处置 | 文案要素 |
|---|---|---|
| 投递失败（`ok=false`） | 立即 `FAILED` + `result.message` 原文上屏 | 阶段 = 「启动运行时」；原因 = 库 message；动作 = 看日志 / 重启应用 |
| 探活超时 | `FAILED` + `markFailed('探活超时')` | 含次数、间隔、日志路径（可截图、可断言） |
| 载荷物化失败 | **不中断**，记录后继续投递 | 让 Node 用「找不到模块」如实报错（错误更贴近现场） |
| 端口被占用 | 载荷侧 `error` 处理 + 兜底（102）+ 端口随机（本模块） | 界面出现「端口不可用」类可读原因，**不得**表现为进程消失 |
| 崩溃 | 终态 `FAILED` + 「请重启应用」；**不实现**自动重启 | 明确否定自动恢复（FR-101-012） |
| 关停超时 | 到上限直接结束（不阻塞退出） | 日志记录「关停未完成，进程退出」 |

### 6.4 性能

- 探活窗口总预算 ≈10 s（20 × 500 ms），低于 `NFR-ARK-001` 的 15 s 首启预算；探活只做 `GET` + `destroy()`，无重定向跟随。
- 投递动作放在页面 `aboutToAppear`（异步、立即返回），UI 线程不做阻塞等待（先例教训：UI 线程起运行时 ⇒ `APP_INPUT_BLOCK`）。
- 二次启动走幂等早退，不重复物化/投递（`AC-101-11`）。
- 物化是**覆盖写**（幂等）；`resfile` 直读路线落地后零解压（102）。

---

## 7. 测试考虑

| 用例 | 覆盖 FR | 判据（看哪里） | 现状 |
|---|---|---|---|
| `TC-101-001` 依赖接线 | FR-101-001 | `ohpm install` 后 `oh_modules/@fellow99/node-bridge` 存在；构建不报 `00309001` | ✅ 通过 |
| `TC-101-002` 探活判据与真实端点一致 | FR-101-006 | `curl -o /dev/null -w '%{http_code}' <端点>` 与就绪状态一致 | ⚠️ **现状不通过**（探 `/`，骨架载荷只答 `/facts`、`/log`）⇒ 本模块 §9 第 4 条收口 |
| `TC-101-003` 载荷物化 | FR-101-004 | `<filesDir>/payload/selfcheck.js` 存在且内容 = rawfile 原文；hilog `载荷已物化：…` | ✅ 通过 |
| `TC-101-004` `start()` 幂等 | FR-101-019 | 二次 `launch()` 返回 `already running: …`；库侧二次 `start()` 返回 `ok=false` 且 message 含「只能启动一次」 | ⬜ 待执行（Phase 1，需可注入的调试入口） |
| `TC-101-005` 环境契约生效 | FR-101-016 | 载荷内读 `process.env`：`PI_CODING_AGENT_DIR`/`PI_OFFLINE` 为期望值；`HOME`/`TMPDIR` 在 `<filesDir>` | ⬜ 待执行（Phase 1，需端点输出 env 子集） |
| `TC-101-006` 随机端口 + 回传 | FR-101-008/009 | 连续 3 次启动端口不固定；占用任一候选端口仍能起；`payload/port` 与服务自报端口一致 | ⬜ 待执行（Phase 1，⑰） |
| `TC-101-007` 单实例显式声明 | FR-101-010 | 配置含 `launchType: "singleton"`；二次启动不产生第二实例（`aa dump -l`） | ⬜ 待执行（Phase 1） |
| `TC-101-008` 崩溃终态 UX | FR-101-012 | 注入一次载荷崩溃后：界面终态失败 + 「请重启应用」；**不出现**自动重启 | ⬜ 待执行（Phase 1） |
| `TC-101-009` 优雅关停 | FR-101-013 | 关闭窗口触发关停钩子（日志可见）、超时才强退、再启动能就绪 | ⬜ 待执行（Phase 2；库侧 `shutdown()` 亦未实现） |
| `TC-101-010` 日志面板读回 | FR-101-014 | 点「日志」后界面出现非空日志文本（含服务侧行） | ⬜ 待执行（Phase 1） |
| `TC-101-011` 载荷异常兜底 | FR-101-015 | 载荷内异常后进程**仍存活**，`payload/app.log` 有记录 | ⬜ 待执行（Phase 1，⑱） |
| `TC-ARK-004` 启动无崩溃 | FR-101-005 | `hilog` 中 `Cpp Crash` 0 命中 | ✅ 通过（2026-10-16） |
| `TC-ARK-005` JIT/WASM 档位 | FR-101-003 | `/facts` 的 `wasm.available`/`wasm.validate` = true；热循环 6–9 ms/2e6；`execArgv=['--no-verify-heap']` | ✅ 通过 |
| `TC-ARK-006` 日志读回通道 | FR-101-014 | `curl /log` 非空且含库/载荷输出行（⚠️ 混入渲染组件噪声，已知） | ⚠️ 通过 |
| `TC-ARK-008` 单实例 | FR-101-010 | 二次 `aa start` 后 `aa dump -l` 只一条实例 | ⬜ 待执行（Phase 1） |
| `TC-ARK-009` 端口冲突可见失败 | FR-101-008/011 | 占用候选端口后启动：界面出现可截图失败态，**没有**进程静默消失 | ⚠️ **现状不通过**（✅ 已实测整进程 abort） |

> **禁止的判据**（`../overall-test-cases.md` §4）：`uitest dumpLayout` 返回值、hilog「有没有那一行」、`VmSize` 判 V8、点一下看起来生效、以「重试后成功」掩盖首次失败。

---

## 8. 文件清单（真实行数：`wc -l`）

| 文件 | 作用 | 行数 | 状态 |
|---|---|---|---|
| `entry/src/main/ets/app/PiDesktopRuntime.ets` | 三段式编排、`UIState` 状态机、探活、物化入口 | **154** | ✅ 骨架 |
| `entry/src/main/ets/common/Constants.ets` | 端口/载荷/探活常量、`appUrl()`、hilog `Log` | **37** | ✅ |
| `entry/src/main/ets/entryability/EntryAbility.ets` | Ability 生命周期、`probeFlags` → `AppStorage`、`loadContent` | **61** | ✅（⬜ 关停接线） |
| `entry/src/main/module.json5` | 模块声明 + 24 权限 + 2 `definePermissions` + `taskKeeping` | **166** | ✅（⬜ `launchType`） |
| `oh-package.json5` | 依赖接线（`file:./libs/@fellow99/node-bridge.har`） | **15** | ✅ |
| `oh-package-lock.json5` | 锁文件（`0.1.0`，`registryType: local`） | **18** | ✅ |
| `scripts/build-bridge-har.sh` | 构建库 HAR 并拷贝（`00309001` 的处置） | **41** | ✅ |
| `scripts/provision-runtime.sh` | 转发 `provision.mjs`（幂等 + 门禁） | **46** | ✅ |
| `libs/@fellow99/node-bridge.har` | 库构建产物（含引导件 `libnode_bridge.so`） | 二进制 **441,353 B** | ✅（不入库，T4） |
| `entry/libs/arm64-v8a/libnode.so` | Node v24.2.0 运行时 | 二进制 **126,809,264 B** | ✅（不入库） |
| `entry/libs/arm64-v8a/libc++_shared.so` | C++ 运行时 | 二进制 **1,262,504 B** | ✅（不入库） |
| `hvigorfile.ts` | 签名材料注入 / 补 `products[].signingConfig` 指针 | **152** | ✅ |
| `build-profile.json5` | 产品、SDK、`useNormalizedOHMUrl`、本机签名材料（未提交） | **61** | ✅（T3） |
| `entry/build-profile.json5` | 模块构建（`collectAllLibs`，不编译 C++） | **17** | ✅ |
| `AppScope/app.json5` | 包名 / 版本 / label / API 级别 | **13** | ✅ |
| ⬜ `entry/src/main/ets/common/Stages.ets` | 阶段文案常量（T6 收敛落点） | 待建 | ⬜ Phase 1 |
| ⬜ `entry/src/main/ets/app/PortFile.ets` | 端口回传读取 + 校验（§4.6） | 待建 | ⬜ Phase 1 |

---

## 9. Phase 1 / Phase 2 待实现清单

| # | 待实现项 | 实现需求 | 验收判据（可证伪） | 依据 |
|---|---|---|---|---|
| 1 | **端口随机/先探测空闲** + Node 侧回传 `<filesDir>/payload/port`，壳只读不猜 | FR-101-008/009 | 占用 `15577` 后仍能到就绪；`payload/port` 与 `/facts` 自报端口一致；3 次启动端口不同（`TC-101-006`） | ⑰、规划 §6.3、§3 决策 5 |
| 2 | **`launchType: "singleton"`** 显式声明（`module.json5` `abilities[0]`） | FR-101-010 | 配置断言含该键；`aa dump -l` 仅一条实例（`TC-101-007`） | 宪法 A8、规划 §5 第 16 条 |
| 3 | **优雅关停接线**：`onPrepareToTerminate` → `runtime.shutdown()`（含超时上限） | FR-101-013 | 关停日志可见 + 退出不超上限 + 再启动能就绪（`TC-101-009`） | 规划 §5 第 13 条 / §11 Phase 2、§3 决策 9 |
| 4 | **探活端点收口**（`/api/web-auth` 或 pi-web 的 `/`），并保留反例可证伪 | FR-101-006 | `TC-101-002` 通过 + `AC-101-02` 反例成立 | `../ARCHITECTURE.md` §3.4 |
| 5 | **日志读回**：诊断面板接库 `logs()`/`Logger.tail()` + `lastCrash()` | FR-101-014 | 界面出现非空日志尾与崩溃字段（`TC-101-010`、`AC-101-08/09`） | T8、库契约 §2.6/§2.9 |
| 6 | **载荷异常兜底验收**（补充：`listen` 的 `error` 处理把 `EADDRINUSE` 变成可读错误） | FR-101-015 | 注入异常后进程存活 + `payload/app.log` 有记录（`TC-101-011`） | ⑱、宪法 A9 |
| 7 | **环境变量装配**（`PI_CODING_AGENT_DIR`/`PI_OFFLINE`/`NO_PROXY` 等，唯一落点） | FR-101-016 | `TC-101-005` 通过（端点读回 env 子集） | 规划 §7.4、`../overall-data-model.md` §3 |
| 8 | **诊断状态查询**：`getStage()`/`getLastError()`/`isRunning()` 接入 UI 文案 | FR-101-020 | 状态条与阶段文本可截图对应；失败文案含阶段 | 库契约 §2.6 |
| 9 | **失败态完整化**（阶段 + 原因 + 下一步；重试语义 = 重做可重做阶段） | FR-101-011/012 | `AC-101-07`、`TC-101-008`；「重试」不得声称重启运行时 | 宪法 A5、`../overall-plan.md` §4.1 |
| 10 | **`.har` 入库策略定稿**（当前不入库；新机器必须两步脚本） | FR-101-001/002 | 从干净 clone 到 `assembleHap` 成功的步骤可复现（L0 门禁） | T4、规划 §14.1 备注 |
| 11 | **库 API 面补齐后的切换**：`waitUntilRunning()` 替代自建探活循环、`env` 选项替代 payload 自设 | FR-101-005/016 | 切换后 `TC-101-004/005` 仍通过，且自建循环删除 | 冻结契约 §2.3/§2.6、`../overall-data-model.md` §1.3 缺口 |
| 12 | **T6/T9 收敛**：阶段文案集中到常量模块；把 `TODO(Phase N)` 注释改为 `⬜ 规划未实现（Phase N）`（并修正 `onDestroy` 的 Phase 3 → Phase 2） | FR-101-018 | 代码中不再出现 `TODO(`；阶段文案只有一处来源 | 宪法 T6/T9、§2.2 判定 |

> 依赖顺序：`[1 端口] → [4 探活收口] → [5 日志读回] → [9 失败态]`；`[2 单实例]` 与 `[7 环境]` 可并行；`[3 关停]` 需库侧 `shutdown()` 到位后联调（Phase 2）。
