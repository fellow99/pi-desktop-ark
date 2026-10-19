# 108-jitless 方案决策（头脑风暴 + 可行性评估）

| 项 | 内容 |
|---|---|
| 日期 | 2026-10-19 |
| 需求 | **108-jitless 无 JIT 模式**：同一份产物同时兼容「有 ACL（可 JIT + WASM）」与「无 ACL（必须 `--jitless`，无 WASM）」两种运行形态 |
| 涉及工程 | 父工程（`pi-workspace`，仅子模块指针）+ `pi-desktop-ark`（全部实现） |
| 规范产出 | [`../specs/108-jitless/`](../specs/108-jitless/)（spec / plan / tasks / test-cases） |
| 输入依据 | [`ACL-无ACL评估.md`](ACL-无ACL评估.md)（P0–P5 路线）、[`000-工程规划.md`](000-工程规划.md) §10、[`002-DSHM对照分析与可借鉴点.md`](002-DSHM对照分析与可借鉴点.md) §9 |
| 取证口径 | ✅ 本机/真机实测 ｜ 🔶 沿用他工程一手记录 ｜ ⚠️ 推断（链路完整未直测） ｜ ⬜ 未取证 |

---

## 1. 一句话结论

**能做到，且不牺牲「有 ACL」模式。** 关键不是"把 WASM 全换掉"，而是**只在 `WebAssembly` 不存在时**装一层兼容层：
① `next.config.ts` 预编译成 `next.config.mjs`（去 SWC-WASM）；② 纯 JS `fetch` 垫片 + 改写 `undici` 包的 `main` 为条件入口（挡住 `undici.install()` 覆写全局 fetch）；③ `photon`（图片）用纯 JS 同步垫片顶替。
`quickjs-wasi`（code-mode）与 source-map 接受降级，且二者的失败路径都**已被上游捕获**，不会崩进程。

---

## 2. 需要做兼容的模块（逐项取证）

| # | 模块 | 失效机制 | 用户可见后果 | 判定 |
|---|---|---|---|---|
| 1 | Next 启动期加载 `next.config.ts` | 载荷里 SWC **只有 WASM 版**：`next/wasm/@next/swc-wasm-nodejs/wasm_bg.wasm` = 30,393,446 B，`wasm.js:700-703` 在**模块顶层** `new WebAssembly.Module` | **致命**：Next 起不来（约 0.5 s 后 SIGABRT） | 必须改 |
| 2 | Node 内建 undici（llhttp 为 WASM 版） | `fetch` 一连接即抛 `WebAssembly is not defined` | **致命**：调模型全废 | 必须改 |
| 3 | `undici` npm 包（**两份**：`pi-dist/node_modules/undici`(8.11.0) 与 `…/pi-coding-agent/node_modules/undici`） | ①`pi-coding-agent/dist/core/http-dispatcher.js:2,85,94` 与 `pi-web/lib/http-dispatcher.ts:141-147` 在 Next instrumentation 里 `setGlobalDispatcher` + `undici.install()`；`install()` 会**覆写 `globalThis.fetch`** | **致命**：即使装了 fetch 垫片，也会被它换回 WASM 版 | 必须改 |
| 4 | Node 内建 TS 类型擦除（`amaro`） | `node:internal/deps/amaro/dist/index:549` 是 WASM | 排除一条"省事"方案（见 §4.2） | 决策依据 |
| 5 | `@silvia-odwyer/photon-node`（图片 EXIF 方向/缩放） | `photon_rs.js` 读 `photon_rs_bg.wasm` | 所有图片附件被丢弃，模型只收到「`[Image omitted: could not be resized…]`」文本 | 降级可行，**本需求改为纯 JS 顶替** |
| 6 | `quickjs-wasi`（code-mode 沙箱） | `new WebAssembly.Module` | code-mode 不可用；错误在 `execute.js:433-443` 转为 sandbox 错误，**不崩进程** | 接受降级 |
| 7 | `next/dist/compiled/source-map08/mappings.wasm` | — | 仅 dev 中间件使用 | 无需处理 |
| 8 | `@mswjs/interceptors` 的 `llhttp.wasm`、`@vercel/og` 的 `resvg/yoga.wasm`、`@img/sharp-wasm32`、`examples/doom/build/doom.wasm` | — | 运行时不加载：`next.config.ts` 已 `images.unoptimized:true`（关掉 image-optimizer ⇒ 不碰 sharp），pi-web 无 `next/og` 路由，msw 只在测试，doom 只在 opt-in 示例 | 无需处理 |

