# tasks.md —— `108-jitless` 任务分解

> 对应 [`spec.md`](spec.md) / [`plan.md`](plan.md)。状态：`[ ]` 待办 ｜ `[x]` 完成 ｜ `[!]` 阻塞。
> 依赖顺序：T1 → T2/T3 并行 → T4 → T5 → T6 → T7 → T8。

## A. 规范

- [x] **T0** 方案决策与反证记录（`docs/108-jitless-方案决策.md`）
- [x] **T0b** spec / plan / tasks / test-cases（本目录）

## B. 载荷兼容层（`payload/jitless/`）

- [x] **T1** `index.js`：`installIfNeeded()` 开关 + 编排 + 结构化日志（`installed`/`kept`/`failed`）
- [x] **T2** `http-lazy-undici.js`：封印 `node:http`/`node:https` 惰性 getter（仅 WASM 缺失）
- [x] **T3** `fetch-shim.js`：纯 JS `fetch`（Headers/Request/Response/FormData/Blob/File + SSE + 重定向 + 中止；能力判据不用 `instanceof`）
- [x] **T4** `undici-shim.js`：compat 形态 undici 面（`install()` 空操作、dispatcher 惰性、占位构造器）
- [x] **T5** `image-codec.js` + `photon-shim.js`：同步 photon API + 惰性解码（JPEG/PNG 编解码，GIF/WebP 取宽高）+ Lanczos3
- [x] **T6** `vendor/jpeg-js`、`vendor/pngjs`：vendor 脚本 + sha256 锁定
- [x] **T7** `payload/pi-web-launch.js` 接线（require Next 之前）
- [x] **T8** `selftest/run.mjs` + 本机 `node --jitless` 全绿

## C. ArkTS

- [x] **T9** `common/Constants.ets`：模式/权限/参数常量
- [x] **T10** `common/NodeMode.ets`：`resolveMode` / `probeJitAcl` / `flagsFor`（纯逻辑）
- [x] **T11** `EntryAbility.ets`：解析并写 `AppStorage('nodeFlags')` + `('nodeMode')`
- [x] **T12** `pages/Index.ets`：状态串显示模式与依据

## D. 组装期

- [x] **T13** `assemble-payload.mjs`：`next.config.ts → .mjs` + 执行门禁 + 删 `.ts`
- [x] **T14** `assemble-payload.mjs`：`undici` 包条件入口（导出名从真实包读取）
- [x] **T15** `assemble-payload.mjs`：`photon-node` 包条件入口
- [x] **T16** `assemble-payload.mjs`：复制 `payload/jitless/` 进归档 + 审计输出
- [x] **T17** `assemble-payload --apply` 通过（AC-108-05），校验归档内容

## E. 质量门

- [x] **T18** code review（requesting + receiving），修 Critical/Important
- [x] **T19** 构建 HAP（`hvigorw assembleHap`），编译期零新增告警
- [x] **T20** 真机部署 + AC-108-06…10（compat 就绪 934 ms、路由/UI 均验、jit 零回归；K1 见 spec §8）
- [x] **T21** git 提交（`git-commit` 规范前缀；不提交 `build-profile.json5` 的本地签名改动）

## 阻塞项记录

- **B1（已解除）**：设备已连接（HAD-W32 / 3QC0226526001227），T20 完成；遗留 K1（compat 启动期一条无害 rejection）与 TC-108-19…21（需模型凭据）见 spec §8。
