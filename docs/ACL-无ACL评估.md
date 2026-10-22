# 无 ACL 评估（零受限权限方案）

| 项 | 内容 |
|---|---|
| 日期 | 2026-10-19 |
| 状态 | **评估记录**：本版**不采用**零 ACL；本文留档其可行性、代价与落地路线 |
| 适用工程 | `pi-desktop-ark`（Pi Desktop · HarmonyOS Edition：ArkTS 宿主 + ArkWeb 前端 + 进程内 Node 24.2.0 + 进程内 Next） |
| 关联 | [`docs/ACL配置.md`](ACL配置.md)、[`docs/000-工程规划.md`](000-工程规划.md) §10、[`docs/001-能力复刻评估.md`](001-能力复刻评估.md) REV-5/REV-6 |
| 判定口径 | ✅ 真机或本机实测 ｜ 🔶 沿用他工程实测 ｜ ⬜ 未取证 ｜ ⚠️ 推断（有证据链但未直接验证） |

---

## 1. 一句话结论

**能做到，但代价不是"变慢"，而是"要先把整条 WASM 依赖链拆掉"。**

当前载荷下，撤掉 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 后应用**在启动阶段即崩溃**（不是降级运行），
原因是零 ACL ⇒ V8 只能 `--jitless` ⇒ `WebAssembly` 整个对象不存在 ⇒
① Next 启动期无法转译 `next.config.ts`（本机 SWC 只有 WASM 版）；② Node 自带 undici 的 WASM 版 llhttp 起不来
⇒ `fetch` 全废（调模型的主通道）。

要真正落地零 ACL，最少要做两件**架构级**改动（第 6 节），并有四件可选取舍。

---

## 2. 现役权限面（本次定稿）

- `requestPermissions`：**21 项**（其中 6 项带 `reason` + `usedScene`）
- `definePermissions`：`LOCK_WINDOW_CURSOR`、`kernel.ALLOW_WRITABLE_CODE_MEMORY`
- Ability 后台模式：`taskKeeping`
- **现役 ACL 只有 1 项**：`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`

**已撤销的 5 项**（本轮定稿，均不再出现在 `module.json5`）：

| 权限 | 等级 | 撤销依据 |
|---|---|---|
| `READ_PASTEBOARD` | `system_basic`（需 ACL） | 页面粘贴由 ArkWeb 自行读剪贴板；应用侧 0 处 `@ohos.pasteboard` 调用。真机：该权限 `grantStatus=-1`（从未授予）时 Ctrl+V 仍可粘贴（REV-5） |
| `READ_WRITE_DESKTOP_DIRECTORY` | `system_basic`（需 ACL） | 桌面目录只是选择器的一个根；不申请只少一个 Tab |
| `READ_WRITE_DOCUMENTS_DIRECTORY` | `normal`（无需 ACL） | **2026-10-19 起重声明并保留**：点「文档」Tab 时弹授权窗后列举（REV-7） |
| `READ_WRITE_DOWNLOAD_DIRECTORY` | `normal`（无需 ACL） | **同上**：点「下载」Tab 时弹授权窗后列举（REV-7） |
| `FILE_ACCESS_PERSIST` | `normal`（`system_grant`） | 随之不再调用 `fileShare.persistPermission`；选择器 URI 仅本会话有效 |

> 例外的“反向副作用”：撤销后**装机不再受 Profile 里那几条 ACL 的约束**（历史 `code:9568289` 的触发点只剩 JIT 一项）。

---

## 3. 零 ACL 在机制层意味着什么

