# plan.md —— `104-host-capabilities-arkts-impl` 宿主能力（ArkTS 实现 / 实现特定）

> 本文件写「**怎么做**」：技术上下文、宪法逐条合规、决策与替代方案、能力的真实字段与校验规则、接口契约、实现策略、测试与文件清单、Phase 待实现项。
> 需求侧（要什么 + 验收判据）在 [`spec.md`](spec.md)（`FR-104-*` / `AC-104-*` / `NFR-104-*`）；本文件**只引用不复制**。
> 依据：规划 [`../../docs/000-工程规划.md`](../../docs/000-工程规划.md) **§5 第 8/9/10/11/15 条**、**§8.2 ③**、**§8.3**（旧壳资产）、**§12 O8**、**§7.4**、**§11 Phase 2**；
> 库契约 [`../../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md`](../../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md) **§2.7 / §5.4**；分层见 [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §4/§8。
> **现状口径**：⬜ 本模块**未开始**（`entry/src/main/ets/host/` 不存在；库 `HostBridge` 注册表为空；本工程 0 个处理器）。

---

## 1. 技术上下文

| 项 | 值 |
|---|---|
| 语言 / 框架 | ArkTS 严格模式（宪法 T1：不用 `any`/`unknown`；取 context 走 `this.getUIContext().getHostContext()`） |
| 运行位置 | 应用主线程（UI 线程）；**无**独立线程、**无**子进程 |
| 落点目录 | `entry/src/main/ets/host/`（`STRUCTURE.md` §1/§6/§8 已指定；**不得**写进 `pages/` 或 `app/`） |
| 对外通道 | 库宿主能力桥：`HostBridge.register(name, handler)` / `list()` / `stats()`（冻结契约 §2.7） |
| 能力名 | 八个**冻结名**（`spec.md` §1.1 表；库 `HostBridge.ets:25-34` 逐字一致 ✅） |
| 系统 API 面（待实现） | `abilityAccessCtrl`（`checkAccessTokenSync`）、`startAbility`（外链 / 设置页）、`@kit.NotificationKit`（`notificationManager`）、`@kit.ArkData`（`preferences`）、`window`（尺寸）、`@kit.CoreFileKit`（picker）、`@kit.ArkUI`（`UIContext`） |
| 旧壳资产（复用） | `pi-desktop-hos/src-main/main.js`：主目录清单 `:339-357`、权限桥 `:374-408`、外链分流 `:1090-1147`、窗口状态 `:962-1004`、环境装配 `:237-307` |
| 关键未知 | ① 库传输层（Phase 2，冻结契约 §0）② 库 handler 签名**同步**（同 §2.7）与 5/8 异步能力的冲突 ③ 选择器最优形态（O8）④ ArkWeb Cookie/围栏细节（属 103） |

---

## 2. 宪法合规检查（逐条）

| 原则 | 判定 | 理由（现状证据 / 本方案处置） |
|---|---|---|
| **A1 一切经 HTTP** | ✅ | 桥只承载**宿主能力调用**；`FR-104-006` 明文禁止业务数据过桥（会话/消息/流式/进度）；能力入参出参都是能力语义（路径、权限名、URL） |
| **A2 壳薄、契约硬** | ✅ | 八条能力全部是宿主语义（授权、选择器、外链、通知、系统日志、窗口），业务仍在 Node 侧；每条都能指回规划 §5 的条目号（见 §3 `D-104-1`） |
| **A3 运行时结论以库文档为准** | ✅ | 本文件只引用库 §5.4 / 冻结契约 §2.7 与 `docs/ACL配置.md`；不重复论证 JIT/spawn/端口结论 |
| **A4 不改上游** | ✅ | 本模块不碰 `pi`/`pi-web`；工作区供数走**环境变量 + 既有补丁**（`P-ark-2`，规划 §9），无新增补丁 |
| **A5 失败可见** | ⚠️ | 设计上每个能力都有结构化错误 + 系统日志双通道（`FR-104-004/021/030`）；但**当前无实现** ⇒ 上屏位置依赖 `103` 的错误页/诊断面板（仍未落） |
| **A6 不隐藏平台真相** | ⚠️ | `FR-104-016/027` 已把「未授权 / 不可判定」写死；但**形态未实现**（Phase 2），且「用户目录直写」在授权前后必须真机各跑一次 |
| **A7 判据可证伪** | ✅ | `AC-104-*` 全部写明观测点（截图 / 可解析 JSON / 系统日志），未使用任何被禁判据（`dumpLayout`、「看起来生效」、「日志里有那一行」） |
| **A8 单实例与随机端口** | ✅（不越界） | 端口与单实例属 `101`；本模块**不**自建服务/端口，只消费 `101` 的端口与 `runtime.facts` 的读回值 |
| **A9 异常兜底** | ✅（分工） | 载荷兜底属 `101`/`102`；本模块**必须**在 handler 内自捕获（`§6.3`），不把异常穿透给库（库的 `handler-threw` 是最后一道） |
| **A10 声明面 ≠ 授权面** | ⚠️ | `FR-104-011` 禁止本模块改权限面；但**能力可用性依赖 Profile**（现役仅 1 项 ACL；目录授权与 `FILE_ACCESS_PERSIST` 已于 2026-10-19 撤销），任何权限面改动必须重走装机复验 |
| **T1 ArkTS 严格模式** | ⚠️ | 规约成立；实现时**必须**用 `UIContext` 取 context（现状 `Index.ets:32-38` 已是正例），**不得**用弃用的全局 `getContext(this)` |
| **T2 资源三语一致** | ⚠️ | 本模块会新增文案（未授权提示、通知占位、AI 标识属 `107`）⇒ 新增键**必须**同时补 `base`/`zh_CN`/`en_US`（现状 `module_desc`/`EntryAbility_*` 仅 base，Phase 3 前补齐） |
| **T3 签名材料不入库** | ✅ | 本模块不触碰签名链路 |
| **T4 二进制不入库** | ✅ | 本模块只加 `.ets`，不加原生件/大载荷 |
| **T5 路径一律绝对** | ✅ | `FR-104-015`/`NFR-104-006` 要求回传绝对路径；不依赖 `process.cwd()`（真机 `/`）与 `process.execPath`（`/system/bin/appspawn`） |
| **T6 常量集中** | ⚠️ | 新增常量（日志上限、通知长度上限、偏好键名、主目录 id）**必须**进 `common/Constants.ets`（或 `host/` 内的常量段），页面与编排层不写字面量 |
| **T7 原生库只经 HAR** | ✅ | 本模块不引原生层 |
| **T8 日志谁写谁读** | ⚠️ | `log.hilog` 双通道（`FR-104-023`）；读回路径依赖 `101` 的 `/log` 与诊断面板（未落） |
| **T9 阶段分级标注** | ✅ | 本文件与 `spec.md` 全部实现项标 `⬜ 规划未实现（Phase 2）` |

---

## 3. 研究结论（决策 / 替代方案 / 为何否掉）

| 编号 | 决策 | 替代方案 | 为何否掉 |
|---|---|---|---|
| `D-104-1` | **能力实现在应用侧，库只做注册表 + 传输** | 让库顺手实现 `perm.check` / 选择器 | 库宪法 C1 一票否决（宿主语义进库）；库现有 `HostBridge.ets:18-25` 注释已把「实现不在本库」写死 |
| `D-104-2` | 八条能力**逐条独立文件**，由一个注册器统一 `register` | 一个大文件里写八个 `if` | 单文件会同时包含权限、选择器、通知、窗口四套系统 API 的导入，评审与替换都难；独立文件便于「按能力真机验收」 |
| `D-104-3` | **异步能力在库放宽签名前返回 `unavailable`，不返回假成功**（`§5.1`） | 同步阻塞等 picker（不可行）；返回 `ok:true` 后再想办法（掩盖问题） | ⚠️ 冻结契约 §2.7 的 handler 是**同步** `(argsJson: string) => string`（`Types.ets:159`），而系统选择器/通知/`startAbility` 本质异步；库规划 §5.4 描述的是「入队 → ArkTS 主线程 → 结果回投」（异步形态）⇒ **两份材料不一致**，必须由库改契约（库宪法 §六.1）而不是在壳里伪造 |
| `D-104-4` | 权限判定用**三态**（`granted`/`denied`/`unknown`） | 直接用布尔 | 🔶 旧壳真机实测「授权后 `checkPermission` 仍可能返回 `false`」（假阴性）⇒ 布尔会把「预检意见」误当结论；三态 + 「以真实读写结果为准」是唯一不撒谎的形状 |
| `D-104-5` | 选择器返回**授权 URI**，能被 Node 直读则直读，否则 **copy 到 `<filesDir>` 后回传沙箱路径** | 把文件内容经桥回传 | 库契约 §5.4 明确「只回传沙箱内路径，不回传内容（大文件走 copy）」；内容过桥会撞 8 MiB 上限并违反 A1 精神 |
| `D-104-6` | 外链走**隐式 want 交系统处理**，另备「应用内承载页」路线 | 照抄旧壳 `ExternalWeb.Open` 桥调用 | ⚠️ 旧壳该桥**从未注册**，调用即整进程 SIGSEGV（🔶 旧壳 `R15` / 能力清单 #28）⇒ 禁止复现；本工程**只调用自己注册过的能力** |
| `D-104-7` | 主目录清单**沿用旧壳 JSON 形状**（`[{id,label,path,permType}]`，环境变量 `PI_HOS_ROOTS`） | 自定义形状 / 让助手自己猜 | 旧壳补丁链（`patches/v0.12.1/0001`）与 `harmony-workspace-roots.js` 已按该形状消费 ⇒ 复用即零补丁（`P-ark-2` 直接沿用） |
| `D-104-8` | 窗口状态**先做尺寸**，位置留空 | 位置 + 最大化 + 多屏 | 2in1/平板形态下位置语义不确定；旧壳位置逻辑绑定 `screen.getAllDisplays`（Electron 面），搬迁成本高于收益（规划 §2.2 把窗口状态列为「可直接删掉」的一类体验项，本工程只保留最小版） |
| `D-104-9` | 「围栏判定」留在 `103`，「外链动作」放本模块能力 | 两边都写一份判定 | 双份判定会漂移；`TC-103-006/007` 已把判定归 103 |
| `D-104-10` | 沙箱工作区根取 **`<filesDir>/workspace`**（清单的 `id=sandbox` 项） | 把「默认 cwd 目录」（`<filesDir>/pi-cwd/`）当工作区根 | ⚠️ 两个名字**语义不同**：并行落地已把二者分开定义 —— `payload/env.js:44-47` 的 `DEFAULT_CWD_DIRNAME='pi-cwd'`（默认 cwd）与 `SANDBOX_DIRNAME='workspace'`（选择工作区目录对话框的沙箱 Tab），`entry/src/main/ets/common/Constants.ets` 同样两者并存（`CWD_DIR_NAME` / `SANDBOX_DIR_NAME`）。⇒ 结论：**并存，不冲突**；`overall-data-model.md` §4.2 的 `pi-cwd/` 指默认 cwd，清单的沙箱根仍取 `workspace`（与旧壳 `installWorkspaceRoots` 同形，🔶 `main.js:339`） |

---

## 4. 数据模型（真实字段 / 校验规则）

### 4.1 能力注册表项

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 八个冻结名之一（白名单校验，见 §4.7） |
| `handler` | `(argsJson: string) => string` | **同步**（受库当前签名约束）；内部**必须**自捕获异常（§6.3） |
| `invocations` / `errors` | `number` | 由库 `stats()` 统计（`{"count","names","invocations","errors","capBytes"}`，契约 §2.7） |

### 4.2 八个能力的入参 / 出参 schema（JSON 字符串，键名冻结于本表）

> 共享形状：成功 = `{"ok":true,…}`；失败 = `{"ok":false,"error":"<code>",…}`（`error` 码见 §4.3）。
> **「取消」不是失败**：`{"ok":true,"cancelled":true}` —— 便于调用方把「用户放弃」与「系统拒绝」分开处理。

| 能力 | 入参（JSON） | 出参（JSON） |
|---|---|---|
| `runtime.facts` | `{}` 或 `{"keys":["node","logPath","capabilities"]}` | `{"ok":true,"node":{"state":"idle\|starting\|running\|failed","isRunning":bool,"stage":"…","bridgeVersion":"…","lastError":"…"},"port":<实际端口>,"logPath":"<abs>","logReadback":{"endpoint":"/log","maxBytes":16384},"capabilities":["runtime.facts",…],"stats":{"invocations":0,"errors":0,"capBytes":8388608},"ui":{"state":"launching\|running\|failed"}}` |
| `perm.check` | `{"name":"ohos.permission.READ_PASTEBOARD"}` 或 `{"alias":"directory_desktop"}` | `{"ok":true,"name":"<解析后的权限名>","status":"granted\|denied\|unknown","source":"checkAccessTokenSync\|bridge-unavailable","hint":"permission_denied_hint\|permission_unknown_hint"}`（`hint` 只在 `denied`/`unknown` 时出现，值是**资源键**而不是硬编码文案 ⇒ T2） |
| `perm.openAppInfo` | `{}` | `{"ok":true,"opened":true}` / `{"ok":false,"error":"unavailable","message":"<可读原因>"}` |
| `fs.pickFiles` | `{"mode":"single\|multiple","types":["txt","md"],"startDir":"<abs 可选>","copyToSandbox":bool,"maxBytes":<n>}` | `{"ok":true,"cancelled":false,"paths":["<abs>",…],"copied":bool,"note":"copied-into-sandbox\|direct-path"}`；取消：`{"ok":true,"cancelled":true,"paths":[]}` |
| `fs.pickFolder` | `{"startDir":"<abs 可选>"}` | `{"ok":true,"cancelled":false,"path":"<abs>","readable":bool,"permission":{"status":"granted\|denied\|unknown","alias":"directory_desktop"}}`；取消：`{"ok":true,"cancelled":true,"path":""}` |
| `shell.openExternal` | `{"url":"https://…"}` | `{"ok":true,"handled":"system-browser\|in-app-page","url":"<原样回显>"}` |
| `notify.show` | `{"title":"…","text":"…","id":<n 可选>,"silent":bool}` | `{"ok":true,"published":true}` |
| `log.hilog` | `{"level":"info\|warn\|error","text":"…","tag":"<可选>"}` | `{"ok":true,"hilog":true,"file":true}`（两条通道各自的结果，便于诊断「哪条断了」） |

### 4.3 错误码表（与库不冲突）

| `error` | 产生方 | 语义 |
|---|---|---|
| `unregistered` · `handler-threw` · `payload-too-large` · `bad-args` | **库**（冻结契约 §2.7，字面量不得改） | 未注册 / 处理器抛错 / 入参超限 / 入参非法 |
| `denied` | 本模块 | 权限未授予（用户可见结论） |
| `not-authorized` | 本模块 | 目标路径位于受保护目录且未授权（`FR-104-016`） |
| `unavailable` | 本模块 | 能力**当前不可达**（异步通道未就绪 / 系统 API 缺失 / 桥未装）—— 明确不撒谎（C2/A6） |
| `copy-failed` | 本模块 | 大文件 copy 到沙箱失败（附可读原因） |
| `too-long` | 本模块 | 文本超上限（日志 2 KiB / 通知标题 64 字符 / 通知正文 256 字符） |
| `bad-url` | 本模块 | 非绝对 URL 或 scheme 不在允许集合（`http`/`https`/`mailto`） |
| `timeout` | 本模块 | 单次调用超过时限（Phase 2 目标 30 s，契约 §5.4 超时口径） |

### 4.4 工作区主目录记录（`PI_HOS_ROOTS` 形状）

```json
[ {"id":"sandbox","label":"沙箱","path":"<filesDir>/workspace","permType":null},
  {"id":"desktop","label":"桌面","path":"/storage/Users/currentUser/Desktop","permType":"directory_desktop"},
  {"id":"documents","label":"文档","path":"/storage/Users/currentUser/Documents","permType":"directory_document"},
  {"id":"download","label":"下载","path":"/storage/Users/currentUser/Download","permType":"directory_download"} ]
```

- 形状**逐字沿用**旧壳（🔶 `main.js:349-355`）；沙箱项 `permType: null`（或空）表示「沙箱内，无 OS 权限门槛」（`harmony-workspace-roots.js:86` 的口径）；
- 沙箱根**必须**在写入清单前创建（幂等），创建失败**必须**在清单里如实体现（不复用「目录存在即就绪」的假判据，宪法 A7）；
- 沙箱根名 = `<filesDir>/workspace`（与并行落地一致：`payload/env.js:45` 的 `SANDBOX_DIRNAME`、`entry/src/main/ets/common/Constants.ets:59` 的 `SANDBOX_DIR_NAME`；`env.js:41` 的 `DEFAULT_CWD_DIRNAME='pi-cwd'` 是**默认 cwd**，不是清单项）；清单缺席时 `payload/env.js#buildRoots` 会**兜底构造**四项（并 `warn`），本模块**必须**让该兜底在自检输出里可见（`FR-104-028`）。

### 4.5 窗口状态偏好记录

| 键 | 值 | 校验 |
|---|---|---|
| `window_state_v1` | `{"width":<n>,"height":<n>,"updatedAt":<epochMs>}` | 整数、`width ≥ 600`、`height ≥ 480`、不超过当前屏幕可用尺寸；非法值 ⇒ 丢弃并回退默认（不静默沿用坏值） |

### 4.6 权限判定规则

| 输入 | 输出 | 规则 |
|---|---|---|
| 已知权限名/别名 + 接口可用 + `PERMISSION_GRANTED` | `granted` | 直接映射 |
| 同上 + `PERMISSION_DENIED` | `denied` | 附 `hint`（去系统设置） |
| 接口缺失 / 抛错 / 名字不在白名单 / 非本应用权限 | `unknown` | **不得**降级为 `denied`（会把「不知道」说成「没有」） |

### 4.7 校验规则（handler 入口统一执行）

1. **能力名**：必须命中八个冻结名（白名单）；未命中 ⇒ 库侧 `unregistered`（本模块不注册别名）。
2. **入参**：必须是合法 JSON 对象；解析失败 ⇒ `bad-args`；未知键**忽略但记日志**（不静默）。
3. **长度**：见 §4.3 `too-long` 的三个上限。
4. **凭据卫生**：`notify.show` 与 `log.hilog` 的文本**必须**过一遍凭据模式检查（`sk-`、`Bearer `、`eyJ`、`-----BEGIN`），命中即拒（`bad-args` + 系统日志一行）。
5. **路径**：回传路径**必须**绝对；`copyToSandbox` 的目标**必须**落在 `<filesDir>` 之内（越界 ⇒ `not-authorized`）。
6. **URL**：`shell.openExternal` 只接受绝对 URL 且 scheme ∈ {`http`,`https`,`mailto`}；其余 ⇒ `bad-url`。

---

## 5. 接口契约

### 5.1 提供（本模块对外）

| 符号 | 形状 | 说明 |
|---|---|---|
| `registerHostCapabilities(runtime, ctx): string[]` | 同步 | 把八个 handler 注册进 `runtime.host`，返回**实际注册成功**的名字清单（用于 `runtime.facts` 与日志；不返回清单即无法证明注册过） |
| `handleRuntimeFacts` / `handlePermCheck` / `handlePermOpenAppInfo` / `handlePickFiles` / `handlePickFolder` / `handleOpenExternal` / `handleNotifyShow` / `handleLogHilog` | `(argsJson: string) => string` | 每个能力一个导出；**永不抛异常**（§6.3）；签名与库当前冻结类型一致 |
| `buildWorkspaceRoots(ctx): WorkspaceRoot[]` | 同步 | 生成 §4.4 的四个根（含创建沙箱根） |
| `installWindowState(win, ctx): void` / `applyWindowState(win, ctx): void` | 同步 | 尺寸记忆最小版（读取 + 防抖写入） |

### 5.2 消费（依赖面，逐个列）

| 依赖 | 用途 | 现状 |
|---|---|---|
| `HostBridge.register / list / has / stats / setCapBytes` | 注册与自检 | 库骨架 ✅（传输 ⬜ Phase 2） |
| `NodeRuntime.getInstance().getState()/isRunning()/getStage()/getLastError()/getLogPath()/bridgeVersion()` | `runtime.facts` 的数据源 | 库骨架部分 ✅（`getStage`/`getLastError`/`bridgeVersion` 属冻结契约 §2.6，本工程尚未使用） |
| `Logger.tail(path, maxBytes)` / `Logger.info/warn/error` | 双通道写日志 + 读回 | ✅ 存在；`tail` 的 UTF-8 解码缺陷属库侧（契约 §2.9） |
| `abilityAccessCtrl.checkAccessTokenSync` | `perm.check` | ⬜ 待真机验证三态映射 |
| `startAbility(want)`（设置页 / 外链） | `perm.openAppInfo` / `shell.openExternal` | ⬜ 待真机验证（含「外链是否必须走应用内承载页」的取舍） |
| `@kit.NotificationKit` `notificationManager` | `notify.show` | ⬜（v1 按需；未授权时必须 `denied`） |
| `@kit.ArkData` `preferences` + `window.getLastWindow` + `on('windowSizeChange')` | 窗口尺寸记忆 | ⬜ 待实现（防抖 400 ms，沿用旧壳口径 `main.js:1001`） |
| `@kit.CoreFileKit` picker（`DocumentViewPicker` 等） | `fs.pickFiles` / `fs.pickFolder` | ⬜ 待真机验证（O8 两形态） |
| 上游工作区补丁 `patches/v0.12.1/0001-workspace-picker-roots.patch`（🔶 1294 行） | 让工作目录对话框消费 `PI_HOS_ROOTS` | 归 `106` 执行；本模块只负责**供数** |

### 5.3 事件协议（能力调用信封）

```
Node 侧（助手）                        ArkTS 侧（本模块）
host.invoke('perm.check', {"name":"…"}) ──► dispatch(name, argsJson)
                                           └── handler(argsJson) ⇒ JSON 字符串（原样透传）
                       ◄── resolve(解析后的对象) ──┘
```

- 成功**不包装**（契约 §2.7：包装会逼迫消费方写两套解析）；失败一律 `{"ok":false,"error":…}`；
- **禁止**在信封里放业务数据（`FR-104-006`）；能力调用的入参**不得**包含文件内容；
- 超时与并发上限由库的传输层负责（Phase 2；契约 §5.4 目标默认 10 s、本工程按 §4.3 记 30 s 上限并需与库对齐）；
- **阻塞项**：库 `HostBridgeHandler` 目前同步（`Types.ets:159`）⇒ 异步能力**必须**按 `D-104-3` 返回 `unavailable`，直到库放开签名（见 `§9` 第 1 项）。

---

## 6. 实现策略

### 6.1 架构模式

- **单一注册器 + 每能力一文件 + 无状态 handler**（`D-104-2`）；handler 只做「解析 → 系统调用 → 组装 JSON」三段，不持有跨调用的可变状态；
- 需要进程级状态的两处（窗口偏好、主目录清单）**唯一**落点：`host/WindowState.ets`、`host/WorkspaceRoots.ets`；
- 注册时机：**首屏之后**、`launch()` 之前（能力注册无用户可见副作用；权限申请另按 `FR-104-010` 在首屏之后）。

### 6.2 关键算法

1. **picker → 路径回传**：选择器返回 URI → 解析为绝对路径（`fileUri` 类 API，⬜ 待实测）→ 若 Node 不能直读（安装目录/受保护目录）⇒ **copy** 到 `<filesDir>/pi-cwd/` 或工作区根 → 回传**沙箱内绝对路径**（`D-104-5`）。
2. **权限三态**：`checkAccessTokenSync` → §4.6 映射；对「已知的假阴性」项，出参里**必须**保留 `source` 字段，让上层知道这是预检意见。
3. **双通道日志**：先写 `hilog`（本地系统日志，TAG/DOMAIN 沿用 `Constants.ets:3-4` 的 `0xD0033` / `PI_DESKTOP_ARK`），再写宿主日志文件；任一抛错**不影响**另一条（`FR-104-023`）。
4. **窗口尺寸防抖**：`windowSizeChange` → 400 ms 防抖 → 写偏好（沿用旧壳 `main.js:1001` 的 400 ms）；退出前**必须**再写一次（`onPrepareToTerminate` 属 `101`，本模块提供 `flush()`）。
5. **主目录清单**：创建沙箱根（幂等）→ 组装四项 → 逐项探测（存在/可读）→ 权限预检填 `permType` 对应状态 → 以 `PI_HOS_ROOTS` 形状供数（`D-104-7`）。

### 6.3 错误处理

- handler **必须**整体 `try/catch`，把异常转成 `{"ok":false,"error":"<码>","message":"<可读原因>"}`；**不依赖**库的 `handler-threw` 兜底（那是最后一道，且其 `detail` 会带内部异常串）；
- `catch` 之后**不得继续**当作成功返回（宪法 A5 禁止 `catch` 后继续）；
- 每一次失败**必须**同时进系统日志（可抓取）与宿主日志（可读回）。

### 6.4 性能

| 面 | 预算 / 纪律 |
|---|---|
| `runtime.facts` / `perm.check` / `log.hilog` | 同步、微秒—毫秒级；**不得**做文件 IO（`runtime.facts` 只读内存态） |
| 选择器 / 通知 / 外链 | 异步；等待用户期间**必须不**阻塞主线程（`NFR-104-001`） |
| copy | 大文件 copy 与选择器同批异步执行；**不得**在主线程同步读大文件 |
| 入参 | ≤ 8 MiB（库 `capBytes`）；单次调用 ≤ 30 s（超时后返回 `timeout`） |

---

## 7. 测试考虑

| 用例族（`overall-test-cases.md` §2.5） | 覆盖的 FR | 本模块补充 |
|---|---|---|
| `TC-104-001` 权限预检 | `FR-104-007/008` | 增补 `unknown` 分支（接口缺失/名字不在白名单） |
| `TC-104-002` 去系统设置入口 | `FR-104-009` | 判据要求「设置页出现在截图里」而不是「调用没报错」 |
| `TC-104-003` 目录选择器（O8） | `FR-104-012..016` | **两个形态各一次**：系统 picker 与宿主侧 browse；两次都要能被助手用作 cwd |
| `TC-104-004` 外链（真正注册） | `FR-104-017..019` | 断言「调用前 `has(name) === true`」，并断言无 SIGSEGV |
| `TC-104-005` 通知（可选） | `FR-104-022` | 断言通知正文不含凭据模式（§4.7 规则 4） |
| `TC-104-006` 剪贴板粘贴 | `FR-104-011`（不新增权限） | 归 `103` 输入框；本模块只负责权限预检与 `denied` 文案 |
| `TC-104-007` 窗口尺寸记忆 | `FR-104-029` | 两次截图对比 + 偏好键内容读回 |
| `TC-104-008` 未注册能力报错 | `FR-104-004` | 追加「超限入参」与「非法 JSON」两例（对应 `payload-too-large` / `bad-args`） |
| `TC-106-003`（跨模块）工作区主目录清单 | `FR-104-026..028` | 由 `106` 的 `/roots` 自检读回，本模块负责供数正确 |

**新增候选用例（Phase 2 补进索引，编号不复用）**：`TC-104-009` 入参超上限 ⇒ 结构化错误且无崩溃；`TC-104-010` 非法 JSON ⇒ `bad-args`；`TC-104-011` 能力名拼错 ⇒ `unregistered`；`TC-104-012` `log.hilog` 双通道各写一次并在系统日志与日志文件中各找到一行（用**字段精确匹配**而不是「有没有那一行」）。

---

## 8. 文件清单

| 文件 | 作用 | 行数 |
|---|---|---|
| `entry/src/main/ets/host/HostCapabilities.ets` | 注册器 + 八个 handler 的边界与统一错误包装 | ⬜ 待创建 |
| `entry/src/main/ets/host/RuntimeFacts.ets` | `runtime.facts` | ⬜ 待创建 |
| `entry/src/main/ets/host/Permissions.ets` | `perm.check` / `perm.openAppInfo` + 三态映射 | ⬜ 待创建 |
| `entry/src/main/ets/host/Pickers.ets` | `fs.pickFiles` / `fs.pickFolder` + copy 策略 | ⬜ 待创建 |
| `entry/src/main/ets/host/ExternalLinks.ets` | `shell.openExternal` + 分流动作 | ⬜ 待创建 |
| `entry/src/main/ets/host/Notifications.ets` | `notify.show` | ⬜ 待创建 |
| `entry/src/main/ets/host/Hilog.ets` | `log.hilog` 双通道 | ⬜ 待创建 |
| `entry/src/main/ets/host/WorkspaceRoots.ets` | 主目录清单 + `PI_HOS_ROOTS` 形状 | ⬜ 待创建 |
| `entry/src/main/ets/host/WindowState.ets` | 窗口尺寸记忆（`preferences`） | ⬜ 待创建 |
| `entry/src/main/ets/common/Constants.ets` | 追加：偏好键名、长度上限、主目录 id、页面文案键（T6）；并行落地已含 `ENV_*` / `SANDBOX_DIR_NAME` / `CWD_DIR_NAME` / `READY_MARKER_NAME` 等 | 145（现状 ✅，本会话期间由并行工作增长：37 → 145） |
| `payload/env.js` | Node 侧环境装配的**唯一事实源**（已含 `PI_HOS_ROOTS` 兜底构造与 `PI_WEB_*` 路线分支） | 173（现状 ✅，并行落地） |
| `entry/src/main/ets/pages/Index.ets` | 注册入口调用点 + 未授权/失败文案位（与 `103` 协调） | 127（现状 ✅） |
| `entry/src/main/ets/app/PiDesktopRuntime.ets` | 提供 `runtime.facts` 所需的端口/状态读数（**不改业务语义**） | 154（现状 ✅） |
| `entry/src/main/ets/entryability/EntryAbility.ets` | 窗口尺寸应用点；`onPrepareToTerminate` 由 `101` 接 | 61（现状 ✅） |
| `entry/src/main/resources/{base,zh_CN,en_US}/element/string.json` | 新增文案键（三语一致，T2） | 48 / 36 / 36（现状 ✅） |
| `../../../ohos-node-bridge/library/src/main/ets/bridge/HostBridge.ets` | 消费面（库侧，不改） | 186（外部工程） |
| `../../../ohos-node-bridge/library/src/main/ets/runtime/Types.ets` | `HostBridgeHandler` 签名（同步 —— 阻塞项来源） | 159（外部工程） |
| `../../../../pi-desktop-hos/src-main/main.js` | 旧壳参考：`:339-357` 主目录、`:374-408` 权限、`:1090-1147` 外链、`:962-1004` 窗口状态 | 1314（外部工程） |

---

## 9. Phase 待实现清单（逐条 + 验收判据 + 依据）

| # | Phase | 工作项 | 验收判据 | 依据 |
|---|---|---|---|---|
| 1 | **2（阻塞项）** | 推动库放开 handler 异步签名（`string \| Promise<string>`）或提供异步回投通道 | 库 `register` 的签名变更通知 + 契约 §2.7 更新；本工程一次选择器调用能在 Node 侧 resolve 到**路径** | 冻结契约 §2.7 vs 库规划 §5.4（⚠️ 两份材料不一致）；库宪法 §六.1 |
| 2 | 2 | 注册器 + `runtime.facts` 落地（首屏之后注册） | `AC-104-01`：出参 JSON 含服务状态、日志路径、**八个能力名** | `FR-104-024/025`；规划 §5 第 15 条 |
| 3 | 2 | `perm.check`（三态）+ 未授权文案 | `AC-104-02` / `AC-104-03` | `FR-104-007/008`；🔶 旧壳 `main.js:374-408` |
| 4 | 2 | `perm.openAppInfo` 真机打开设置页 | `AC-104-04`（设置页出现在截图里） | `FR-104-009`；规划 §5 第 9 条 |
| 5 | 2 | `fs.pickFolder` / `fs.pickFiles`（**两形态各跑一次**，O8 定稿） | `AC-104-05/06/07`；被助手用作 cwd 后读写成功 | `FR-104-012..016`；规划 §12 O8、库契约 §5.4 |
| 6 | 2 | `shell.openExternal` + 围栏动作（**调用前 `has()` 自查**） | `AC-104-08/09`；无 SIGSEGV | `FR-104-017..021`；⚠️ 旧壳 `R15` / 能力清单 #28；规划 §5 第 11 条 |
| 7 | 2 | `log.hilog` 双通道 | `AC-104-12`；系统日志与日志文件各有一行（字段精确匹配） | `FR-104-023`；宪法 T8 |
| 8 | 2 | `notify.show`（按需） | `AC-104-12` 子集 + 正文不含凭据 | `FR-104-022`；`FR-ARK-045` |
| 9 | 2 | 主目录清单 + `PI_HOS_ROOTS` 供数 | `AC-104-10`；`TC-106-003` 的 `/roots` 输出四项齐全、状态与授权如实 | `FR-104-026..028`；🔶 旧壳 `main.js:339-357` |
| 10 | 2 | 窗口尺寸记忆（最小版） | `AC-104-11`（两次截图 + 偏好读回） | `FR-104-029`；规划 §5 第 7 条 |
| 11 | 2 | 新增文案三语补齐 | 三语 `string.json` 键集合一致（`TC-ARK-013`） | 宪法 T2 |
| 12 | 3 | 「未注册即不调用」与「无浏览器语义」复核记录 | `AC-104-08/09` + `TC-107-002` 同批出材料 | `FR-104-017`；红线 G2 |
| 13 | 1–2 | ✅ **已澄清（不再是待统一项）**：`workspace`（沙箱工作区根，清单 `id=sandbox`）与 `pi-cwd`（默认 cwd）是**两个语义**，并行落地已分别常量化为 `SANDBOX_DIR_NAME`/`CWD_DIR_NAME` 与 `DEFAULT_CWD_DIRNAME`/`SANDBOX_DIRNAME` | 两处文档不再互相矛盾（如需可把该口径写回 `overall-data-model.md` §4.2 备注） | `D-104-10`；`payload/env.js:41,45`；`Constants.ets:59,63` |
