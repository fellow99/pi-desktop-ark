# 204-plugin-git 任务清单（pi-desktop-ark）

> **Module:** 204-plugin-git ｜ **Last Updated:** 2026-10-18
> **对应规格:** [spec.md](./spec.md) ｜ **对应方案:** [plan.md](./plan.md)

| ID | 任务 | 落点 | 依赖 | 回引 | 状态 |
|---|---|---|---|---|---|
| A-T01 | 设计文档 | `docs/204-插件-GIT.md` | — | — | ✅（c18c415） |
| A-T02 | 功能规格 | `specs/204-plugin-git/spec.md` | — | FR-ARK-204-xxx | ✅（575e29b） |
| A-T03 | 技术方案 | `plan.md` | — | — | ✅（575e29b） |
| A-T04 | 任务清单 | 本文件 | — | — | ✅ |
| A-T05 | 测试用例 | `test-cases.md` | — | — | ✅（575e29b） |
| A-T10 | 同步脚本 | `scripts/sync-git-extension.mjs` | hos 扩展完成 | FR-ARK-204-002 | ✅（00b8429，--check 幂等） |
| A-T11 | 拷贝扩展 + V2 头注 | `payload/extensions/harmony-git/` | A-T10 | FR-ARK-204-002 | ✅（synced-from hos@760c12d，bundle sha256 一致） |
| A-T12 | Node v24 + jiti 加载冒烟（22 注册 + 仓库操作） | scratch 脚本 | A-T11 | AC-ARK-2 | ✅（22 工具注册 + 本地操作全绿） |
| A-T13 | assemble dry/apply 核对入 tar | `assemble-payload.mjs` | A-T11 | FR-ARK-204-003 | ✅（stub pi-dist 组装通过，tar 内 44 条目含 22 工具+vendor） |
| A-T14 | hvigor HAP 编译 | — | A-T12 | AC-ARK-3 | ✅（BUILD SUCCESSFUL，未签名 HAP） |
| A-T15 | 真机回归（无真机，留待） | test-cases 真机段 | — | AC-ARK-1/4 | ⬜ 待真机 |
