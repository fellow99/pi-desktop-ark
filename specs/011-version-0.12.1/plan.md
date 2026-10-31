# 011 — 版本更新：0.12.1（version）技术方案（As-Built）

> **Module:** 011-version-0.12.1 ｜ **Status:** Implemented ｜ **Last Updated:** 2026-10-31
> **对应规格:** [`spec.md`](./spec.md)（FR-011-001 … FR-011-011）
> **规划依据:** [`../../docs/000-工程规划.md`](../../docs/000-工程规划.md) §5.9/§5.10、§8；[`../../docs/001-能力复刻评估.md`](../../docs/001-能力复刻评估.md) REV-12
> **证据:** `patches/v0.12.1/`、`oh-package.json5`、`AppScope/app.json5`、`README.md`、`docs/001-能力复刻评估.md`

## 1. 技术上下文

### 1.1 运行环境

- 宿主：ArkTS（UIAbility + ArkWeb），API 17 兼容 / API 24 目标。
- 运行时：`@fellow99/node-bridge` 0.1.0（ArkTS API + NAPI 引导）+ `@fellow99/node-runtime` 24.2.0（libnode.so + libc++_shared.so）。
- 载荷：`pi-web` v0.12.1 生产构建 + 6 条补丁 + `payload/` 资源。
- 构建：DevEco / hvigor；`scripts/assemble-payload.mjs`、`scripts/brand-assets.mjs`、`scripts/sync-git-extension.mjs`。

### 1.2 关键依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `@fellow99/node-bridge` | 0.1.0 | 进程内 Node 桥 |
| `@fellow99/node-runtime` | 24.2.0 | Node 引擎（libnode.so） |
| `pi-web` | v0.12.1 | 前端 + API + agent |
| `pi` | v1.2.0 | agent harness |
| 应用版本 | 0.1.0 / 100 | HAP 版本 |

## 2. 宪法合规检查

| 原则 | 合规 | 说明 |
|---|---|---|
| A1 一切经 HTTP | ✅ | 版本收敛不改数据面 |
| A2 壳薄契约硬 | ✅ | 版本号只在配置与文档 |
| A3 结论以库为准 | ✅ | 运行时事实引用库文档 §6 |
| A4 不改上游 | ✅ | 仅 `patches/v0.12.1/` 六条 |
| A5 失败可见 | ✅ | 补丁/构建/安装失败均显式报错 |
| A9 异常兜底 | ✅ | 版本升级不引入新异常路径 |

## 3. 研究结论

- **D1 应用版本与上游版本分离**：`versionName` 0.1.0 是产品版本；tag `v0.12.1` 与上游载荷对齐。
  `versionCode = major*10000 + minor*100 + patch`，0.1.0 → 100。
- **D2 运行时包走中心仓**：`@fellow99/node-bridge` 0.1.0 + `@fellow99/node-runtime` 24.2.0，
  不再使用本地 HAR 旁路；hvigor 合并 libnode.so。
- **D3 补丁按 tag 归档**：`patches/v0.12.1/` 六条，与 android 同构；每条可逆、幂等。
- **D4 构建期形态固定**：`NODE_MODE='compat'`（`--jitless`），版本升级不改变形态开关。

## 4. 数据模型

| 实体 | 字段 | 来源 |
|---|---|---|
| `AppScope/app.json5` | `versionName`、`versionCode`、`bundleName` | 仓库根 |
| `oh-package.json5` | `@fellow99/node-bridge`、`@fellow99/node-runtime` | 仓库根 |
| `patches/v0.12.1/` | 六条 `.patch` | 仓库根 |
| `payload/` | `extensions/`、`config/`、`jitless/`、`skills/` | 仓库根 |

## 5. 接口契约

### 5.1 提供的接口

- `scripts/assemble-payload.mjs`：组装载荷（含品牌化、裁剪、tar）。
- `scripts/brand-assets.mjs`：图标/文案品牌化（见 013）。
- `scripts/sync-git-extension.mjs`：从 hos 同步 Git 扩展。

### 5.2 消费的接口

- ohpm 中心仓：`@fellow99/node-bridge` 0.1.0、`@fellow99/node-runtime` 24.2.0。
- 上游：`pi-web` v0.12.1、`pi` v1.2.0。
- 父工程：`assets/`（品牌物料）。

## 6. 实现策略

### 6.1 版本收敛步骤

1. 核对上游 tag / SHA。
2. 更新 `patches/v0.12.1/` 六条补丁并验证可逆。
3. 更新 `oh-package.json5` 运行时包版本（如升级）。
4. 更新 `app.json5` 版本号（本次不变：0.1.0/100）。
5. 跑 `assemble-payload.mjs` → hvigor 构建 → 签名 → 真机安装。
6. 打 tag `v0.12.1`，记录真机证据。
7. 回写 README / 规划 / 能力评估。

### 6.2 错误处理

- 补丁冲突：终止，不 `--3way`。
- 运行时包缺失：`ohpm install` 失败即停。
- 构建/签名失败：显式报错，不产出 HAP。
- 真机失败：记录 stage/message/日志，不静默降级。

## 7. 测试考量

- 补丁可逆：应用/反向/SHA-256 还原。
- 载荷：`assemble-payload.mjs` dry/apply；tar 内容与裁剪规则。
- 构建：hvigor HAP 编译通过、签名可安装。
- 真机：启动到首屏、会话、对话、工具、Git 扩展（204）。

## 8. 文件清单

| 文件 | 作用 |
|---|---|
| `AppScope/app.json5` | 应用版本 / 包名 |
| `oh-package.json5` | 运行时包依赖 |
| `patches/v0.12.1/*.patch` | 六条补丁 |
| `scripts/assemble-payload.mjs` | 载荷组装 |
| `scripts/brand-assets.mjs` | 品牌化 |
| `docs/000-工程规划.md` | 规划与版本决策 |
| `docs/001-能力复刻评估.md` | 版本/能力证据 |

## 9. 与规格交叉引用

| FR | 落点 |
|---|---|
| FR-011-001/004 | `patches/v0.12.1/` + 组装脚本 |
| FR-011-002/003 | `oh-package.json5` + 载荷 |
| FR-011-005/006/007 | `AppScope/app.json5` + Release |
| FR-011-008 | hvigor 签名 + 真机 |
| FR-011-009/010/011 | README / docs / 证据 |
