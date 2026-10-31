# 011 — 版本更新：0.12.1（version）功能规格

> **Module:** version ｜ **Status:** Implemented ｜ **Last Updated:** 2026-10-31
> **上游基线:** `pi` v1.2.0（`06a466935536f8c9bcacb2d5efc0fc021be1bdff`）· `pi-web` v0.12.1（`f83b1a502f8e434555a7153fe08e1c135dd65ca9`）
> **本工程版本:** `versionName` **0.1.0** / `versionCode` **100**（`major*10000 + minor*100 + patch`）
> **发布 tag:** `v0.12.1`
> **运行时:** `@fellow99/node-bridge` **0.1.0** + `@fellow99/node-runtime` **24.2.0**（ohpm 中心仓）
> **规划依据:** [`../../docs/000-工程规划.md`](../../docs/000-工程规划.md) 头部版本表、§5.9/§5.10、§8；[`../../docs/001-能力复刻评估.md`](../../docs/001-能力复刻评估.md) REV-12
> **同型参考:** `pi-desktop` / `pi-desktop-hos` / `pi-desktop-android` 的 `011-version-0.12.1`（同一上游基线；本规格只记 ark 差异）

## 1. 模块概述

### 1.1 目的

把 HarmonyOS 纯血版的**上游载荷、运行时包与发布 tag** 收敛到 `v0.12.1` 基线，并明确版本号的双层语义：

- **上游版本** = `pi` v1.2.0 + `pi-web` v0.12.1（载荷内容）；
- **本工程应用版本** = `0.1.0` / `versionCode` 100（HarmonyOS 首发预发布）；
- **发布 tag** = `v0.12.1`（与上游载荷对齐，用于 Release / 归档）。

### 1.2 解决的问题

- 鸿蒙版消费两个 ohpm 包，运行时版本与上游载荷版本容易混为一谈。
- 6 条 `pi-web` 补丁必须按 `v0.12.1` 目录归档，且与 hos / android 同构。
- 应用版本 `0.1.0` 与 tag `v0.12.1` 并存，需要明确「tag ≠ versionName」。
- 版本升级必须同时更新 `app.json5`、`oh-package.json5`、runtime lock 与文档。

### 1.3 范围

**包含**

- 上游基线钉住：`pi` v1.2.0、`pi-web` v0.12.1、`patches/v0.12.1/` 六条。
- 运行时包版本：`@fellow99/node-bridge` 0.1.0、`@fellow99/node-runtime` 24.2.0。
- 应用版本：`versionName` 0.1.0、`versionCode` 100（严格递增规则）。
- 发布 tag `v0.12.1` 与 HAP 构建/签名/真机验证记录。
- 文档同步：README、`docs/000-工程规划.md`、`docs/001-能力复刻评估.md`、`docs/002`（如有）。

**不包含**

- 修改 `pi` / `pi-web` 上游源码；只允许幂等补丁。
- 把 `versionName` 提升到 0.12.1（需产品版本决策）。
- JIT 形态切换（编译期 `NODE_MODE='compat'`，见 108-jitless / BUILD_CONFIG）。
- 应用商店上架材料（107 合规模块）。

## 2. 用户故事

- 作为发布者，我能从 tag `v0.12.1` 复现出同一份 HAP，并追溯上游 commit。
- 作为维护者，我能从 `app.json5` / `oh-package.json5` / `patches/v0.12.1/` 一眼看出当前基线。
- 作为审核者，我能区分「应用 0.1.0」与「上游 0.12.1」，不会误判版本回退。
- 作为开发者，我升级运行时包时知道必须同时改 `oh-package.json5` 与文档。

## 3. 功能需求

### 3.1 上游与运行时