> 载荷 `*.wasm` 实测 9 个（≈44.6 MB）。**ArkWeb 页面里的 JS 不受影响**（渲染进程 uid 不在应用权限域，见 `ACL-无ACL评估.md` §5 末），所以本需求只动**进程内 Node**。

---

## 3. 反证记录（避免把错误方案写进 spec）

| # | 候选 | 反证 | 结论 |
|---|---|---|---|
| R1 | 设 `__NEXT_NODE_NATIVE_TS_LOADER_ENABLED=true` 让 Next 用 Node 原生 TS 擦除加载 `next.config.ts` | 本机 `node --jitless -e "import('./next.config.ts')"` 实测：`ReferenceError: WebAssembly is not defined at node:internal/deps/amaro/dist/index:549:22`（Node 24 的类型擦除器 amaro 本身是 WASM） | ❌ 否证 |
| R2 | 只挂 `Module._load` 钩子把 `undici` 指到垫片 | 本机实测：CJS `require('undici')` 被钩到，ESM `import * as u from 'undici'` **仍拿到原生包**（`pi-coding-agent` 是 `"type":"module"`，其 `dist/core/http-dispatcher.js` 用真 ESM import） | ❌ 覆盖面不足 |
| R3 | 用 `--no-experimental-fetch` 让 Node 不装 `globalThis.fetch` | Node 24 已移除该 flag（`ACL-无ACL评估.md` §8「不要做的事」🔶 dshm E35） | ❌ 不可用 |
| R4 | 把 `jimp` 直接当 photon 的替换 | `photon` 被上游以**同步**调用（`const resized = photon.resize(...)`、`resizeImageInProcess` 全同步）；jimp 1.6.1 全是 Promise API，同步点无法 await | ❌ 不可直接替换（改用同族纯 JS 同步编解码器，见 §4.4） |

---

## 4. 方案对比与决策

### 4.1 硬门一：`next.config.ts`

| 方案 | 做法 | 评估 |
|---|---|---|
| **A（选中）** | 组装载荷时把 `next.config.ts` 预编译为 `next.config.mjs`，并删掉 `.ts` | Next 的 `CONFIG_FILES = [next.config.js, .mjs, .ts, .mts]`（`next/dist/shared/lib/constants.js:364`，`findUp` 按此序取）⇒ `.mjs` 稳定优先；`.mjs` 是原生 ESM，`await import()` 不需要任何转译。改动只在 `scripts/assemble-payload.mjs`，**不碰上游** |
| B | 改 pi-web 源码只发 `next.config.js` | 跨工程改动，且 pi-web 是上游克隆，升级即丢 |
| C | 运行时 hook Next 的配置加载 | 侵入 Next 内部（`transpileConfig`），比预编译脆弱得多 |

> 组装期必须有**可执行的门禁**：生成 `.mjs` 后当场 `import()` 执行一次，断言 `default` 是对象且含 `serverExternalPackages / images / env / headers` 等键。

### 4.2 硬门二：`fetch`（undici）

| 方案 | 做法 | 评估 |
|---|---|---|
| `node-fetch@3.3.2` | 纯 JS（依赖 `data-uri-to-buffer`/`fetch-blob`/`formdata-polyfill`，107 KB） | `response.body` 是 Node stream，不是 Web `ReadableStream`；上游 SSE 解析用 `body.getReader()` ⇒ 仍需适配层 |
| **dshm `fetch-shim.js`（选中）** | 960 行，基于**原生 llhttp** 的 `node:http/https` + `node:stream/web` 的 `ReadableStream`；含 `Headers/Request/Response/FormData/Blob/File` 最小实现、SSE 流式、重定向、"不能只用 `instanceof`"的跨实现判据 | 🔶 已在 dshm 真机跑通（调模型/SSE/附件上传），且其文件头逐条写了踩过的坑（原生 `Headers` 不可枚举导致 401、`FormData` 编成 `[object FormData]`）。**复用成本最低、风险最低** |
| 自研精简垫片 | 只做 GET/POST JSON | SSE + FormData + 中止语义三个边界必踩，收益不抵风险 |

