# 插件 · 选择工作区目录（203-plugin-workspace-picker）—— 规格

> **Module:** 203-plugin-workspace-picker ｜ **Status:** 已实现（代码）、⬜ 真机验收待补 ｜ **Last Updated:** 2026-11-07
> **上游基线:** pi-web v0.15.0（tag `f130910`）· 关联模块 `104-host-capabilities-arkts-impl`（宿主能力桥）
> **需求编号:** 203-plugin-workspace-picker ｜ **需求名称:** 插件：选择工作区目录
> **git 分支:** 不改动（沿用工程纪律：不新建、不切换、不重命名）
> **参考:** `pi-desktop-hos/specs/203-plugin-workspace-picker/`（同编号、同需求但实现形态不同）
> **实现载体:** 上游幂等补丁 `patches/v0.15.0/0002/0005/0006/0007` + 本工程 `payload/extensions/harmony-workspace-roots.js` + `entry/.../HostCapabilities.ets`

## 1. 模块概述

### 1.1 目的

把 Pi Web 的「选择工作区目录」对话框改造为**三主目录**选择器（**沙箱 / 文档 / 下载**），
并对用户目录采用**授权门**语义：

- 点「文档 / 下载」Tab **只查询、不自动申请**权限；
- 有权限 → 直接显示目录列表；
- 无权限 → **不显示列表**，改为两个按钮「**请求权限**」「**刷新**」：
  - 「请求权限」→ 经 `/api/host/perm` → 宿主 `perm.request` 弹**系统授权窗**；
  - 「刷新」→ 重新按当前权限状态判定并渲染列表。

### 1.2 解决的问题

| # | 现状 / 痛点 | 结论 |
|---|---|---|
| 1 | 默认目录选择器起点在沙箱，无法把已授权用户目录注册为工作区 | 补丁 0002/0005 引入宿主声明根 + Tab 清单 |
| 2 | 用户目录未授权时表现为 `EPERM`，无引导 | 补丁 0006 引入 `/api/host/perm` + 授权门 UI |
| 3 | 主动申请权限需要 ArkTS 侧 `requestPermissionsFromUser`（带 active context），浏览器侧不可直接调 | 0006 路由 → 文件信箱 → `perm.request` |
| 4 | 桌目录（`system_basic` + ACL）本版不申请 | root 清单不含 `desktop`（`declaredRoots()`） |
| 5 | 手动路径输入可越出根围栏 | 补丁 0007 移除路径表单（对齐 hos 的 FR-203-007 语义） |

### 1.3 范围

**包含**：

- 三主目录（沙箱/文档/下载）的声明、切换、浏览、新建、采纳、记忆；
- 授权门（Tab 只查 → 未授权显示「请求权限/刷新」→ 系统授权窗 → 重试/刷新）；
- 根围栏（服务端 `findEnclosingPickerRoot` 截断 parentPath；客户端移除手输路径）；
- 宿主能力 `perm.check` / `perm.request` / `perm.openAppInfo`（`HostCapabilities.ets`）；
- 本模块 `spec.md` / `plan.md` / `test-cases.md`。

**不包含**：

- 父工程 `specs/` 登记（同 hos：本模块规格只落 `pi-desktop-ark/specs/`）；
- 桌面目录（`READ_WRITE_DESKTOP_DIRECTORY` system_basic + ACL，本版不申请）；
- 文件选择、多选、整盘浏览、显示隐藏文件开关；
- 真机编译与交互验收（本轮暂不测试，`⬜` 登记）。

## 2. 用户故事

- 作为用户，我希望在「选择工作区目录」里切到文档/下载，把已授权目录中的文件夹注册为工作区。
- 作为用户，当目录未授权时，我希望**先看到两个明确按钮**，而不是莫名其妙弹窗或报错。
- 作为用户，点「请求权限」后系统弹授权窗；授予后自动列出，拒绝后有归因与下一步。
- 作为用户，我希望对话框**没有手输路径入口**，浏览域锁在所选主目录内。
- 作为用户，我希望下次打开还停在上次用的主目录。

## 3. 功能需求

### 3.1 主目录与解析

