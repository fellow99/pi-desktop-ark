# 插件·GIT 操作（204-plugin-git）—— 规格（pi-desktop-ark）

> **Module:** 204-plugin-git ｜ **Status:** Proposed ｜ **Last Updated:** 2026-10-18
> **工程:** pi-desktop-ark（Pi Desktop V2；ArkTS 宿主 + `@fellow99/node-bridge` 进程内 **Node v24** + ArkWeb；**无 Electron/Chromium**）
> **需求编号:** 204-plugin-git ｜ **需求名称:** 插件：GIT 操作 ｜ **git 分支:** 不改动（main）
> **单一事实源:** `pi-desktop-hos/specs/204-plugin-git/`（**功能需求与其共享，本文只记 ark 差异**）
> **设计文档:** [`../../docs/204-插件-GIT.md`](../../docs/204-插件-GIT.md)
> **约束:** `../102-payload-pipeline-assembly-crop/`、`../106-tools-extensions-same-name-overrides/`、`../constitution.md`

## 1. 模块概述

鸿蒙环境**没有 `git`**，版本控制全部不可用。本模块把 `pi-desktop-hos` 的 **`harmony-git` 扩展**（纯 JS isomorphic-git 1.44.2，21 个 `git_*` 工具 + `git_credentials`，设备自管凭据文件）**原样搬进本工程** `payload/extensions/harmony-git/`，经既有 payload 装配/物化链上设备。**父工程 0 改动**，规格仅落子工程。

**与 hos 的关系**：git 领域逻辑与扩展代码**两工程共享**（hos 为单一事实源），ark 经 `scripts/sync-git-extension.mjs` 幂等拷贝 + V2 头注。功能需求（工具面、凭据规则、围栏、自建缺口、错误处理）与 `pi-desktop-hos/specs/204-plugin-git/spec.md` §3 **完全一致**，不重复列出。

**范围外**：`rebase`/`blame`/`grep`/SSH/SHA-256；运行时 npm install；子进程；父工程改动；git 分支改动。

## 2. ark 侧差异（相对 hos，本规格的增量需求）

| 关注点 | hos | **ark（本工程）** | 增量需求 |
|---|---|---|---|
| 运行时 Node | 22.17.0 | **v24.2.0**（node-bridge） | **FR-ARK-204-001** 同一 bundle（`node:*` external，esbuild `--platform=node`）**必须**在 Node v24 下可加载可运行（本机 v24 已实测） |
| 扩展落点 | `extensions/harmony-git/` | **`payload/extensions/harmony-git/`** | **FR-ARK-204-002** 经 `scripts/sync-git-extension.mjs` 从 hos 幂等拷贝 + V2 头注 |
| 装配 | `collect-pi.mjs` | `scripts/assemble-payload.mjs`（`APP_PAYLOAD_ENTRIES` 含 `extensions`）→ `pi-web.tar.gz` | **FR-ARK-204-003** 扩展+vendor **必须**随 `extensions/` 树入 tar 到 `entry/.../resfile/pi-web/`；**必须不**改 assemble 脚本 |
| 运行期物化 | `main.js#materializeBundledResources` | `pi-web-launch.js#materializeAgentResources`（原子 tmp+rename）→ `<filesDir>/pi-agent/extensions/` | **FR-ARK-204-004** 目录扩展整树（含 `vendor/*.cjs`）**必须**被递归 copy 到 `<filesDir>/pi-agent/extensions/harmony-git/`；pi 发现其 `index.js` 并 jiti 加载 |
| 权限桥 | `__PI_HOS_PERMISSION__` 可用 | **Phase 1 桥未接线** | **FR-ARK-204-005** 读不到权限/授权状态时**必须**如实报「不可判定」，**必须不**猜测（对齐现有 ark 扩展 C2） |
| 凭据文件 | `<userData>/pi-agent/.git-credentials` | `<filesDir>/pi-agent/.git-credentials`（同为 `$PI_CODING_AGENT_DIR`） | **FR-ARK-204-006** 路径取 `PI_CODING_AGENT_DIR`（`payload/env.js` 设），格式/0600/匹配/原子写与 hos 一致 |

## 3. 共享功能需求（引用 hos）

以下与 `pi-desktop-hos/specs/204-plugin-git/spec.md` §3 完全等同，编号沿用 FR-204-xxx：
- 扩展形态与注册（FR-204-001…005）；
- 依赖 bundle（FR-204-006…008）；
- 文件访问与围栏（FR-204-009…013）；
- 凭据（FR-204-014…019）；
- 工具面 21+1（FR-204-020…027）；
- 父工程 0 改动（FR-204-030）。

## 4. 非功能需求

- 离线（bundle 构建期供给，设备零网络安装）；安全（凭据明文不进对话/details/日志，0600，chroot 防逃逸）；体积 ≈ 888 KB；如实性（宪法 A6：失败如实归因）。

## 5. 验收标准

- **AC-ARK-1**：扩展经 payload 装配/物化到 `<filesDir>/pi-agent/extensions/harmony-git/`，pi 加载，21+1 工具可列。
- **AC-ARK-2**：主机（Node v24 + jiti）对 ark 副本跑 init/add/commit/log/diff/本地 file 远端 clone/push 冒烟通过。
- **AC-ARK-3**：`assemble-payload.mjs` dry/apply 确认扩展+vendor 入 tar；**hvigor HAP 编译通过**。
- **AC-ARK-4**：无账号全链、凭据 0600/脱敏、rebase 不支持、revert 分叉 fail-closed（与 hos AC 一致，真机回归）。

## 6. 假设与依赖

- **A1** hos 扩展代码在 ark 的 Node v24 + jiti 2.7.0 可运行（`node:*` external，v24 已实测）。
- **A2** `assemble-payload.mjs`（`APP_PAYLOAD_ENTRIES` 含 `extensions`）与 `pi-web-launch.js#materializeAgentResources` 递归 copy 目录扩展 —— 已由现有 4 扩展实证（root .js 层），目录层为本次新增、需在冒烟中确认。
