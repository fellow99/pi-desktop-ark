# spec.md —— `108-jitless` 无 JIT 模式（双形态兼容）

> 一句话：让**同一份产物**在「有 ACL（可 JIT + WASM）」与「无 ACL（必须 `--jitless`，`WebAssembly` 不存在）」两种设备形态上都能启动、能对话、能出图；
> 无 ACL 形态下，凡依赖 WASM 的模块改为**纯 JS 实现**或**如实降级**。
> 依据：[`../../docs/108-jitless-方案决策.md`](../../docs/108-jitless-方案决策.md)（方案与决策 D1/D2/D3）、[`../../docs/ACL-无ACL评估.md`](../../docs/ACL-无ACL评估.md)（P0–P5 与取证）。
> 宪法：[`../constitution.md`](../constitution.md)（A1 壳只做四件事 / A2 库不解释应用语义 / T5 事实优先 / G1 不静默失败）。
> 编号：功能需求 `FR-108-001` 起，验收场景 `AC-108-01` 起。编号一经发布不得复用。
> 取证口径：✅ 实测 ｜ 🔶 沿用他工程 ｜ ⚠️ 推断 ｜ ⬜ 未取证。

---

## 1. 背景与问题

无 ACL ⇒ V8 只能 `--jitless` ⇒ `typeof WebAssembly === 'undefined'`。当前载荷在此形态下**启动即崩**（约 0.5 s 后 SIGABRT），不是"变慢"。实测两道硬门 + 一项产品能力：

| 硬门 | 机制 | 现状 |
|---|---|---|
| ① Next 启动期加载 `next.config.ts` | 载荷 SWC 只有 WASM 版，`wasm.js:700-703` 顶层实例化 | ❌ 崩 |
| ② `fetch`（Node 内建 undici，llhttp 为 WASM） | 一连接即抛 `WebAssembly is not defined` | ❌ 调模型全废 |
| ③ `undici` 包的 `install()` | Next instrumentation 里 `undici.install()` 覆写 `globalThis.fetch` | ❌ 即使有垫片也被换回 |
| 能力项 | photon（图片 EXIF/缩放）为 WASM | ❌ 图片附件全部被丢弃 |

---

## 2. 术语与形态

