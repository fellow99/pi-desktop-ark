# plan.md —— `108-jitless` 实现方案

> 对应需求：[`spec.md`](spec.md)。方案决策与反证记录见 [`../../docs/108-jitless-方案决策.md`](../../docs/108-jitless-方案决策.md)。

## 1. 总体结构

```
ArkTS（模式判定）                        Node 载荷（自适应安装）
─────────────────────┬──────────────────────────────────────────
EntryAbility          │  pi-web-launch.js
  ├ probeFlags(debug) │    ├ require('./jitless')  ← 在 require Next 之前
  ├ piNodeMode(debug) │    │    ├ sealHttpLazyUndici()      （WASM 缺失才做）
  ├ preferences       │    │    ├ installFetchShim()        （node:http/https + stream/web）
  └ ACL 探测(auto)     │    │    └ facts → app.log
        │             │    └ require Next（next.config.mjs 已预编译）
        └ flags 串 ────┼──→ 库 node::Start(argv: [node, ...flags, script])
                      │
组装期（scripts/assemble-payload.mjs，只写 stage，不动源目录）
  ├ next.config.ts → next.config.mjs（+ 执行门禁），删 .ts
  ├ 每个 undici 包：生成 pi-jitless-entry.cjs，package.json#main 指向它
  └ 每个 photon-node 包：生成 pi-jitless-entry.cjs，package.json#main 指向它
```

**唯一开关**：`typeof WebAssembly === 'undefined'`（运行期）；组装期改动只**新增**文件 + 改 `main`/配置文件名。

## 2. 文件级改动清单

### 2.1 ArkTS 侧（`entry/src/main/ets/`）

| 文件 | 改动 |
|---|---|
| `common/Constants.ets` | 新增：`JITLESS_FLAG='--jitless'`、`ACL_WRITABLE_CODE_MEMORY='ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY'`、`NODE_MODE_*` 常量、偏好键名、`PI_NODE_MODE_PARAM='piNodeMode'` |
| `common/NodeMode.ets`（新） | 纯函数 `resolveMode(debugBuild, wantParams, preferencesValue) → { mode, reason }`；ACL 探测 `probeJitAcl(context)`（`bundleManager.getBundleInfoForSelfSync` + `abilityAccessCtrl.checkAccessTokenSync`，异常⇒compat）；`flagsFor(mode)`。**不引 UI、不读全局状态**，便于单测式推演 |
| `entryability/EntryAbility.ets` | `onCreate` 里用 `NodeMode` 解析模式 → 写 `AppStorage('nodeFlags')`（既有）与 `AppStorage('nodeMode')`（诊断展示） |
| `pages/Index.ets` | 启动状态串加模式与依据（`flags=… mode=compat(acl-denied)`），不改布局 |
| `app/PiDesktopRuntime.ets` | 仅注释：说明 `--jitless` 由 flags 串承载、位置由库保证（不改逻辑） |

### 2.2 载荷兼容层（`payload/jitless/`，新增）

| 文件 | 职责 |
|---|---|
| `index.js` | `installIfNeeded(log)`：开关判定 + 编排 + 结构化日志；**唯一出口** |
| `http-lazy-undici.js` | 封印 `node:http`/`node:https` 的惰性 getter（只在 WASM 缺失时） |
| `fetch-shim.js` | 纯 JS `fetch`（`Headers`/`Request`/`Response`/`FormData`/`Blob`/`File` + SSE + 重定向 + 中止） |
| `undici-shim.js` | compat 形态的 undici 面：`install()` 空操作、dispatcher 惰性、占位构造器 |
| `photon-shim.js` | 同步 photon API 面 + 惰性解码（jpeg-js / pngjs / 自实现 Lanczos3） |
| `image-codec.js` | 文件头宽高解析（JPEG/PNG/GIF/WebP）+ 解码/编码分派 |
| `vendor/jpeg-js/`、`vendor/pngjs/` | vendored 纯 JS 编解码器（锁 sha256） |
| `selftest/run.mjs` | PC 侧自检：`node --jitless payload/jitless/selftest/run.mjs`（fetch / undici 面 / 图片 / http getter） |

