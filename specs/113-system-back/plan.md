# 113-system-back — plan（系统级返回按钮行为改造 · Ark）

> 方案。对应 specs/113-system-back/spec.md。

## 1. 方案概览

与 android 同形，native 侧不同：

1. **pi-web 补丁（与 android 同一份 `0008-system-back.patch`）**：AppShell 加 `pi-back` 监听 effect。
2. **ArkTS 宿主**：`Index.ets onBackPress()` 改造——
   - App 调试弹窗打开 → 关闭调试弹窗（既有，保序在前）；
   - READY → `controller.runJavaScript("window.dispatchEvent(new Event('pi-back'))").catch(warn)` 后 `return true`（拦截）；
   - 非 READY → `return false`（交系统）。
3. **spec 四件套 + 静态核对**（无真机）。

## 2. 关键设计决策（含决策链）

| # | 决策 | 依据 |
|---|---|---|
| D1 | **修改载荷，用补丁不用插件** | 同 android（React 内部状态；既有先例均走幂等补丁） |
| D2 | **事件协议 `pi-back` 三平台一致** | 一份补丁三平台复用；壳用 `runJavaScript` 派发 |
| D3 | **派发后仍 `return true` 拦截** | 保首页/会话页 no-op + 不放行回 boot/退出（既有 READY 语义不破坏） |
| D4 | **异常只 warn 不抛** | `runJavaScript` 需页面就绪；未就绪静默降级为 no-op，不崩返回键路径 |
| D5 | **范围：不驱动 HTML 弹窗** | 用户确认 ① |
| D6 | **跳过测试（无鸿蒙真机）** | 用户提供；仅静态核对 |

## 3. 实施落点（checklist）

- [ ] 安置 `0008-system-back.patch`（与 android diff 一致）到 `patches/v0.15.0/`
- [ ] `Index.ets onBackPress()` 改造（调试弹窗 → READY 派发+拦截 → 非 READY 交系统）
- [ ] `logs/20261111-1/DEV_CHECKLIST.md` 日志
- [ ] `git apply --check` 通过 + 静态核对三平台协议一致

## 4. 评审计划（Phase 3.5）

- 用 requesting-code-review / receiving-code-review 技能评审补丁 + ArkTS 改动；Critical/Important 修复后回填 `REVIEW_REPORT.md`。

## 5. 测试计划（Phase 4）

- ⛔ 无鸿蒙真机 → **跳过**真机测试；执行静态核对（补丁应用检查、协议一致、代码路径走查）。
- 测试用例在 test-cases.md 中对应标注 SKIP（真机）与 PASS/FAIL（静态）。

## 6. 风险与遗留

- **风险**：`runJavaScript` 在页面未加载完成时派发会 reject → 已用 catch 兜底（no-op）。
- **风险/遗留**：真实设备上返回键到达 ArkTS `onBackPress` 的时序与行为依赖设备，`⬜ 待验证`（无真机）。
- **遗留**：HTML 弹窗不关闭（用户确认 ① 排除）。