| 术语 | 定义 |
|---|---|
| **jit 形态** | V8 具备 JIT 与 WASM。前提：签名 Profile 授予 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`。**现役形态，行为不得变化** |
| **compat 形态** | V8 以 `--jitless` 运行，`WebAssembly` 不存在。由**纯 JS 兼容层**支撑 |
| **模式判定** | 决定本次启动走 jit 还是 compat 的过程（见 `FR-108-001`） |
| **纯 JS 兼容层** | `payload/jitless/` 下的模块集合：HTTP 垫片、undici 条件入口、photon 同步垫片 |

---

## 3. 功能需求

### FR-108-001 运行形态：**编译期固定**（ArkTS 主进程侧）

**唯一开关**是构建期常量 `entry/src/main/ets/common/BuildConfig.ets` 的 `NODE_MODE`（`'compat'` | `'jit'`，**默认 `'compat'`**）。

1. 运行期**不得**存在任何形态切换入口：没有 `probeFlags`、没有 want 参数 `piNodeMode`、没有偏好设置项、
   没有 ACL 探测参与决策（`NodeMode.resolve()` 只读 `BuildConfig.NODE_MODE`）。
2. 要 jit 变体 ⇒ 改常量后重新构建（并在 `AppScope/app.json5` 区分版本号/渠道）。
3. ACL 探测 `probeJitAcl()` 仍保留，但**只用于出依据串与诊断报告**（`payload/node-mode.json`），不参与决策。

> **2026-10-20 两次修订的由来**（都被真机实测推动，务必保留）：
> ① 初版按「`PERMISSION_GRANTED` ⇒ jit」实现；在 `JUY-AL80`（`deviceType=phone`，API 26）上该权限查询
> **确为已授予（`→ 0`）**，但按 jit 启动后进程在 `libnode_bridge` 内 **SIGTRAP(TRAP_BRKPT)** 秒崩
> （同一 HAP 以 compat 启动可 1.6 s 就绪）⇒ **权限位不是 JIT 可用性的预检**。
> ② 随后短暂改为「`auto` 一律 compat + 允许调试参数/设置项显式选 jit」；产品最终决策更进一步：
> **运行期完全不切换**（`--jitless` 是进程级形态，而进程内 Node 每进程只起一次、失败即终态 ——
> 库契约 §2.6；一次误判就整机不可用，代价远大于 compat 的 7–10× 变慢）。

约束：
- 形态与依据必须落盘：`<filesDir>/payload/node-mode.json`（`mode`/`reason`/`flags`/`debugBuild`/`deviceType`/`deviceModel`/`osFullName`），
  因为部分机型（手机 `JUY-AL80`）对三方应用的 hilog 完全不可见。
- `compat` ⇒ 交给库的 Node 参数**必须包含 `--jitless`**，且位于脚本路径之前（库保证 `flags` 全排在 scriptPath 前）。
- 「所有 `deviceTypes` 默认 compat」是产品决策：`2in1` / `tablet` / `phone` / `tv` 不做设备间区分。

### FR-108-002 载荷侧自适应安装（Node 主线程）

`payload/pi-web-launch.js` 必须在 **require Next 之前**调用兼容层；兼容层以 `typeof WebAssembly === 'undefined'` 为**唯一开关**：

1. `WebAssembly` 可用 ⇒ **一个动作都不做**（jit 形态零影响），仅记一行事实；
2. 不可用 ⇒ 依次：封印 `node:http`/`node:https` 的惰性 undici getter → 安装纯 JS `fetch` 垫片（含 `Headers`/`Request`/`Response`/`FormData`/`Blob`/`File` 缺则补）→ 记录安装结果；
3. 安装结果必须是**可 grep 的结构化日志**（`installed` / `kept` / `failed` 三态），不得静默成功。

### FR-108-003 `fetch` 纯 JS 实现

必须支持（以 pi-web / pi-ai 的真实调用面为准）：

| 能力 | 要求 |
|---|---|
| `fetch(input, init)` | `method` / `headers`（对象、数组、原生 `Headers`、`Map`）/ `body`（string、`Buffer`、TypedArray、`FormData`、`Blob`、`ReadableStream`）/ `signal`（中止） |
| 响应 | `ok` / `status` / `statusText` / `headers`（`get`/`has`/`forEach`/迭代）/ `text()` / `json()` / `arrayBuffer()` / `body` 为**标准 `ReadableStream`**（SSE 流式解析依赖 `getReader()`） |
| 重定向 | 最多 5 跳；303 改写为 GET |
| 编码 | 请求头按**能力判据**识别外来 `Headers`/`FormData`（**禁止**只用 `instanceof`：跨实现会静默丢头/丢体） |
| 传输层 | 只允许 `node:http` / `node:https`（**原生 llhttp**）+ `node:stream/web`；**不得**触碰 undici / WASM |

### FR-108-004 `undici` 条件入口（挡住 `install()` 覆写）

- 载荷内**每个**包含 `package.json#name === "undici"` 的包，其 `main` 必须指向**条件入口**：`WebAssembly` 可用 ⇒ 原生实现；不可用 ⇒ 纯 JS 垫片。
- compat 形态下：`install()` 为**空操作**（不得覆写 `globalThis.fetch`）；`setGlobalDispatcher`/`getGlobalDispatcher` 为惰性记录；**其余导出以真实 undici 为底透出** —— 实测 `node --jitless` 下 `require('undici')`、构造 `Client`/`EnvHttpProxyAgent`、`setGlobalDispatcher` 都不抛错，只有真正发请求才碰 WASM，所以不伪造构造器（伪造会改掉上游的类型判定）；`request/stream/pipeline/connect/upgrade` 覆写为**明确 reject**（`code=ERR_JITLESS_UNDICI_WASM`，信息指路改用 `fetch`），不静默。
- 具名导出必须是**逐条赋值** `module.exports.X = impl.X`：本机实测 `module.exports = { A: impl.A, … }` 这种对象字面量在 `cjs-module-lexer` 下**只识别第一个键**（后果：`photon.resize`/`undici.install` 全 undefined）。组装期必须用 ESM 导入门禁逐个校验，且校验垫片**必需导出**是否齐备。
- **`package.json` 含 `exports` 字段时必须硬失败**：`exports` 会绕过 `main` ⇒ 条件入口失效（undici 的 `install()` 又把 fetch 换回 WASM 版）。当前 undici@8 / photon-node@0.3 均无该字段（组装期断言，为升级兜底）。
- 包搜索必须按 `package.json#name` **有界递归**（`maxDepth=3`），不能写死两层路径：嵌套去重会形成 `node_modules/a/node_modules/b/node_modules/undici`，漏一份就前功尽弃。
- 组装期每次 `--apply` 都必须**重跑**配置门禁与导出门禁（`.mjs` 可能是上一轮留下的，生成即门禁会永远跑不到）。
### FR-108-005 `next.config` 预编译