### 4.3 硬门三：`undici` 包（挡住 `install()` 覆写 fetch）

| 方案 | 做法 | 评估 |
|---|---|---|
| `module.register()` ESM loader hook + `Module._load` | dshm 现做法 | loader 跑在独立线程（端侧未验证，dshm 自己标了 ⬜），且**仍需两套机制**（ESM/CJS 各一） |
| **改写 `package.json#main` 为条件入口（选中）** | 在载荷里给每个 `undici` 包加 `pi-jitless-entry.cjs`：`typeof WebAssembly === 'undefined'` ⇒ 纯 JS 垫片，否则 ⇒ 原 `index.js`；`main` 指向它 | CJS 与 ESM **同时**覆盖（`undici` 无 `exports` 字段，ESM 走 `legacyMainResolve` 读 `main`）；零 hook、零子线程。具名导出的可行性已本机实测：`module.exports = { X: impl.X }` 能被 `cjs-module-lexer` 识别（`import * as u` 拿到具名键），而 `module.exports = require('./x')` 与 `{ ...impl }` **不能** |
| 直接替换 undici 目录 | 只留纯 JS 实现 | 会同时废掉「有 ACL」模式的原生 undici |
| 改上游 pi-web / pi-coding-agent | 删掉 `undici.install()` | 跨工程 + 升级即失效 |

**具名导出清单在组装期生成**（`Object.keys(require('<stage>/node_modules/undici'))` 读取真实导出名），不手写，避免版本漂移。

### 4.4 图片（photon）

| 方案 | 做法 | 评估 |
|---|---|---|
| 关 `settings.images.autoResize` | 完全绕开 photon | 代价明确：不校正 EXIF 方向、超限图由 provider 拒 |
| `jimp` 纯 JS | — | 见 R4：**API 异步，同步调用点无法替换** |
| **纯 JS 同步 photon 垫片（用户选中方向）** | 用 `jpeg-js`（同步 decode/encode）+ `pngjs`（同步 read/write）+ 自实现 Lanczos3/Bilinear 重采样，实现 `@silvia-odwyer/photon-node` 被真正用到的 API 面 | 特性：**惰性解码** —— `new_from_byteslice()` 只解析文件头拿宽高（JPEG SOF / PNG IHDR / GIF 逻辑屏 / WebP VP8X·VP8·VP8L），`get_raw_pixels()/get_bytes()/resize()` 才真正解码 ⇒ 前端已把图压到 ≤1024 px、base64 < 4.5 MB 时**一次解码都不发生**（pi 的 `image-resize-core.js:63-71` 命中"已达标"早退分支） |
| ArkTS `@ohos.multimedia.image` + 宿主桥 | 原生能力 | 改动面最大（新能力 + 载荷接线），本需求不做 |

需要的 photon API 面（取证：`utils/photon.js` / `image-convert.js` / `image-resize-core.js` / `exif-orientation.js`）：

```text
PhotonImage.new_from_byteslice(bytes) / new PhotonImage(rawRGBA, w, h)
  .get_width() .get_height() .get_raw_pixels() .get_bytes() .get_bytes_jpeg(q) .free()
resize(image, w, h, SamplingFilter.Lanczos3)
fliph(image) / flipv(image)        // 原地修改
SamplingFilter.{Nearest,Triangle,CatmullRom,Gaussian,Lanczos3}
```

### 4.5 code-mode 与 source-map

- `quickjs-wasi`：不处理。失败路径已在上游被捕获（`execute.js` → `{kind:"sandbox"}` 错误），UI 如实报错；pi-web 默认 `codemode=automatic`（注册不激活）。
- `source-map08`：不处理（仅 dev）。

---

## 5. 双模式兼容的设计

### 5.1 模式判定（ArkTS 侧）

```
模式 = 首个命中的来源
  ① debug 构建的 want 参数 piNodeMode（jit | compat | auto）  ← 诊断/验收用
  ② 持久设置 preferences('pi-settings').nodeMode（默认 auto）  ← 应用内切换入口
  ③ auto ⇒ checkAccessTokenSync(tokenId, 'ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY')
         GRANTED ⇒ jit；否则 ⇒ compat（并打一条显式日志）
既有 probeFlags（debug）仍然可用，优先级最高（它直接给 flags 串，绕过模式判定）
```