`payload/pi-web-launch.js`：在 `require` Next 之前加 6 行 —— 调 `require('./jitless').installIfNeeded(...)` 并把返回事实并入启动日志。

### 2.3 组装期（`scripts/assemble-payload.mjs`）

| 步骤 | 说明 |
|---|---|
| `precompileNextConfig(stage)` | 读 `next.config.ts` → 生成 `next.config.mjs`（优先用 `typescript` 若可解析；否则用受控的 typestrip：去掉 `import type`、类型注解、`as X`）→ 删除 `.ts` → **执行门禁**：`await import()` 断言导出含 `serverExternalPackages`/`images`/`env`/`headers` |
| `instrumentUndiciPackages(stage)` | 找出所有 `package.json#name==='undici'` 的目录 → 读真实导出名 → 写 `pi-jitless-entry.cjs`（显式具名再导出）→ 改 `main` |
| `instrumentPhotonPackages(stage)` | 同上，针对 `@silvia-odwyer/photon-node`（导出名 `PhotonImage`/`resize`/`fliph`/`flipv`/`SamplingFilter`） |
| `copyJitlessRuntime(stage)` | 把 `payload/jitless/` 复制进归档（`pi-web/jitless/`），供运行期 `require` |
| 审计输出 | 每步打印「改了哪个文件、为什么」，`--json` 报告里新增 `jitless` 段 |

> 归档里 `pi-web-launch.js` 的 `require('./jitless')` 用**相对路径**，因此兼容层必须与入口**同目录部署**（`pi-web/jitless/`）。

### 2.4 文档

- `docs/ACL-无ACL评估.md` 追加一节「108-jitless 落地结果」；
- `README.md` 的「已知限制」一行补 `--jitless` 形态的用法（`piNodeMode=compat`）。

## 3. 关键实现要点（易错处）

1. **`undici` 具名导出不能靠 `module.exports = require('./x')`**：实测 `import * as u` 只能拿到 `default`。必须显式 `module.exports = { A: impl.A, … }`（`cjs-module-lexer` 才识别）。
2. **`install()` 必须空操作**：`pi-web` 与 `pi-coding-agent` 两侧都会调 `undici.install()`，它会把 `globalThis.fetch` 换成 WASM 版。
3. **封印惰性 getter 只在 compat 做**：jit 形态封掉会让原生 undici 报 `http.maxHeaderSize invalid`。
4. **`FormData`/`Headers` 判据用能力不用 `instanceof`**：Node 24 的原生实现与垫片实现跨来源，`instanceof` 必然漏判（dshm 真实事故：请求头全丢 ⇒ 401）。
5. **`photon` 必须同步**：上游 `image-resize-core.js` 全程无 `await`。
6. **`photon` 惰性解码**：pi 先取宽高、命中"已达标"就返回原始字节 ⇒ 只解析文件头即可不付解码代价。
7. **`--jitless` 位置**：必须在 `flags` 串里（库把 `flags` 全部排在 `scriptPath` 之前）；放进 `options.argv` 之后会被当成脚本参数。
8. **release 合规**：`probeFlags` / `piNodeMode` 都只看 `applicationInfo.debug`。

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| 真机 jitless 冷启动可能超过 `READY_TIMEOUT_MS=90s` | 先实测；若超时则只在 compat 形态上调高（不改变 jit 形态） |
| 解释器下图片解码慢 | 惰性解码 + 前端已有压缩；超限图才付代价，日志记录耗时 |
| `pi-dist` 升级后 `undici`/`photon` 布局变化 | 组装步骤按 `package.json#name` 查找（不写死路径），导出名从真实包读取 |
| 上游 SSE 解析对 `Response` 有额外期望 | 以 PC 侧 selftest 覆盖 GET/POST/SSE/中止；真机对话作为最终判据 |
| 组装期 typestrip 出现偏差 | 优先用 `typescript` 编译器；两条路径都跑"执行门禁"（导入并断言键） |

## 5. 验证策略

1. **PC 优先**（`node --jitless` 秒级迭代）：`payload/jitless/selftest/run.mjs` 覆盖 AC-108-01…04；
2. **组装门禁**：AC-108-05；
3. **真机**：AC-108-06…10（需 hdc 在线与对应 Profile）。
