# test-cases.md —— `108-jitless` 测试用例

> 对应 [`spec.md`](spec.md) 的 `AC-108-xx`。分三层：**PC 侧（`node --jitless`，秒级迭代）** → **组装门禁** → **真机**。
> 每条用例必须有可复现命令与可判读的期望输出；不允许"应该可以"。

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

### TC-108-17 模式判定（compat）
```bash
hdc shell aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility --ps piNodeMode compat
hdc shell "tail -50 <filesDir>/payload/app.log"
```
期望：ArkTS 日志 `mode=compat（依据：piNodeMode 参数）`；载荷日志 `WebAssembly=undefined`；`execArgv` 含 `--jitless`。

### TC-108-18 启动到就绪
期望：`pi-web.ready.json` 写出，marker 端口可探活，ArkWeb 加载 `pi-web` UI 且可交互；记录**冷启动耗时**。

### TC-108-19 真实对话（关键）
期望：一次对话 `stopReason=stop`，SSE 流式可见（无"卡住到超时"）。

### TC-108-20 图片附件
期望：发一张 1024 px JPEG 成功（模型可见）；若失败，用户可见明确提示且对话可继续。

### TC-108-21 code-mode 降级
期望：调用 code-mode 得到结构化错误（sandbox 错误），进程**不崩**，UI 可继续。

### TC-108-22 jit 形态回归
有 ACL Profile：
```bash
hdc shell aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility --ps piNodeMode auto
```
期望：`mode=jit（依据：ACL 已授予）`、`execArgv` **不含** `--jitless`；启动/对话/图片与改造前一致。

### TC-108-23 release 合规
release 包启动：
期望：`probeFlags` 与 `piNodeMode` 均被忽略（日志留痕），模式只由偏好设置/ACL 决定。

---

## 通过判据

- PC 侧（TC-108-01…14）全绿；
- 组装门禁（TC-108-15/16）全绿；
- 真机：TC-108-17…19 必须通过；TC-108-20/21 允许"如实降级"，但必须有可见提示；TC-108-22/23 不能回归。