- 默认 `auto`：**不允许**在缺 ACL 的设备上按现役（JIT）形态启动 —— 那是必崩。手动值 `jit`/`compat` 供人工与验收切换。
- 传入库的方式：`compat` ⇒ flags 串追加 `--jitless`（实测库把 `flags` 全部排在脚本路径**之前**，`node_bridge.c:1040-1056`），或等价的库选项 `options.jitless=true`（`NodeRuntime.ets:233-235`，同一位置）。本次用 flags 串，改动面最小且可被 `probeFlags` 直接复现。

### 5.2 Node 侧自适应（载荷）

`payload/pi-web-launch.js` 在 **require Next 之前**调用 `require('./jitless').installIfNeeded()`：

```
installIfNeeded():
  if (typeof WebAssembly !== 'undefined') → 记一行「WASM 可用，兼容层不装」并返回 false   // 有 ACL 模式零影响
  ① 封印 node:http / node:https 的惰性 undici getter（否则访问即触发 WASM 初始化）
  ② 装 fetch 垫片（globalThis.fetch / Headers / Request / Response / FormData / Blob / File 缺则补）
  ③ 把两侧的事实打进 app.log：`WebAssembly=undefined`、各垫片 installed/kept/failed
```

> 封印惰性 getter **只在 WASM 不可用时做**：WASM 可用时封掉会反噬原生 undici（`maxHeaderSize` 被换成 `{}` ⇒ `fetch failed / cause: http module not available or http.maxHeaderSize invalid`，🔶 dshm E39 实测）。

---

## 6. 可行性评估（含代价与未取证项）

| 项 | 评估 |
|---|---|
| 架构可行性 | ✅ 三条硬门都有"不碰上游 + 不改有 ACL 模式"的落点：预编译（组装期）、`main` 条件入口（组装期）、WASM 无关的同步纯 JS 图片垫片（组装期 + 运行期自适应） |
| 性能 | ⚠️ 解释器模式下热循环约 **40×** 慢（`ACL-无ACL评估.md` §3 探针）。冷启动与首屏会显著变慢，`READY_TIMEOUT_MS = 90 s` 可能不够 ⇒ 必须真机实测后再决定是否上调超时 |
| 依赖体积 | `jpeg-js` + `pngjs` 合计 < 300 KB（远小于 jimp 的 3.3 MB 依赖树），vendor 进 `payload/jitless/vendor/` 并锁 sha256 |
| 未取证 ① | 真机 jitless 下 Next 冷启动耗时（`ACL-无ACL评估.md` §9 第 2 项仍为 ⬜） |
| 未取证 ② | 端侧 `worker_threads` 可用性（`image-resize.js` 会 `new Worker`，失败已回退进程内） |
| 未取证 ③ | 解释器下 jpeg-js 解码 1024 px 图的耗时（惰性解码已把常用路径绕开，只有超限图才付这笔钱） |
| 回归风险 | 有 ACL 模式必须零变化：所有兼容动作都以 `typeof WebAssembly === 'undefined'` 为唯一开关，且组装期改动只**新增**文件、只在 WASM 分支生效 |

---

## 7. 决策记录（本轮已确认）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | `undici` 兼容方式 | 改写 `package.json#main` 为**条件入口**（用户确认） |
| D2 | 图片能力 | 先判 `WebAssembly`；不可用 ⇒ 引入纯 JS 实现（用户确认）。**偏差说明**：`jimp` 为 Promise API、上游调用点为同步 ⇒ 改用同族纯 JS **同步**编解码器（`jpeg-js`/`pngjs`）+ 自实现 Lanczos3，行为与 photon 对齐（见 R4） |
| D3 | 模式判定 | **设置项 / 调试参数手动切换**（用户确认），`auto`（ACL 探测）作为默认兜底，防止缺 ACL 设备按 JIT 启动必崩 |

---

## 8. 下一步

进入 [`../specs/108-jitless/`](../specs/108-jitless/)：`spec.md`（需求与验收）→ `plan.md`（实现方案）→ `tasks.md`（任务分解）→ `test-cases.md`（用例）。