- **FR-ARK-203-001** 对话框 MUST 渲染**三个**主目录 Tab（确切的 Tab 集合由服务端 `getPickerRoots()` 按宿主声明给出，顺序固定为 `sandbox → documents → download`）。宿主 `declaredRoots()` MUST 只声明 `sandbox` / `documents` / `download` 三项；MUST NOT 声明 `desktop`。
- **FR-ARK-203-002** `sandbox` 主目录 MUST 为宿主按 `context.filesDir` 派生并递归 `mkdir` 的工作区子目录；`documents` / `download` MUST 为 `/storage/Users/currentUser/{Documents,Download}`（`USER_HOME_DIR`）。
- **FR-ARK-203-003** 根清单 MUST 由宿主经 `PI_HOS_ROOTS`（JSON 数组）传给同进程的 Next 服务器；MUST NOT 在渲染进程读 `electron` / 读环境变量；前端只消费 `/api/cwd/browse` 响应里的 `roots`。
- **FR-ARK-203-004** 页面/切换期间，根路径 MUST 以宿主的声明为唯一事实源，MUST NOT 在前端硬编码任何绝对路径（含 `/storage/Users/currentUser/...`）。

### 3.2 授权门

- **FR-ARK-203-005** 点「文档 / 下载」Tab MUST **不自动请求权限**：仅浏览其目录；遇 `EACCES`/`EPERM`（403 + `permission`/`canRequest`）时 MUST 不渲染列表，改为渲染「请求权限」+「刷新」两按钮。
- **FR-ARK-203-006** 有权限时 MUST 正常渲染目录列表并可下钻/新建/选择；`canRequest=false`（如 `sandbox`）MUST 走通用错误话术，MUST NOT 显示授权按钮。
- **FR-ARK-203-007** 「请求权限」MUST 经 `POST /api/host/perm`（白名单：仅 `READ_WRITE_DOCUMENTS_DIRECTORY`/`READ_WRITE_DOWNLOAD_DIRECTORY`）→ 文件信箱 → 宿主 `perm.request`（`requestPermissionsFromUser`）弹系统授权窗；授权成功 MUST 自动重新列举，失败 MUST 保留按钮态并允许「刷新」重试。
- **FR-ARK-203-008** 「刷新」MUST 重新执行一次浏览（重新判定权限与渲染列表），MUST NOT 残留旧的权限提示。
- **FR-ARK-203-009** `/api/host/perm` MUST 是**白名单**：任何不在白名单内的权限请求 MUST 回 400；MUST NOT 允许借该路由请求 `system_basic` 等权限（安全属性）。
- **FR-ARK-203-010** 宿主 `perm.check` 的返回 MUST 包含准确归因与 `nextStep`；对**已重新声明**的文档/下载权限，`nextStep` MUST 为 `perm.request`（MUST NOT 再说「已撤掉该声明」）。此条为评审修复回引（`HostCapabilities.ets`）。

### 3.3 浏览与围栏

- **FR-ARK-203-011** 目录浏览 MUST 复用 pi-web 既有 `/api/cwd/browse`；列目录只返回目录、按名称排序、hidden 不渲染、`truncated` 提示（`MAX_DIRECTORY_ENTRIES=500`）。
- **FR-ARK-203-012** 服务端 MUST 用 `findEnclosingPickerRoot` 对「按路径浏览」做根围栏：目标恰好停在某根上时 `parentPath=null`，根内子路径时父目录截断到该根；MUST NOT 把根之上层级回给前端。
- **FR-ARK-203-013** 客户端 MUST NOT 存在手动路径输入入口（补丁 0007 移除 `pathInput` / `handlePathSubmit` / 路径表单与 Go 按钮）；「返回上级」按钮 MUST 以 `parentPath` 为唯一目标（服务端已截断），因此不可能越过根。
- **FR-ARK-203-014** 切换主目录 MUST 重置浏览栈到该根并清空选中态；主目录记忆 MUST 只记根 id（`localStorage` 键 `pi-hos-picker-root`），非法值 MUST 回退 `sandbox`，再次打开 MUST 停在该根（不回放子路径）。
- **FR-ARK-203-015** 新建文件夹 MUST 复用 `createDirectoryAuto`（默认名 `未命名文件夹`/`Untitled folder`/`未命名文件夾` 同级自动去重），创建后 MUST 重新列目录并选中；采纳 MUST 复用既有 `onSelect(path)` 链路，MUST NOT 改变采纳语义。

### 3.4 宿主能力

- **FR-ARK-203-016** 宿主 MUST 提供 `perm.check`（`checkAccessTokenSync` 只读预检 + 归因/nextStep）、`perm.request`（`requestPermissionsFromUser`，结果逐项 `authResult` 上报）、`perm.openAppInfo`（`ohos.settings.application.details` 深链）三个能力，MUST NOT 伪造成功。
- **FR-ARK-203-017** `perm.request` MUST 是异步能力（走文件信箱 `dispatchAsync`），调用方 MUST 给足超时（`/api/host/perm` 用 120 s 对应用户决策时间）。
- **FR-ARK-203-018** `payload/extensions/harmony-workspace-roots.js` MUST 提供 `/roots` 自检命令：打印三根的解析结果、存在性、可读性、授权状态；`EXPECTED_IDS` MUST 为 `["sandbox","documents","download"]`。