- **FR-011-001**（MUST）：`patches/v0.12.1/` 必须包含 6 条按该基线生成的幂等补丁（终端 unsupported / roots / hdc 别名 / 导出守卫 / 选择器契约 / 选择器权限流）。
- **FR-011-002**（MUST）：`oh-package.json5` 必须依赖 `@fellow99/node-bridge` 0.1.0 与 `@fellow99/node-runtime` 24.2.0；不得混用本地 HAR 旁路。
- **FR-011-003**（MUST）：`pi-web` 载荷必须来自 v0.12.1 生产构建；`pi` 依赖必须为 v1.2.0。
- **FR-011-004**（MUST）：补丁应用必须遵循「反向检查 → 正向检查 → 应用 → 反向 → SHA-256 还原断言」；冲突即终止。

### 3.2 版本号与发布

- **FR-011-005**（MUST）：`AppScope/app.json5` 的 `versionName` 必须为 `0.1.0`、`versionCode` 必须为 `100`；本次基线收敛不得改动二者。
- **FR-011-006**（MUST）：`versionCode` 必须单调递增；后续发布不得回退或复用。
- **FR-011-007**（MUST）：发布 tag 必须为 `v0.12.1`；**MUST NOT** 把 tag 注入 `versionName` / `versionCode`。
- **FR-011-008**（MUST）：HAP 构建必须能签名并真机安装；签名材料不得入库。

### 3.3 文档与证据

- **FR-011-009**（MUST）：README / `docs/000-工程规划.md` / `docs/001-能力复刻评估.md` 的上游基线必须一致为 pi v1.2.0 + pi-web v0.12.1。
- **FR-011-010**（MUST）：历史版本结论（旧能力清单、旧真机轮次）必须保留，不得回改。
- **FR-011-011**（MUST）：发布记录必须给出 HAP 构建结果、签名状态、真机验证设备与时间。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|---|---|---|
| 上游基线 | 载荷来源 | `pi` tag / SHA、`pi-web` tag / SHA |
| 运行时包 | ohpm 依赖 | `node-bridge` 0.1.0、`node-runtime` 24.2.0 |
| 应用版本 | HAP 版本 | `versionName` 0.1.0、`versionCode` 100 |
| 补丁集 | 对 pi-web 的可逆修改 | `patches/v0.12.1/` 六条 |
| 发布 tag | Release 标识 | `v0.12.1`、HAP、真机证据 |

## 5. 验收场景

### 场景：基线一致性

- Given 工程在 `main` 分支
- When 检查 `patches/v0.12.1/`、`oh-package.json5`、`app.json5`
- Then 六条补丁在位、两个 ohpm 包版本正确、应用版本 0.1.0/100

### 场景：补丁可逆

- Given pristine `pi-web` v0.12.1
- When 依次应用六条补丁、再反向还原
- Then 逐文件 SHA-256 与原始树一致

### 场景：发布

- Given 推送 tag `v0.12.1`
- When 完成 HAP 构建与真机安装
- Then 应用启动到首屏、一次对话完成、tag 与上游基线对应

## 6. 非功能需求

- **可复现**：同一 tag + 同一 ohpm 版本产出等价 HAP（签名材料除外）。
- **可追溯**：HAP 内保留构建信息；文档记录真机设备与时间。
- **安全**：签名材料与 API Key 不入库。
- **兼容**：运行时 Node 24.2.0 满足上游 `engines.node >= 22.19.0`。

## 7. 假设与约束

- 上游 `pi v1.2.0` / `pi-web v0.12.1` 的 tag 与 SHA 与其它三版一致。
- `@fellow99/node-bridge` / `node-runtime` 已上架 ohpm 中心仓。
- 应用版本 0.1.0 是首发预发布，不随上游 0.12.1 改名。

## 8. 依赖

- 上游：`pi` v1.2.0、`pi-web` v0.12.1。
- 运行时：`@fellow99/node-bridge` 0.1.0、`@fellow99/node-runtime` 24.2.0。
- 模块：`102-payload-pipeline-assembly-crop`（载荷）、`108-jitless`（形态）、`204-plugin-git`（Git 扩展）。
- 父工程：`../../specs/011-version-0.12.1/`。
