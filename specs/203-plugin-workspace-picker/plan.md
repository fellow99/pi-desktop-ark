# 插件 · 选择工作区目录（203-plugin-workspace-picker）—— 方案

> 对应 `spec.md`（WHAT）。本文件记 HOW 与落地证据（as-built），与 `spec.md` 一一回引。

## 1. 方案概览

采用「**上游幂等补丁 + 宿主能力桥 + PL1 自检扩展**」三层，复用 pi-web 既有 HTTP 数据面，不引入新 IPC/协议：

```
┌─ pi-desktop-ark（本工程）──────────────────────────────────────────────┐
│ entry/src/main/ets/host/HostCapabilities.ets                         │
│   perm.check   → checkAccessTokenSync + 归因 + nextStep               │
│   perm.request → requestPermissionsFromUser（系统授权窗，异步）       │
│   perm.openAppInfo → ohos.settings.application.details 深链           │
│ payload/env.js                  PI_HOS_ROOTS 契约（declaredRoots→JSON）│
│ payload/extensions/harmony-workspace-roots.js  /roots 自检（3 根）     │
└───────────────────────────────────────────────────────────────────────┘
                    │ 同进程 / 文件信箱 / 环境变量
┌─ patches/v0.15.0/ ─────────────────────────────────────────────────────┐
│ 0002-cwd-sandbox-root-from-hos-roots    ?root=<id> 入口 + 沙箱根      │
│ 0005-directory-picker-contract          roots 契约 + 围栏 + 默认名去重 │
│ 0006-directory-picker-permission-flow   403+permission + /api/host/perm│
│                                          +「请求权限/刷新」 UI + i18n  │
│ 0007-directory-picker-root-fence        移除手输路径（FR-203-007）    │
└───────────────────────────────────────────────────────────────────────┘
```

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 三根（去桌面） | 桌面 `system_basic`+ACL 本版不申请；需求只要求沙箱/文档/下载 |
| D2 | 授权门：Tab 只查不弹 | 需求明示；避免点 Tab 即弹窗打扰；`requestPermissionsFromUser` 只应在用户显式点「请求权限」时调用 |
| D3 | 权限白名单放服务端路由 | 防止借路由请求任意权限形成后门（FR-ARK-203-009） |
| D4 | 围栏放服务端 + 客户端双保险 | 服务端 `findEnclosingPickerRoot` 截断 parentPath；客户端移除手输路径（0007） |
| D5 | 主目录记忆只记根 id | 子路径由宿主重算，非法值回退沙箱（FR-ARK-203-014） |

## 3. 落地清单（as-built）

| # | 落点 | 文件 | 状态 |
|---|---|---|---|
| 1 | 宿主根声明 | `entry/src/main/ets/app/PiDesktopRuntime.ets#declaredRoots()` | ✅ 已有（3 根） |
| 2 | 宿主权限桥 | `entry/src/main/ets/host/HostCapabilities.ets`（perm.check/request/openAppInfo） | ✅ 已有；本轮修正归因/nextStep 陈旧文案 |
| 3 | 自检扩展 | `payload/extensions/harmony-workspace-roots.js`（/roots，3 根） | ✅ 已有 |
| 4 | 根/契约补丁 | `patches/v0.15.0/0002` + `0005` | ✅ 已有 |
| 5 | 授权流补丁 | `patches/v0.15.0/0006`（/api/host/perm + 按钮 UI + i18n） | ✅ 已有 |
| 6 | 围栏补丁 | `patches/v0.15.0/0007`（移除手输路径；v0.14.1/0.14.2 同步拷贝；v0.12.1/v0.13.0 略不同未回填）| ✅ 本轮新增，往返验证 PASS |
| 7 | 规格 | `specs/203-plugin-workspace-picker/{spec,plan,test-cases}.md` | ✅ 本轮新增 |

## 4. 评审发现（requesting/receiving-code-review 方法论）

| # | 发现 | 级别 | 处置 |
|---|---|---|---|
| R1 | `HostCapabilities.ets` 的 `attribution()`/`nextStep()` 对文档/下载仍写「已撤掉该声明、不再作为工作区根」，与 `module.json5` 的重新声明矛盾（会误导权限归因）| **Important** | 已修正：归因改为「normal 级 user_grant，可经 perm.request 弹窗授权」；`nextStep` 对文档/下载回 `perm.request` |
| R2 | picker 仍保留手输路径（`pathInput`/`handlePathSubmit`/Go 按钮），可沿路径浏览越出根围栏；hos 规范已移除（FR-203-007 声称已实现但代码未实现）| **Important** | 已新增 0007 补丁移除；往返验证 PASS |
| R3 | `PICKER_ROOT_IDS` 共享表含 `desktop` 名义项 | Minor | 保留（宿主不声明则不显示；改动会扩大补丁面） |

## 5. 补丁纪律核对（0007）

- 正向：`git apply --check` PASS；`git apply` PASS（pi-web v0.15.0 0006 状态上）。
- 幂等：应用后 `--reverse --check` 命中。
- 往返：应用 → 反向 → 与 0006 状态 SHA 一致（已实测）。
- 版本：v0.15.0（活跃）+ v0.14.1/v0.14.2（DirectoryPicker 基座相同，逐字节拷贝）；v0.12.1/v0.13.0 基座不同，未回填（历史 tag，构建期不再使用）。

## 6. 测试计划

- 本轮不真机（需求：「pi-desktop-ark 暂不测试」）；`test-cases.md` 的用例记 `⬜ 真机待补`。
- 可离线核对项（本轮已做）：补丁顺序应用 PASS / 反向往恢复 pristine / 无残留引用。

## 7. 风险与遗留

| # | 风险 | 缓解 |
|---|---|---|
| R4 | `requestPermissionsFromUser` 真机行为（弹窗、授权生效时延）未验证 | ⬜ 真机验收；按 deepseek 参考的「短轮询再读」思路复核 |
| R5 | 0007 未回填 v0.12.1/v0.13.0 | 历史 tag 不再构建；如有需要按 README 的 worktree 流程重出 |