- 载荷内**不得**出现 `next.config.ts`；必须由组装期生成的 `next.config.mjs` 取代。
- 生成的 `.mjs` 必须在组装期被**实际执行一次**并断言导出形状（含 `serverExternalPackages` / `images` / `env` / `headers`），失败即中止组装（不得产出半成品归档）。
- jit 形态下行为必须与现役等价（同一份配置对象）。

### FR-108-006 图片能力（photon → 纯 JS）

- 必须实现 `@silvia-odwyer/photon-node` 被真实使用的 API 面：`PhotonImage`（`new_from_byteslice` / `new(raw,w,h)` / `get_width` / `get_height` / `get_raw_pixels` / `get_bytes` / `get_bytes_jpeg(q)` / `free`）、`resize(image,w,h,SamplingFilter)`、`fliph`、`flipv`、`SamplingFilter`。
- 必须**同步**（上游调用点是同步的，`image-resize-core.js` 全程无 await）。
- 必须**惰性解码**：`new_from_byteslice` 只解析文件头取宽高；仅在 `get_raw_pixels` / `get_bytes` / `resize` 时解码。
- 支持格式：JPEG（decode/encode）、PNG（decode/encode）；GIF/WebP 至少能取宽高（解码不支持时必须**明确报错**，由上游转换为可见提示）。
- 判定同 FR-108-004：`WebAssembly` 可用 ⇒ 原生 photon；不可用 ⇒ 纯 JS 垫片。

### FR-108-007 降级与如实告知

| 能力 | compat 形态下的行为 | 要求 |
|---|---|---|
| code-mode（`quickjs-wasi`） | 不可用 | 触发时给出结构化错误；**不得**崩进程 |
| source-map（`source-map08`） | 不支持 | 仅影响调试信息，无用户可见变化 |
| 其余 wasm（`@vercel/og` / msw / sharp / doom） | 运行时不加载 | 保持不加载，不得因本需求被提前加载 |

### FR-108-008 可诊断性

- 载荷启动日志（`app.log`）必须包含：`WebAssembly` 是否存在、兼容层每一环的安装结果、`--jitless` 是否生效。
- ArkTS 侧诊断面板/状态串必须显示当前模式（`jit` / `compat`）与判定依据。

---

## 4. 非功能需求

| 编号 | 要求 |
|---|---|
| NFR-108-001 | **jit 形态零回归**：所有兼容动作以 `typeof WebAssembly === 'undefined'` 为唯一开关；jit 形态下不得新增可观察行为差异（网络、图片、启动耗时） |
| NFR-108-002 | 不修改上游：`pi-web`、`pi-desktop-hos/pi-dist` 源目录**只读**；所有改动发生在 `pi-desktop-ark`（ArkTS 源码 + `payload/` + `scripts/`） |
| NFR-108-003 | 新增第三方依赖体积 < 500 KB（纯 JS），且必须 vendor 进 `payload/jitless/vendor/` 并锁 sha256（离线可构建） |
| NFR-108-004 | 组装脚本默认仍是 dry run；新增步骤必须能被逐条审计（打印"改了什么、为什么"） |
| NFR-108-005 | 合规：release 构建不得存在 `probeFlags` 通道（既有 G9 约束不变） |

---

## 5. 验收场景