| 能力 | 有 ACL（JIT 可用） | 零 ACL（必须 `--jitless`） |
|---|---|---|
| V8 Sparkplug / Maglev / TurboFan | 可用 | **全部关闭**，纯解释器执行 |
| `WebAssembly` | 可用 | **`typeof WebAssembly === 'undefined'`**（不是变慢，是不存在） |
| RegExp（irregexp） | 编译成机器码 | 退化为解释器 |
| 启动参数 | `--no-verify-heap` 即可 | **必须** 带 `--jitless`；否则 V8 一申请可执行页就 SIGTRAP（探针实测 `CRASH sig=5`） |
| 计算性能 | 探针：热循环 **6–9 ms / 2e6** | 探针：**294–305 ms / 2e6**（≈40×） |
| N-API 原生库 / `fs` / `net` / `zlib` / `crypto` | 不受影响 | 不受影响 |
| ArkTS / ArkUI 产物 | 不受影响 | 不受影响 |
| **ArkWeb 页面里的 JS** | 不受影响 | **同样不受影响**（见 §5 末） |

---

## 4. 零 ACL 的两道硬门（实测）

### 4.1 硬门一：Next 启动期需要 SWC（本机只有 WASM 版）

**设备实测（2026-10-19）**：用 debug 构建自带的调试通道起 jitless

```
hdc shell aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility --ps probeFlags "--jitless"
```

读数：

| 阶段 | 结果 |
|---|---|
| Node 引导 / 载荷解包 / 载荷路由 | ✅ 正常（`[bootstrap] payload ready (skip)`） |
| 宿主桥接线 | ✅ 正常（`已向宿主桥注册 shutdown 钩子`） |
| Next 就绪 | ❌ 无（日志停在上一条之后，约 **0.5 s** 后进程消失） |
| 崩溃形态 | `Reason:Signal:SIGABRT(SI_TKILL)`；`LastFatalMessage:[appspawn_server.c:69]Unexpected call: exit(1)` |
| 崩溃栈 | `fs::AfterStat → fs::FSReqCallback::Reject → RunMicrotasks → Environment::Exit → node::Exit → exit(1)` |
| 对照 | 同一构建用默认 flags 重启 ⇒ pid 存活、pi-web UI 正常（`textField` 在位） |

⇒ **零 ACL 不是性能问题，是可用性问题**：崩溃点是"某次异步失败把进程 `process.exit(1)` 掉了"
（appspawn 把 `exit()` 转成 abort），发生在 Next 就绪之前。

**为什么大概率是 SWC/WASM** ⚠️（推断，链路完整但缺一行 JS 报错）：

1. 设备载荷里 Next 的 SWC **只有 WASM 版**：`node_modules/next/wasm/@next/swc-wasm-nodejs/wasm_bg.wasm`
   = **30,393,446 B**；`node_modules/@next/` 下只有 `env`（无原生 `.node`）
2. 载荷根的配置是 **`next.config.ts`**（设备上实测该文件存在），Next 启动期必须转译它
3. `--jitless` ⇒ `WebAssembly` 不存在 ⇒ 该转译必然失败
4. 缺口：崩溃点的确切 JS 报错没落盘（stderr 未被桥接进 `node.log`；`/data/log/faultlog/faultlogger` 无读权限）

**坐实方式（最省事）**：把交付的 `next.config.ts` 换成预编译 `next.config.js`，再用 `--jitless` 起一次 ——
若不再崩溃，即证明这道门就是 SWC。

### 4.2 硬门二：Node 自带 undici 的 WASM llhttp ⇒ `fetch` 全废

**本机复现（Node v24.7.0，2026-10-19）**：

```
$ node --jitless -e "console.log(typeof WebAssembly)"
undefined

$ node --jitless -e "fetch('http://127.0.0.1:38999/x').then(...).catch(e=>console.log(e.message, e.cause))"
fetch failed | cause: WebAssembly is not defined

$ node -e "fetch('http://127.0.0.1:38999/x')…"     # 带 JIT
hello-GET                                          # ✅
```

⇒ **jitless 下 `fetch` 直接不可用**。而 pi-web / agent 调模型就是 `fetch`
（`@earendil-works/pi-coding-agent`、`pi-web` 的 `/api/*` 全走它）⇒ 即便 §4.1 修好，第一次真实对话仍会失败。

