# 113-system-back — 测试用例（系统级返回按钮行为改造 · Ark）

> 无鸿蒙真机 → 真机用例全部 **SKIP**；仅执行「离线 / 静态核对」。

## 一、真机交互（⛔ 无设备，全部 SKIP）

### TC-ARK-001：设置页关闭
**优先级** P1 ｜ **类型** Functional ｜ **状态**：SKIP（无真机）
**期望**：READY 设置页按返回 → 设置页关闭、应用不退出

### TC-ARK-002：移动端抽屉收回
**优先级** P1 ｜ **类型** Functional ｜ **状态**：SKIP（无真机）
**期望**：READY 抽屉打开按返回 → 抽屉收回、应用不退出

### TC-ARK-003：首页 / 会话页 no-op
**优先级** P1 ｜ **类型** Functional ｜ **状态**：SKIP（无真机）
**期望**：READY 首页或会话页按返回 → 界面不变、应用不退出（既有拦截保持）

## 二、离线 / 静态核对（可执行）

### TC-ARK-004：补丁幂等
**优先级** P1 ｜ **类型** Static
**步骤**：`git apply --check patches/v0.15.0/0008-system-back.patch`
**期望**：通过
**实际**：⬜ ｜ **状态**：⬜

### TC-ARK-005：补丁与 android 一致
**优先级** P1 ｜ **类型** Static
**步骤**：`diff <ark>/patches/v0.15.0/0008-system-back.patch <android>/patches/v0.15.0/0008-system-back.patch`
**期望**：无差异
**实际**：⬜ ｜ **状态**：⬜

### TC-ARK-006：onBackPress 代码路径走查
**优先级** P1 ｜ **类型** Static
**步骤**：核对三分支 —— ①App 调试弹窗打开→关闭调试弹窗；②READY→`runJavaScript('pi-back')` 派发 + `return true`；
③非 READY→`return false`
**期望**：三分支齐全、事件名 `'pi-back'`、异常有 catch
**实际**：⬜ ｜ **状态**：⬜

### TC-ARK-007：协议三平台一致
**优先级** P2 ｜ **类型** Static
**步骤**：grep `pi-back` 于 android/ark/hos 壳代码 + 补丁
**期望**：事件名全部 `'pi-back'`
**实际**：⬜ ｜ **状态**：⬜

## 三、验收对照

| AC# | 判据 | 结论 |
|---|---|---|
| 1 | 0008 幂等应用 | ⬜ |
| 2 | onBackPress 路径静态核对 | ⬜ |
| 3 | 协议三平台一致 | ⬜ |
| 4 | 真机用例 | SKIP（无设备） |