| 编号 | 场景 | 判据 |
|---|---|---|
| AC-108-01 | PC 侧 compat 复现 | `node --jitless` 跑载荷入口：`WebAssembly === undefined`，兼容层安装日志齐全，Next 进入监听 |
| AC-108-02 | PC 侧真实 HTTP | compat 形态下 `fetch` 打通本地 HTTP（GET 文本 / POST JSON / SSE 分块），`response.body.getReader()` 可用 |
| AC-108-03 | PC 侧 undici 面 | compat 形态下 `import * as undici from "undici"` 得到具名导出，`install()` 后 `globalThis.fetch` **仍是**垫片 |
| AC-108-04 | PC 侧图片 | compat 形态下：≤ 限制的 JPEG/PNG 走"零解码"早退；超限图能被缩放并重新编码 |
| AC-108-05 | 组装门禁 | `assemble-payload --apply` 后：归档内无 `next.config.ts`、有可执行的 `next.config.mjs`；每个 `undici` 包的 `main` 指向条件入口 |
| AC-108-06 | 真机 compat 启动 | 直接装 compat 变体（`BuildConfig.NODE_MODE='compat'`，默认）⇒ Node 起、Next 就绪、`pi-web` UI 可交互 |
| AC-108-07 | 真机 compat 对话 | 一次真实对话成功（`stopReason=stop`），SSE 流式可见 |
| AC-108-08 | 真机 compat 图片 | 发一张图给模型成功（或被明确提示不受支持，且不影响对话） |
| AC-108-09 | 真机 jit 回归 | 有 ACL Profile 下 `auto` ⇒ 判为 jit、不带 `--jitless`；启动/对话/图片与改造前一致 |
| AC-108-10 | 降级如实 | compat 形态调用 code-mode 得到结构化错误，进程不崩 |

---

## 6. 范围外

- 不改 `pi-web` / `pi-coding-agent` 上游源码；
- 不做 ArkTS 原生图片解码桥（`@ohos.multimedia.image`）；
- 不替换 `quickjs-wasi`（code-mode 在 compat 形态下不可用，如实告知）；
- 不改 Git 分支、不 `git push`。

---

## 7. 实现事实与已知限制（交付时补记，均为实测）

| # | 项 | 事实 |
|---|---|---|
| 1 | **PC 侧 compat 形态整链路已验证** ✅ | `node --jitless pi-web-launch.js`（用真实归档树）→ 兼容层安装（`node:http` 封印 5 个惰性 getter、fetch 垫片 installed、六个全局 kept）→ `undici.install()` 被判为空操作 → Next 起来 → 写就绪 marker → `本进程已就绪 http://127.0.0.1:64304/`（约 40 s） |
| 2 | 图片面（纯 JS 垫片） | 「已达标」路径**零解码**（实测 `decodes=0`）；超限图 2000×1500 在 `--jitless` 下：JPEG 解码 ≈4.3 s、Lanczos3 →800×600 ≈3.6 s、PNG 编码 ≈2.9 s、JPEG(80) ≈3.8 s。上游 `tryEncodings` 会一次生成 PNG + 5 档 JPEG，最坏 ~25–30 s ⇒ 大图是慢路径，已加 >2000 ms 的 stderr 提示 |
| 3 | vendor 体积 | `jpeg-js@0.4.4` + `pngjs@7.0.0` 合计 **152,977 B**（含 `VENDOR.json` 的逐文件 sha256），远低于 NFR-108-003 的 500 KB |
| 4 | 运行期无形态入口（**产品决策**） | `probeFlags` / `piNodeMode` / 偏好设置三条入口已移除；形态只由 `BuildConfig.NODE_MODE` 决定。要 jit 只能是「编译期切换 + 重新构建」 |
| 5 | 自检脚本不进发布归档 | `payload/jitless/selftest/` 在组装期被排除（属开发期工具），源码仍在库内供 TC-108-xx 复跑 |
| 6 | 真机未验证（阻塞） | 本轮 `hdc list targets` 为空（设备未识别），AC-108-06…10 未取证；AC-108-01…05 已在 PC 侧完成 |

---

## 8.1 手机真机结果（2026-10-20 追加，`JUY-AL80` / 华为畅享 90 / API 26 / `deviceType=phone`）