**他工程同源台账（dshm，Node 22/24 上均复现）**：

| 结论 | 出处 |
|---|---|
| `unhandledRejection: ReferenceError: WebAssembly is not defined at lazyllhttp (node:internal/deps/undici/undici:5988:9)` | `dshm/docs/50-端侧核心运行架构.md` E33/E34/E35 |
| 触发点是 `node:http` 的惰性 getter ⇒ `lazyUndici` | 同上 E38 |
| 封掉 `node:http` 上全部惰性 getter（`maxHeaderSize`/`globalAgent`/`WebSocket`/`CloseEvent`/`MessageEvent`）后该报错在本机与真机**双双消失** | 同上 E39 |
| `--no-experimental-fetch` 无效（Node 24 已移除该 flag） | 同上 E35 + `hostcore/app/fetch-shim.js` 头注释 |

---

## 5. 载荷里的 8 个 `.wasm` 与影响面

实测（设备载荷 `.../payload/ea56ae254437/pi-web`）：`find -name '*.wasm'` ⇒ **8 个**。

| # | 文件 | 谁在用 | 零 ACL 后果 | 判定 |
|---|---|---|---|---|
| 1 | `next/wasm/@next/swc-wasm-nodejs/wasm_bg.wasm`（30.4 MB） | Next 启动期转译 `next.config.ts` | **致命**：Next 起来不了（§4.1） | 必须处理 |
| 2 | undici 的 llhttp（Node 内置，不在这 8 个里） | `fetch` / 模型调用 / 网页抓取 | **致命**：`fetch` 抛 `WebAssembly is not defined`（§4.2） | 必须处理 |
| 3 | `@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm` | 附件图片 EXIF 方向校正 / 缩放 | 图片附件路径失败（发图给模型） | 需处理或砍功能 |
| 4 | `quickjs-wasi/quickjs.wasm` | pi 的 code-mode worker | 该可选功能不可用 | 可砍 |
| 5 | `next/dist/compiled/source-map08/mappings.wasm` | 错误栈 source map 解码 | 调试信息降级（不影响主流程） | 可接受 |
| 6 | `next/dist/compiled/@vercel/og/{resvg,yoga}.wasm` | OG 图片生成 | pi-web 无 OG 路由 ⇒ 不会加载 | 无需处理 |
| 7 | `next/dist/compiled/@mswjs/interceptors/.../llhttp.wasm` | msw（测试用） | 运行时不加载 | 无需处理 |
| 8 | `pi-coding-agent/examples/.../doom.wasm` | 官方示例扩展 | 不加载 | 无需处理 |

**不受影响（重要）**：ArkWeb 页面里的 JS **不需要**这条 ACL。实测证据：
`org.fellow99.pi.PiDesktopArk:gpu` 的 **uid = 20100261、PPID = 5869**（系统侧服务），
而应用主进程 **uid = 20020220** —— 渲染进程不在应用的权限域内（系统浏览器同款形态：
`com.huawei.hmos.browser:render` uid 20100238/9）。⇒ 零 ACL 影响的是**进程内 Node**，不是前端 UI。

---

## 6. JS 替代方案（逐项）

