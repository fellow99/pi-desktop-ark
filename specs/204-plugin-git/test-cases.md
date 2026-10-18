# 204-plugin-git 测试用例（pi-desktop-ark）

> **Module:** 204-plugin-git ｜ **Last Updated:** 2026-10-18
> **对应规格:** [spec.md](./spec.md)（FR-ARK-204-xxx + 共享 FR-204-xxx）
> 主机/加载/构建用例与 `pi-desktop-hos/specs/204-plugin-git/test-cases.md` §1–§3 **共享**（对 ark 副本执行）；本文只列 ark 增量。

## 1. ark 增量用例

| 编号 | 用例 | 步骤 | 预期 | 覆盖 |
|---|---|---|---|---|
| TC-A01 | 同步幂等 | 连续两次跑 `sync-git-extension.mjs` | 第二次「无变化全跳过」 | FR-ARK-204-002 |
| TC-A02 | V2 头注 | 抽查 ark 副本 js/cjs/md | 含 V2 差异注记 | FR-ARK-204-002 |
| TC-A03 | Node v24 加载 | Node v24 + jiti 2.7.0 加载 ark 副本 index.js | 捕获 22 注册 | FR-ARK-204-001 |
| TC-A04 | 仓库操作（v24） | init/add/commit/log/diff/本地 file 远端 clone/push | 成功 | FR-ARK-204-001 |
| TC-A05 | assemble 入 tar | dry/apply 核对 | 扩展+vendor 入 `pi-web.tar.gz` | FR-ARK-204-003 |
| TC-A06 | HAP 编译 | hvigor assembleHap | 编译通过 | AC-ARK-3 |

## 2. 真机回归（无真机，留待）

| 编号 | 用例 | 步骤 | 预期 | 覆盖 |
|---|---|---|---|---|
| TC-AD01 | 物化+加载 | 应用启动 | `<filesDir>/pi-agent/extensions/harmony-git/` 存在；21+1 工具可列 | AC-ARK-1 |
| TC-AD02 | 权限桥缺失降级 | 读授权状态 | 如实报「不可判定」，不猜 | FR-ARK-204-005 |
| TC-AD03 | 凭据文件路径 | git_credentials set | 落 `<filesDir>/pi-agent/.git-credentials`，0600 | FR-ARK-204-006 |
| TC-AD04 | 无账号全链 + 带账号链 | 与 hos TC-D02/D04 同 | 成功 | AC-ARK-4 |

## 3. 结果记录

| 编号 | 结果 | 证据 | 备注 |
|---|---|---|---|
| （实施时填） | | | |
