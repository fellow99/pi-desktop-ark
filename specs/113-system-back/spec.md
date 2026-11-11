# 113-system-back — spec（系统级返回按钮行为改造 · Ark）

> **Module:** 113-system-back ｜ **Status:** 开发中 ｜ **Last Updated:** 2026-11-11
> **需求编号:** 113-system-back ｜ **需求名称:** 修改系统级返回按钮对应用的行为
> **git 分支:** 不改动 ｜ **测试:** 无鸿蒙真机，跳过测试（仅静态核对）
> **上游基线:** pi-web v0.15.0（tag `f130910`）· 关联模块 `103-arkweb-shell-render-and-pages`
> **实现载体:** 上游幂等补丁 `patches/v0.15.0/0008-system-back.patch` + ArkTS 宿主 `pages/Index.ets`
> **注:** 该需求**不注册到父工程 specs**，仅落到各子工程 `specs/113-system-back/`。

---

## 1. 模块概述

### 1.1 目的

把系统级「返回」键行为从「主界面直接拦截」扩展为「按界面浮层收敛 + 拦截」：

- 设置页打开 → **关闭设置页**；
- 移动端抽屉打开 → **收回抽屉**；
- 首页 / 会话页 / 无浮层 → **不做任何操作**（ARK 现行已不退出，保持）。

### 1.2 解决的问题

| # | 痛点 | 结论 |
|---|---|---|
| 1 | READY 态返回被整体拦截，设置页/抽屉无返回关闭入口 | 拦截改为「先派发 `pi-back` 由 Web 收敛浮层，再拦截」 |
| 2 | Web 浮层状态在 React 内部，ArkTS 壳无法直读 | 走幂等补丁改 pi-web（AppShell），壳负责捕获 + 派发事件 |
| 3 | 首页/会话页返回无意义 | 保持 no-op（返回 true 拦截、不放行回 boot/退出）——与既有哲学一致 |

**范围收敛（用户确认 ①）：** 不驱动 HTML 弹窗。
**范围收敛（用户确认 ②）：** 全自动执行流程；鸿蒙无真机 → **跳过测试阶段**（对比 android，仅做静态核对）。

### 1.3 范围

**包含**：web 补丁（与 android/ark 同一份 `0008-system-back.patch`）、ArkTS `Index.ets onBackPress()` 改造、spec 四件套。
**不包含**：HTML 弹窗返回关闭、真机测试（无设备）、父工程 specs 登记。

## 2. 用户故事

- 作为用户，我在设置页按系统返回，设置页关闭，而不是停留在设置页或退出应用。
- 作为用户，我拉出移动端抽屉后按系统返回，抽屉收回。
- 作为用户，我在首页或会话页按系统返回，应用保持现状、不退出。

## 3. 功能需求

### 3.1 协议（web ⇄ 壳）

- **FR-ARK-113-001** `onBackPress()` 在 READY 态 MUST 调用
  `this.controller.runJavaScript("window.dispatchEvent(new Event('pi-back'))")` 派发事件（Promise 需 `.catch`，页面未就绪不崩）。
- **FR-ARK-113-002** 派发后 MUST 仍 `return true` 拦截（不放行回 boot/退出）——首页/会话页 no-op 由该拦截保证。
- **FR-ARK-113-003** 事件协议名统一为 `'pi-back'`，三平台一致。

### 3.2 Web 补丁行为（pi-web AppShell，与 android 同一份）

- **FR-ARK-113-004** 收到 `pi-back` 且 `settingsSection !== null` ⇒ 关闭设置页（同 android 语义）。
- **FR-ARK-113-005** 设置页未开、`isMobile && sidebarOpen` ⇒ 收回抽屉。
- **FR-ARK-113-006** 其余（首页/会话页/无浮层）⇒ no-op。

### 3.3 宿主（Index.ets）

- **FR-ARK-113-007** App 调试弹窗打开时返回键仍优先关闭调试弹窗（既有行为，不回归）。
- **FR-ARK-113-008** `status !== READY`（启动/失败）时返回键行为不变（返回 false，交系统）。
- **FR-ARK-113-009** `runJavaScript` 拒绝/异常 MUST 只记 warn 不抛出（不破坏返回键路径）。

## 4. 验收

| # | 判据 | 状态 |
|---|---|---|
| 1 | 7 条既有补丁 + 0008 幂等应用 | ⬜ |
| 2 | `onBackPress` 代码路径静态核对（派发 + 拦截 + 异常兜底） | ⬜ |
| 3 | 事件协议名三平台一致 | ⬜ |
| 4 | ~~真机用例~~（无鸿蒙真机，跳过） | — |

## 5. 实现锚点

- `patches/v0.15.0/0008-system-back.patch`（pi-web `components/AppShell.tsx`）
- `entry/src/main/ets/pages/Index.ets`（`onBackPress()`）