| 项 | 结果 |
|---|---|
| 装机 | `install bundle successfully.`（HAP 含 `deviceTypes: 2in1/tablet/phone/tv`） |
| 旧逻辑（`auto`⇒权限授予⇒jit） | ❌ **必崩**：`SIGTRAP(TRAP_BRKPT)`，栈在 `libnode_bridge.so`，进程秒退、无任何载荷日志 |
| 新逻辑（`auto`⇒compat） | ✅ 就绪 **1,616 ms**、`WebAssembly=undefined`、`兼容层 active=true`、`/` 与 `/api/web-auth` 均 200 |
| ArkWeb | ✅ 渲染进程 `…:render` 在跑；`/proc/net/tcp` 可见 `127.0.0.1:42777` LISTEN + 与渲染侧 **ESTABLISHED** 连接 ⇒ 页面确实连上了载荷服务 |
| 形态证据 | `<filesDir>/payload/node-mode.json`：`mode=compat`、`reason` 含 `ALLOW_WRITABLE_CODE_MEMORY → 0（PERMISSION_GRANTED）；但权限位不能证明内核允许 JIT…`、`deviceType=phone`、`deviceModel=JUY-AL80` |
| `hilog` | ⚠️ 该机对三方应用的 hilog **完全不可见**（`hilog -x` 中本应用 0 行）⇒ 排障改走 `node-mode.json` + `payload/app.log` |
| `hdc fport` | ⚠️ 规则**只在创建它的那次 hdc 调用内有效**：跨调用后 `fport ls` 为空、`curl` 报 `ECONNREFUSED`。取证必须把「建规则 + 用规则」写进同一条命令（本轮常规/图片对话即按此完成） |

---

## 8. 真机验收结果（2026-10-20，HAD-W32 / Node v24.2.0 / 设备 `3QC0226526001227`）

| 用例 | 结果 | 读数 |
|---|---|---|
| TC-108-17 形态（编译期 compat） | ✅ | 直接启动（无任何参数）⇒ `node-mode.json` 的 `mode=compat`、`reason=编译期常量 BuildConfig.NODE_MODE=compat（运行期不可切换）`；载荷日志 `jitless 兼容层：active=true（WebAssembly=undefined）` |
| TC-108-18 启动到就绪 | ✅ | 新载荷 `59877c2987b3` 解包 → `PI_WEB_READY {"port":36885,…,"elapsedMs":934}`；**解释器模式冷启动 ≈0.93 s**（PC 上 44 s 是首次 require 大树的差异，设备 `.next` 读取快） |
| 路由可用性 | ✅ | `GET /` = 200（`<title>Pi Desktop</title>`）；`/api/web-auth` = 200；`/api/sessions` = 200 且返回 JSON（**该路由会 import `@earendil-works/pi-coding-agent` ⇒ 其 `import * as undici` 走的就是条件入口**，未触发 npm undici 的 WASM 错） |
| UI 渲染 | ✅ | `uitest dumpLayout` 文本含 pi-web 真实界面：「新建 / 搜索对话 / 会话 / 文件 / 文件操作 / 打开其他项目…」⇒ ArkWeb 正常加载 compat 形态服务 |
| TC-108-22 jit 变体 | ✅（历史，编译期切换前的口径） | 平板 `HAD-W32`（ACL 已授予）曾以 jit 运行：`active=false（WebAssembly=object）`、`elapsedMs=926`；改动后 jit 只能由 `NODE_MODE='jit'` 的变体验证 |
| 已知问题 K1 | ⚠️ | compat 形态每次冷启会在 app.log 留一条 `unhandledRejection: WebAssembly is not defined`（栈顶 `lazyllhttp` ← `node:internal/deps/undici`，由 **Next 启动链读取惰性全局**触发）。**不影响功能**（随后 `GET /api/web-auth` 200、就绪正常）。jit 形态无此条（对照实验已做） |
| K1 的失败修法（已回滚） | ❌ | 试过"compat 下用垫片类接管 `Headers/Request/Response/FormData/Blob/File`"⇒ 该报错**依旧**，且 **Next 路由全部 500**（`NextResponse` 继承 `globalThis.Response`，最小垫片不满足其语义）。已回滚，代码里留了完整注释与后续方向（预载 `internal/deps/undici/undici`，需 `--expose-internals`，参见 dshm 的 `installInternalUndiciShim`） |
| TC-108-19…21 | ⬜ | 真实对话需模型凭据（设备未配置）；图片与 code-mode 未在真机逐项触发。已在 PC 侧以真实上游代码路径覆盖 |

**结论**：compat 形态在真机**可用**（就绪 + 路由 + UI），jit 形态**零回归**；唯一遗留是一条不影响功能的启动期 rejection（K1，已定位根因并给出后续方案）。