| # | 现状 | 替代方案 | 改动面 | 代价 / 风险 |
|---|---|---|---|---|
| 1 | `next.config.ts` 启动期由 SWC 转译 | **交付时预编译成 `next.config.js`**（`scripts/assemble-payload.mjs` 增加一步 `tsc`/babel 产物），启动期不再需要 SWC | 打包脚本，1 处 | 低；需保证 `next.config.js` 与 `.ts` 语义一致（当前 config 只是读 `package.json` 的版本号，纯数据） |
| 2 | `fetch`（undici + WASM llhttp） | **纯 JS fetch 垫片**：基于**原生 llhttp** 的 `node:http`/`node:https` + `node:stream/web` 的 `ReadableStream`；同时封掉 `node:http` 惰性 getter 阻断 undici 初始化 | 新增 `payload/fetch-shim.js` + 启动时先装垫片 | 中；dshm 已有 960 行成熟实现与门禁可对照（见 §7） |
| 3 | `photon`（图片 EXIF/缩放） | ① `jimp`（纯 JS，无原生依赖）② ArkTS 侧 `@ohos.multimedia.image` 原生解码/缩放，经宿主桥回传 ③ 关掉图片附件 | 改 pi 包内部 or 宿主桥 | 中～高；解释器下纯 JS 解大图很慢（数十秒级风险） |
| 4 | `quickjs-wasi`（code-mode） | `node:vm`（**不是安全沙箱**）或直接关闭 | 开关级 | 低（关）/ 中（换） |
| 5 | `source-map08` | 接受降级；或换纯 JS `source-map` | 无 | 低 |
| 6 | 运行时 TS 转译（若有） | `jiti`（纯 JS，pi 已用于扩展加载）/ `@babel/standalone`（dshm 同款，vendored 3.07 MB） | pi 侧 | 低～中 |

**注意**：`esbuild` / `@next/swc-*` 的原生二进制方案在 HarmonyOS arm64 上**不存在**（无对应 `.node`），
所以"换原生"不是选项，只有"纯 JS"或"去掉需求"。

---

## 7. 同源工程的做法（可直接复用的部分）

### 7.1 `harmonyos-node-notes`（知识库口径）

- SIGTRAP（`Check failed: 12 == (*__errno_location())`）的修法就是 `--jitless`，并明确警告：
  **`--jitless` 会关掉 WebAssembly；用 `fetch`（undici llhttp 是 WASM）会启动即崩**；
  "先不带 `--jitless` 试一次 —— 实测部分设备根本不需要它"（`docs/01-六条硬约束与必崩坑.md` §3.1）。

### 7.2 `dshm`（真实应用，明确选择零 ACL）

- **决策**：统一按 jitless 运行、**不申请任何特殊权限**（`appstate/src/main/ets/model/Core.ets:405`）；
  理由：手机上 `ALLOW_WRITABLE_CODE_MEMORY` 申请不下来（`docs/50` E13/E35）。
- **工程化**：`buildHostArgv()` 把 `--jitless` 钉在**脚本路径之前**（顺序错了会被当脚本名），
  单测 `host_argv_pins_jitless_before_script` 钉死；worker 线程同样补齐（`check-worker-jitless`）。
- **踩坑链**：E33→E34→E35→E36（本机复现）→E38（定位 `lazyUndici`）→E39（封 getter 后消失）。
- **替换清单**：`fetch` 垫片（960 行，纯 JS，原生 llhttp）、TS 擦除器改 `@babel/standalone`、
  PTC 运行时改同进程纯 JS、`tar.gz` 解包改纯 JS、终端改纯 JS 命令翻译层。
- **纪律**：每个替换都配**带对照臂**的门禁（"没有垫片必须失败"），且先在 PC 上 `node --jitless` 秒级复现。

**可直接借用的两点**：① `hostcore/app/fetch-shim.js` 的覆盖面与陷阱注释（`FormData` 的 `instanceof` 陷阱、
`node:http` 惰性 getter）；② "PC 先复现、真机只验结论"的迭代方式。

---

## 8. 若要落地零 ACL：分阶段路线与判据

| 阶段 | 动作 | 判据（必须实测） |
|---|---|---|
| P0 | 固化 `--jitless`（release 也生效，不再依赖 debug 的 `probeFlags` 通道） | 设备启动到"就绪"不再出现 SIGABRT；`--jitless` 出现在 `argv` 且位于脚本路径之前 |
| P1 | `next.config.ts` → 预编译 `next.config.js` | 用 `--jitless` 起：崩溃点后移（应出现 Next 监听端口 / `PI_WEB_READY`） |
| P2 | 装纯 JS `fetch` 垫片 + 封 `node:http` 惰性 getter | 一次**真实对话**成功（`stopReason=stop`），SSE 流式正常 |
| P3 | 图片附件：换纯 JS 或走 ArkTS 原生，或砍掉 | 发一张图给模型成功，或 UI 明确"本档不支持图片" |
| P4 | code-mode 关闭 / source-map 降级 | 对应 UI 入口如实说明，不再有静默失败 |
| P5 | 性能与回归 | 冷启动、首屏、工具调用耗时对比表；把 §3 的 40× 纳入验收基线 |