### 3.5 机制与纪律

- **FR-ARK-203-019** 上游改动 MUST 只以幂等补丁落地（`patches/v0.15.0/`：`0002` 根、`0005` 契约、`0006` 授权流、`0007` 围栏）；MUST 可往返（应用→反向→受影响文件 SHA-256 还原）；`../pi-web` 工作树 MUST 保持 pristine。
- **FR-ARK-203-020** 提交 MUST 遵循 Conventional Commits 前缀；本模块规范 ONLY 落 `pi-desktop-ark/specs/203-plugin-workspace-picker/`（父工程零新增规范）。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|---|---|---|
| PickerRoot | 主目录 Tab | `id`(sandbox/documents/download)、`label`、`path` |
| EnclosingPickerRoot | 服务端围栏结果 | `id`、`path`（root realpath）、`exact` |
| PermissionPrompt | 客户端未授权态 | `permission`、`directory?`、`rootId?` |
| PermRequestResult | 授权结果 | `requested`/`granted`/`denied`、`results[{permission,authResult,granted}]` |

## 5. 验收场景（回引 test-cases.md）

| 编号 | 场景 | 判据 |
|---|---|---|
| AC-ARK-203-01 | 三 Tab 可见且可切换 | Tab 集合 = 沙箱/文档/下载；切换重置栈、根清单来自服务端 |
| AC-ARK-203-02 | 沙箱根自动创建 | `<filesDir>/workspace` 缺失时打开自动重建 |
| AC-ARK-203-03 | 文档/下载未授权 | 点 Tab 不弹窗；只显示「请求权限」「刷新」；403 带 permission |
| AC-ARK-203-04 | 请求权限 | 触发系统授权窗；授予后自动列出；拒绝后保留按钮态 |
| AC-ARK-203-05 | 刷新 | 重新判定权限并渲染列表，无残留提示态 |
| AC-ARK-203-06 | 根围栏 | 无手输路径；面包屑/返回最高到根；path 浏览被服务端截断 |
| AC-ARK-203-07 | 新建/采纳/记忆 | 默认名去重、创建后选中；采纳复用既有链路；记忆只记根 id 且非法回退沙箱 |
| AC-ARK-203-08 | 补丁纪律 | 六条补丁顺序应用 PASS、反向往恢复 pristine；上游零改动 |

## 6. 非功能需求

- **安全**：授权门白名单（FR-ARK-203-009）、根围栏无手输路径（FR-ARK-203-013）、路径来源单一（FR-ARK-203-012）。
- **可维护**：根清单/权限名只由服务端与宿主给出；前端零路径/零权限名硬编码。
- **可靠**：`perm.request` 失败/被拒/桥不可达 MUST 结构化上报（`ok:false` + error/detail），MUST NOT 静默或伪造成功。
- **可逆**：补丁幂等、可往返；`../pi-web` 零改动。

## 7. 假设与约束

- **A1（✅ 已实现）**：`module.json5` 重新声明 `READ_WRITE_DOCUMENTS/DOWNLOAD_DIRECTORY`（normal 级 user_grant，无需 ACL）；桌面（system_basic）已撤 —— 与「三根 + 授权门」一致。
- **A2（✅ 已回顾）**：`HostCapabilities.ets` 的 `attribution`/`nextStep` 疑似陈旧（曾写「已撤掉该声明」）；已按重新声明修正（FR-ARK-203-010）。
- **A3（⬜ 待真机）**：`requestPermissionsFromUser` 在目标真机上的弹窗与回显、授权后 `readdir` 生效时延；本轮不测，验收记 `⬜`。
- **A4（约束）**：根清单 `declaredRoots()` 顺序即 UI 顺序；`PICKER_ROOT_IDS` 共享表含 `desktop` 名义项，但因宿主不声明而不显示。

## 8. 依赖

- **上游**：`pi-web` DirectoryPicker / directory-browser / browse route / host route（补丁 0002/0005/0006/0007）。
- **本工程**：`104-host-capabilities-arkts-impl`（`perm.*` 三能力）、`payload/env.js`（`PI_HOS_ROOTS` 契约）、`payload/extensions/harmony-workspace-roots.js`。
- **下游**：`docs/`（若补真机记录）、`patches/README.md`（补丁登记）。
