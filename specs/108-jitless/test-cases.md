# test-cases.md —— `108-jitless` 测试用例

> 对应 [`spec.md`](spec.md) 的 `AC-108-xx`。分三层：**PC 侧（`node --jitless`，仅用于秒级迭代）** → **组装门禁** → **真机**。
> 每条用例必须有可复现命令与可判读的期望输出；不允许"应该可以"。
>
> ⚠️ **证据口径（2026-10-20 起）**：`AC-108` 的通过证据**只认真机**（见 §四）；PC 侧同一脚本只用于开发期快速迭代，
> 不作为验收证据 —— 设备上才是真实 `--jitless` 形态、真实沙箱与真实网络。

---

## 一、PC 侧（本机 Node v24.7.0，`--jitless` ≈ 真机 compat 形态）

### TC-108-01 复现基线：WASM 缺失
```bash
node --jitless -e "console.log(typeof WebAssembly)"
```
期望：`undefined`。（对照组：不带 `--jitless` ⇒ `object`）

### TC-108-02 兼容层安装事实
```bash
node --jitless payload/jitless/selftest/run.mjs --only=install
```
期望：日志含 `WebAssembly=undefined`、`http-lazy: sealed(<n> getters)`、`fetch: installed`、`globals: Headers/Request/Response/FormData/Blob/File` 三态之一；**不得**出现 `failed`。

### TC-108-03 fetch：GET 文本
自建本地 HTTP 服务返回 `hello-GET`：
```bash
node --jitless payload/jitless/selftest/run.mjs --only=fetch-get
```
期望：`status=200`、`text()='hello-GET'`。

### TC-108-04 fetch：POST JSON + 自定义头
期望：服务端收到的 `authorization` 头与 `content-type` 与请求一致（防止"头全丢 ⇒ 401"回归）；回包 `json()` 解析正确。

### TC-108-05 fetch：SSE 流式（关键）
服务端分 5 块 `data: {...}\n\n` 慢速写出。
期望：`response.body.getReader()` 可用，逐块读到（**不是**全部缓冲后一次性返回），最后 `done=true`。

### TC-108-06 fetch：中止
`AbortController` 在 100 ms 后 abort。
期望：`fetch` 以 `AbortError`（`DOMException` 或 `name==='AbortError'`）拒绝；套接字被销毁（服务端 `close` 事件触发）。

### TC-108-07 fetch：FormData 与 Blob
期望：服务端解析出与发送一致的字段与文件字节（防止 `[object FormData]` 回归）。

### TC-108-08 fetch：重定向
301 → 302 → 200。
期望：最多 5 跳后得到最终响应；303 + POST 改写为 GET。

### TC-108-09 undici 条件入口（ESM + CJS）
```bash
node --jitless payload/jitless/selftest/run.mjs --only=undici
```
期望：
- `import('undici')` 具名导出包含 `install`/`setGlobalDispatcher`/`getGlobalDispatcher`/`Client`/`Pool`/`Agent`/`EnvHttpProxyAgent`；
- `install()` 调用后 `globalThis.fetch` **仍是**垫片（`=== shimFetch`）；
- `new undici.EnvHttpProxyAgent({})` 不抛错；`new undici.Client('http://127.0.0.1:1')` 不抛错；
- 对照组（不带 `--jitless`）：`import('undici')` 拿到的是原生实现且 `typeof WebAssembly==='object'`。

### TC-108-10 photon：惰性解码（常用路径零解码）
构造一张 800×600 JPEG（base64 < 4.5 MB）：
期望：`new_from_byteslice` 后 `get_width()=800`/`get_height()=600`，且自检日志显示 `decoded=0`（未解码）；`get_bytes()` 仍能返回合法 PNG。

### TC-108-11 photon：resize + 双编码
2000×1500 PNG → `resize(img, 1000, 750, Lanczos3)`：
期望：尺寸正确；`get_bytes()` 为 PNG；`get_bytes_jpeg(80)` 为 JPEG（魔数 `FFD8`）。

### TC-108-12 photon：EXIF 方向（fliph/flipv/rotate90 路径）
用 `applyExifOrientation` 同款调用序列（`fliph`/`flipv`/`new PhotonImage(raw,w,h)`）：
期望：像素搬移与 photon 语义一致（用 4×2 小图逐像素断言）。

### TC-108-13 图片端到端（pi 代码路径）
以 compat 形态 import `pi-coding-agent/dist/utils/image-process.js` 的 `processImage`：
- ≤ 限制的 JPEG ⇒ `ok:true`（不出现 "could not be resized" 提示）；
- 超大图 ⇒ 缩放后 `ok:true`；
- 不支持的格式（如 BMP）⇒ 明确 `ok:false`（不抛未捕获异常）。