**不要做的事**：
- 不要用 `--no-experimental-fetch`（Node 24 已移除，传了直接 `invalid negation`）；
- 不要只覆盖 `globalThis.fetch` 就以为绕开 undici（dshm E36 已否证：触发点在 `node:http` 惰性 getter）；
- 不要把"解释器模式"当成"只是慢"——它是**崩溃**，除非 P1/P2 都做完。

---

## 9. 未取证清单

| # | 项 | 说明 |
|---|---|---|
| 1 | §4.1 崩溃点的确切 JS 报错 | stderr 未桥接进 `node.log`；faultlog 无读权限。P1 做完即可反证 |
| 2 | 零 ACL 下 Next 的真实冷启动耗时 | 未测（当前连启动都过不去） |
| 3 | photon 路径失败的具体表现 | 未单独测（图片附件未在 jitless 下试过） |
| 4 | `--jitless` 与 ArkWeb 并存的稳定性 | 本次只测到崩溃点，未做长跑 |
| 5 | 撤销 `FILE_ACCESS_PERSIST` 后 `fs.pickFolder` 的 `persisted` 实际返回值 | 代码已改为恒 `false` + 原因，但未真机复查（payload 需重新打包才生效） |

---

## 附：本轮实测命令与读数（可复跑）

```bash
# 1) 零 ACL 现场（设备）：jitless 启动 ⇒ 约 0.5 s 后 SIGABRT
hdc shell 'aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility --ps probeFlags "--jitless"'
hdc shell "tail -30 /data/app/el2/100/base/org.fellow99.pi.PiDesktopArk/haps/entry/files/payload/node.log"
hdc shell "hilog" | grep -a "LastFatalMessage\|Signal:SIGABRT"

# 2) 对照（默认 flags）⇒ 存活、pi-web UI 正常
hdc shell "aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility"

# 3) fetch/WASM（本机，Node v24.7.0）
node --jitless -e "console.log(typeof WebAssembly)"          # undefined
node --jitless -e "fetch('http://127.0.0.1:38999/x').catch(e=>console.log(e.cause))"
#   → WebAssembly is not defined

# 4) 载荷里的 WASM 清单
hdc shell "find /data/app/el2/100/base/org.fellow99.pi.PiDesktopArk/haps/entry/files/payload/<hash>/pi-web -name '*.wasm'"
#   → 8 个（见 §5）
```

**结论**：本版**保留** `kernel.ALLOW_WRITABLE_CODE_MEMORY`，零 ACL 作为一条有明确代价与执行清单的**备选路线**留档。
若未来需要上手机/平板档（ACL 申请不下来），按 §8 的 P0→P5 逐阶段推进，每阶段的判据必须真机实测，不得以"应该可以"代替。

---

## 10. compat（`--jitless`）形态的功能核对结果

> 结论先行：**真正缺的功能只有 code-mode 一项**；其余是"退化"（变慢）与"调试信息降级"，另有 MCP 工具的**用法变化**。
> 依据 = 设备实测（`HAD-W32` 平板 / `JUY-AL80` 手机，Node v24.2.0，载荷 `29ab4aca52e4`）+ 载荷依赖面逐项核对。
> 完整原始输出见 `logs/20261020-2/TEST_REPORT.md`、`logs/20261020-3/PHONE_REPORT.md`。

### 10.1 真正的功能缺失（1 项）

