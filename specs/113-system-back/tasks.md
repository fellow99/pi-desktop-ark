# 113-system-back — tasks（系统级返回按钮行为改造 · Ark）

> 依赖有序任务清单。对应 specs/113-system-back/{spec,plan}.md。

## T1 设置（Setup）
- [ ] T1.1 确认 pi-web 工作树 v0.15.0 干净
- [ ] T1.2 建日志目录 `logs/20261111-1/` + `DEV_CHECKLIST.md`

## T2 补丁 + 宿主（Foundational）
- [ ] T2.1 安置 `0008-system-back.patch`（与 android/ark 同一 diff）到 `patches/v0.15.0/`
- [ ] T2.2 改 `entry/src/main/ets/pages/Index.ets` 的 `onBackPress()`（调试弹窗→READY 派发+拦截→非 READY 交系统）
- [ ] T2.3 `git apply --check` 通过

## T3 验证（User Story）
- [ ] T3.1 静态核对：`pi-back` 协议名三平台一致；补丁文件与 android 逐字节一致
- [ ] T3.2 代码路径走查（onBackPress 三分支：调试弹窗/READY/非 READY）

## T4 Code Review（Phase 3.5 门禁）
- [ ] T4.1 requesting-code-review 分派评审（Critical/Important/Minor）
- [ ] T4.2 receiving-code-review 核实并修复 Critical/Important
- [ ] T4.3 `REVIEW_REPORT.md` 回填 + `fix:` 提交

## T5 测试（Phase 4）
- [ ] T5.1 ⛔ 无鸿蒙真机 → 跳过真机用例（test-cases.md 标注 SKIP）
- [ ] T5.2 静态核对项逐条记录 PASS/FAIL
- [ ] T5.3 `TEST_REPORT.md` 产出 + `test:` 提交

## T6 Bugfix / Regression（Phase 5/6）
- [ ] T6.1 修静态核对提出的问题
- [ ] T6.2 最终 `TEST_REPORT.md` + 提交