### TC-108-14 jit 形态零回归（PC 对照）
不带 `--jitless` 跑同一份 selftest：
期望：兼容层**不安装**（日志 `WASM available, nothing to do`）；原生 `fetch` 仍是原生实现；`import('undici')` 是原生包；photon 为原生（`typeof WebAssembly==='object'`）。

---

## 二、组装门禁

### TC-108-15 归档形状
```bash
node scripts/assemble-payload.mjs --apply --force
```
期望：
- stage/归档内 **无** `next.config.ts`，**有** `next.config.mjs`；
- `node -e "import('<stage>/next.config.mjs')"` 成功且导出含 `serverExternalPackages`/`images`/`env`/`headers`；
- 每个 `undici` 包 `package.json#main === 'pi-jitless-entry.cjs'`，且该文件内出现全部真实导出名；
- `@silvia-odwyer/photon-node` 同样指向条件入口；
- `pi-web/jitless/` 存在且含 `index.js`/`fetch-shim.js`/`undici-shim.js`/`photon-shim.js`/`vendor/*`。

### TC-108-16 组装失败必须中止
把生成的 `.mjs` 人为改坏（仅测试环境）：
期望：组装以非零码退出，**不产出**新的 `pi-web.tar.gz`。

---

## 三、真机（`HAD-W32` / API 26，需 hdc 在线）

### TC-108-17 运行形态（编译期固定 compat）
```bash
# 不带任何参数启动；形态由 BuildConfig.NODE_MODE 决定（默认 compat）
hdc shell aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility
hdc shell "cat <filesDir>/payload/node-mode.json"
hdc shell "tail -50 <filesDir>/payload/app.log"
```
⚠️ 运行期**没有**切换入口：`--ps piNodeMode jit` 之类的参数**不再生效**（实测仍为 compat）。
期望：`node-mode.json` 的 `reason` 形如「编译期常量 `BuildConfig.NODE_MODE=compat`（运行期不可切换）」；载荷日志 `WebAssembly=undefined`；`flags` 含 `--jitless`。

### TC-108-18 启动到就绪
期望：`pi-web.ready.json` 写出，marker 端口可探活，ArkWeb 加载 `pi-web` UI 且可交互；记录**冷启动耗时**。

### TC-108-19 真实对话（关键）
期望：一次对话 `stopReason=stop`，SSE 流式可见（无"卡住到超时"）。

### TC-108-20 图片附件
期望：发一张 1024 px JPEG 成功（模型可见）；若失败，用户可见明确提示且对话可继续。

### TC-108-21 code-mode 降级
期望：调用 code-mode 得到结构化错误（sandbox 错误），进程**不崩**，UI 可继续。

### TC-108-22 jit 变体回归（编译期切换）
把 `common/BuildConfig.ets` 的 `NODE_MODE` 改成 `'jit'` 后重新构建、重装：
```bash
hdc shell aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility
hdc shell "cat <filesDir>/payload/node-mode.json"   # 期望 mode=jit、flags 不含 --jitless
```
期望：`mode=jit（依据：ACL 已授予）`、`execArgv` **不含** `--jitless`；启动/对话/图片与改造前一致。

### TC-108-23 release 合规（调试通道不存在）
release 包启动：
期望：`probeFlags` / `piNodeMode` **在代码中已不存在**（运行期无形态入口）；设备侧用例通道（`piTestScript` 等）在 release 下整条失效。

---

## 通过判据

- PC 侧（TC-108-01…14）全绿；
- 组装门禁（TC-108-15/16）全绿；
- 真机：TC-108-17…19 必须通过；TC-108-20/21 允许"如实降级"，但必须有可见提示；TC-108-22/23 不能回归。

---

## 四、本轮执行记录（2026-10-20 第 2 轮，**全部在真机上跑**）

> 证据来源：设备上的 Node 进程（PC 侧只用来调执行器本身，不作为任何用例的证据）。
> 通道与命令见 [`../overall-test-cases.md`](../overall-test-cases.md) §3「设备侧用例执行通道」；原始输出见
> [`../../logs/20261020-2/TEST_REPORT.md`](../../logs/20261020-2/TEST_REPORT.md)。