| 功能 | compat 下状态 | 证据 |
|---|---|---|
| **code-mode（JS 代码沙箱工具）** | ❌ 不可用：工具**不注册**，模型无法"写一段 JS 批量编排工具" | 设备 `GET /api/mcp` → `codemode.sandbox = {state:"unavailable", error:"… Failed to load QuickJS: Cannot read properties of undefined (reading 'compile')"}`；jit 下同一自检 `{state:"available"}`。上游代码：`pi-web/lib/builtin-extensions.ts` 在 `sandbox.available === false` 时用 `unavailableExtension` 替代 code-mode |

连带影响（同源）：

| 影响面 | 说明 | 依据 |
|---|---|---|
| 子代理 | 配置了 code-mode 的 subagent profile 加载即失败（`Code mode is unavailable: <reason>`），以无 code-mode 方式运行 | `lib/builtin-extensions.ts:402-404` |
| **MCP 工具（用法变化，非消失）** | MCP server 默认 `exposure: codemode`，compat 下被自动降级为 `deferred`；SDK 对 `deferred` 的定义是「不预先声明，等 `tool_search` 取回后可直接调用，**不需要 code-mode**」⇒ 工具仍可用，但模型须先调一次 `tool_search` | `lib/mcp-host.ts:180-189`（`withReachableExposure`）+ `pi-agent/dist/extensions/mcp/index.js:47` |

### 10.2 性能退化（能用，但慢）

| 场景 | jit | compat | 备注 |
|---|---|---|---|
| V8 热循环 | 基准 | **7–10× 慢** | `ohos-node-bridge/docs/000-工程规划.md` §D.10 |
| 图片重编码（仅"超限图"触发） | 2,100 ms（photon 套件全套） | **31,221 ms** | 平板 `devtest` 实测，≈15×；`108-photon` 22 通过 / 2 跳过 |
| 单步拆解（PC `--jitless`） | — | JPEG 解 ≈4.3 s / Lanczos3→800×600 ≈3.6 s / PNG 编码 ≈2.9 s / JPEG(80) ≈3.8 s；上游一次生成 PNG+5 档 JPEG ⇒ **最坏 25–30 s** | `specs/108-jitless/spec.md` §7；已加 >2000 ms 的 stderr 提示 |
| 冷启动到就绪 | 871–926 ms | 885–969 ms（平板）/ 1,616 ms（手机） | 基本无差异 |

**重要**：图片"已达标"路径**零解码**（`decodes=0`），常见情况不受影响；视觉模型看图是**原图直传**，不经过重编码
（`deepseek-flash` 识图实测：`usage.input=1028`、9,982 ms，识读中英文标识正确）。

### 10.3 调试信息降级

`next/dist/compiled/source-map08/mappings.wasm` 不可用 ⇒ 错误栈不做 source map 解码，报错指向打包后位置。
用户无感，排障时更难读（`specs/108-jitless/spec.md` FR-108-007 已登记为"可接受"）。

### 10.4 已知无害噪声

compat 冷启固定一条 `unhandledRejection: WebAssembly is not defined`（栈在 Node 内建 undici 的 `lazyllhttp`，代号 K1）。
进程存活、随后就绪 200 ⇒ 只是日志噪声。

### 10.5 明确**不受影响**的部分（均本轮实测）

ArkWeb 页面渲染（独立进程的 JS 引擎，与 V8 jitless 无关）· 对话与 SSE 流式 · 真实模型调用
（非流式 203 ms / 流式 722 ms，8 块 / 21–30 个 SSE 事件）· 图片附件与视觉识图 · Git 扩展（21+1 工具、
本地链 17 步、凭据脱敏）· 文件/搜索/`bash` 工具（真机 `echo $((2+2))` → `4`）· 会话管理与设置。

原因：三条 WASM 硬门已经在**载荷侧**改掉 —— `next.config` 预编译成 `.mjs`（绕开 WASM SWC）、`fetch` 用纯 JS 垫片
（原生 llhttp + `node:stream/web`）、`photon` 换纯 JS（`jpeg-js` + `pngjs` + 自研 Lanczos3）。

### 10.6 由本核对导出的产品决策（已落地）

| 决策 | 落地位置 |
|---|---|
| 所有 `deviceTypes`（2in1 / tablet / phone / tv）**默认走 compat（`--jitless`）** | `entry/src/main/ets/common/BuildConfig.ets` 的 `NODE_MODE = 'compat'` |
| **不做运行期切换，只在编译期切换** | `NodeMode.resolve()` 只读 `BuildConfig.NODE_MODE`；`probeFlags` / `piNodeMode` / 偏好设置三条运行期入口**已移除**（手机实测：传 `--ps piNodeMode jit` 仍为 compat） |
| compat 形态**禁用 code-mode** | 由沙箱自检失败 ⇒ 工具不注册（上游行为），本版不提供替代沙箱 |

> 为什么不是"默认 jit、ACL 探测兜底"：手机 `JUY-AL80` 上 `ALLOW_WRITABLE_CODE_MEMORY` 查询**已授予**，但按 jit 启动
> 进程在 `libnode_bridge` 内 **SIGTRAP(TRAP_BRKPT)** 秒崩（同一 HAP 改 compat 1.6 s 就绪）⇒ 权限位不是 JIT 可用性的预检；
> 而一次误判 = 终态 `failed`（进程内 Node 不能重启），代价远大于 compat 的 7–10× 变慢。

---

## 附录：ohos-node-bridge → ohpm 双包迁移说明（2026-10-22）

> 本文档正文保留写作时的历史口径（旁路同级目录、手工投放等描述**不逐处改写**），迁移变动以本附录为准：

1. **库与运行时已上架 OpenHarmony ohpm 中心仓**（2026-10-22）：`@fellow99/node-bridge@0.1.0`（ArkTS API + NAPI 引导件）
   与 `@fellow99/node-runtime@24.2.0`（`libnode.so` + `libc++_shared.so`，版本 = Node 版本）。库源码仓库：
   [github.com/fellow99/ohos-node-bridge](https://github.com/fellow99/ohos-node-bridge)。
2. **`pi-desktop-ark` 改为常规 ohpm 版本号依赖**（`oh-package.json5`），父工程已移除 `ohos-node-bridge` submodule；
   历史的 `file:./libs/@fellow99/node-bridge.har` 本地旁路与 `scripts/build-bridge-har.sh` **退役**。
3. **运行时不再手工投放**：`scripts/provision-runtime.sh`（委托 `tools/provision.mjs`）退役，
   `libnode.so`/`libc++_shared.so` 由 `@fellow99/node-runtime` 的 HAR 经 hvigor 随 HAP 合并
   （`libnode.so` SHA-256 = `3019bf5f…51a1`，与锁值逐字一致，HAP 解包实测）。
4. **库载荷三件 vendored**：`bootstrap.js` / `host.js` / `lib/tar-extract.js` 不随 HAR 分发，
   已自持到 `vendor/node-bridge-payload/`（与原 `ohos-node-bridge/payload/` 逐字一致），
   `scripts/assemble-payload.mjs` 默认源改指该目录。
5. **相对路径引用失效**：正文中指向 `../ohos-node-bridge/` 的运行时契约 / 冻结契约链接，一律改为 GitHub 仓库对应路径。
6. **迁移后真机复测通过**（2026-10-22，HUAWEI MateBook Pro `3QC0226526001227`）：
   构建 → 安装 → Node v24.2.0 进程内就绪 → `GET /` 200（pi-web SPA）→ `/api/web-auth` 免密放行。

> 迁移不影响本文的 ACL / JIT 结论：ACL 仍由宿主应用按自己包名申报，`--jitless` 形态决策（编译期 `NODE_MODE`）不变；仅 `libnode_bridge.so` / `libnode.so` 的**来源**从手工投放改为 ohpm 包（内容与 SHA 同源同值）。