| 用例 | 层 | compat（`--jitless`） | jit 对照 | 设备侧原始事实 |
|---|---|---|---|---|
| TC-108-01/02 复现基线与安装事实 | 真机 | ✅ | ✅ | compat `WebAssembly=undefined` + `兼容层：active=true`；jit `WebAssembly=object` + `active=false`、兼容层不安装 |
| TC-108-03…13 fetch/undici 面 | 真机 | ✅ **14/14** | ✅ **14/14** | `合计 14 条用例：通过 14，失败 0`（compat 415 ms / jit 437 ms） |
| TC-108-10…13 图片面（photon） | 真机 | ✅ **22 通过 / 0 失败 / 2 跳过**（31,221 ms） | ✅ **22 / 0 / 2**（2,100 ms） | compat 慢 ~15×＝`--jitless` 的代价，与 PC 侧同量级 |
| TC-108-17/18 形态判定与就绪 | 真机 | ✅ 951 ms（产品包，无调试参数） | ✅ 871–926 ms | `pi-web.ready.json` 写出、`/` `/api/web-auth` `/api/sessions` 均 200 |
| TC-108-19 真实对话（含 SSE 流式） | 真机 | ✅ 通过 | ✅ 通过 | compat：SSE `text/event-stream`，首事件 668 ms、18 个事件，模型文本 3,916 ms 到达，`stopReason=stop`、回复「真机通」；jit：17 个事件、回复「jit可用」、1,380 ms |
| TC-108-20 图片附件 | 真机 | ✅ 通过（视觉模型） | ⬜ 未重跑 | 同一会话连发两张 `下载` 目录里的真实 PNG（3.4 MB / 4.3 MB，base64 4.6 MB / 5.8 MB）：第 1 张被描述为「混凝土预制构件 3D 渲染图，双矩形凹槽＋内埋金属吊装件，无文字，灰阶」；第 2 张被描述为「地铁站站厅层 3D 场景，约 6 台闸机、青绿立柱、橄榄绿导向带，可见文字『免费专用通道』/『Free / Unaccompanied Children Ticket Gate』/『← 出口 Exit』」，并明确回答「与上一张不是同一个物件」。两段描述互不相同且含**可核对的识读细节** ⇒ 图片确实进到了模型；`stopReason=stop`，流式 880 / 1,273 个 SSE 事件 |
| TC-108-21 code-mode 降级 | 真机 | ✅ 通过（**如实降级**） | ✅ 通过（可用） | compat：`GET /api/mcp` 的 `codemode.sandbox = {state:"unavailable", error:"…Failed to load QuickJS: Cannot read properties of undefined (reading 'compile')"}`，工具不注册、进程不崩（pid 不变、`Cpp Crash` 0）；jit：`{state:"available"}` |
| TC-108-22 jit 全链路 | 真机 | — | ✅ 零回归（14/14 + 22/22 + 真实模型调用 2/2） | 见右列形态对照 |
| TC-108-23 release 合规 | 真机 | ⬜ 未执行（本轮为 debug 构建） | — | 调试参数在 `applicationInfo.debug=false` 时整条失效（代码路径 + 单测口径） |

> 三条用例的驱动方式：与 UI 同一条链路（`POST /api/agent/new` → 订阅 `GET /api/agent/<id>/events` SSE → `POST /api/agent/<id>` 带 `images`），
> 因此"流式是否真的逐块到达""附件是否真的进模型请求""code-mode 怎么降级"都是可证伪的设备事实。
> 图片用例须选**视觉模型**：pi 的模型目录里 `deepseek-v4-pro` 是 `input:["text"]`（纯文本，用它会如实回"看不到图"），
> `deepseek-flash` / `deepseek-v4-flash` 才是 `input:["text","image"]`。命令与原始输出见
> [`../../logs/20261020-2/TEST_REPORT.md`](../../logs/20261020-2/TEST_REPORT.md) §7。

### 五、手机真机（2026-10-20，`JUY-AL80` / 华为畅享 90 / API 26）

| 用例 | 结果 | 事实 |
|---|---|---|
| TC-108-17 形态判定（compat） | ✅ | `auto`（不带任何调试参数）⇒ `node-mode.json` 记录 `mode=compat`，依据串如实写「权限已授予但不足以证明 JIT 可用」 |
| TC-108-18 启动到就绪 | ✅ | `PI_WEB_READY elapsedMs=1616`；`/` 与 `/api/web-auth` 均 200；ArkWeb 渲染进程在跑，`/proc/net/tcp` 有与载荷端口的 ESTABLISHED 连接 |
| TC-108-22 jit 形态 | ❌ 该机不可用 | 该机权限位已授予但 jit 启动必 `SIGTRAP` 崩（本轮据此把 `auto` 收紧为 compat；要 jit 只能显式选择，且需在已证实设备上用） |
| 形态判定的持久证据 | ✅ 新增通道 | `<filesDir>/payload/node-mode.json`（mode/reason/flags/deviceType/deviceModel/osFullName）——本机 hilog 对三方应用不可见，只能靠它归因 |

**口径更正**：本轮不再以「PC 侧 `node --jitless` 全绿」作为 `AC-108` 的证据 —— 同一份断言改为在设备上跑，
两种形态各自启动应用各跑一遍（`--jitless` 与 jit 是**进程级**形态）。
