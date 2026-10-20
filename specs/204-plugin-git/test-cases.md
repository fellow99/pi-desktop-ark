# 204-plugin-git 测试用例（pi-desktop-ark）

> **Module:** 204-plugin-git ｜ **Last Updated:** 2026-10-20
> **对应规格:** [spec.md](./spec.md)（FR-ARK-204-xxx + 共享 FR-204-xxx）｜ **对应方案:** [plan.md](./plan.md)
> 主机/加载/构建用例与 `pi-desktop-hos/specs/204-plugin-git/test-cases.md` §1–§3 **共享**（对 ark 副本执行）；本文只列 ark 增量，并**记录两边共用用例的执行结果**。
> **脱敏声明**：仓库地址/账号/口令由需求方线下提供，不写入本文件、不进对话、不进日志。占位符 `<host>`、`<user>`、`<pass>`、`<repo>.git`。

## 1. ark 增量用例

| 编号 | 用例 | 步骤 | 预期 | 覆盖 |
|---|---|---|---|---|
| TC-A01 | 同步幂等 | 连续两次跑 `sync-git-extension.mjs` | 第二次「无变化全跳过」 | FR-ARK-204-002 |
| TC-A02 | V2 头注 | 抽查 ark 副本 js/cjs/md | 含 V2 差异注记 | FR-ARK-204-002 |
| TC-A03 | Node v24 加载 | Node v24 + jiti 2.7.0 加载 ark 副本 index.js | 捕获 22 注册 | FR-ARK-204-001 |
| TC-A04 | 仓库操作（v24） | init/add/commit/log/diff/本地 file 远端 clone/push | 成功 | FR-ARK-204-001 |
| TC-A05 | assemble 入 tar | dry/apply 核对 | 扩展+vendor 入 `pi-web.tar.gz` | FR-ARK-204-003 |
| TC-A06 | HAP 编译 | hvigor assembleHap | 编译通过 | AC-ARK-3 |

## 2. 真机回归

| 编号 | 用例 | 步骤 | 预期 | 覆盖 |
|---|---|---|---|---|
| TC-AD01 | 物化+加载 | 应用启动 | `<filesDir>/pi-agent/extensions/harmony-git/` 存在；21+1 工具可列 | AC-ARK-1 |
| TC-AD02 | 权限桥缺失降级 | 读授权状态 | 如实报「不可判定」，不猜 | FR-ARK-204-005 |
| TC-AD03 | 凭据文件路径 | git_credentials set | 落 `<filesDir>/pi-agent/.git-credentials`，0600 | FR-ARK-204-006 |
| TC-AD04 | 无账号全链 + 带账号链 | 与 hos TC-D02/D04 同 | 成功 | AC-ARK-4 |

## 3. 结果记录（2026-10-20，全模块一轮）

> 环境：Windows 开发机 / Node **v24.7.0**（与设备 v24.2.0 同主版本）；设备 `HAD-W32`（扩展物化项）。
> 端到端直接调用 ark 副本工具的 `execute()`（与运行时同一份代码），凭据仅在运行时经环境变量注入。

| 编号 | 结果 | 证据 | 备注 |
|---|---|---|---|
| TC-A01 同步幂等 | ✅ | `sync-git-extension.mjs` 二次执行输出「无变化全跳过」 | — |
| TC-A02 V2 头注 | ✅ | ark 副本 `lib/*.js` 头注含 V2 差异说明 | 抽查 3 个文件 |
| TC-A03 v24 加载 | ✅ | jiti 2.7.0 加载 ⇒ `TOOLS=22`（21 `git_*` + `git_credentials`） | 与共享 `TC-L01` 同口径 |
| TC-A04 仓库操作 | ✅ | 本地链 16 步通过（init/config/add/commit/log/status/diff/branch/checkout/tag/stash/add/commit） | 见共享 `TC-L02/TC-L03` |
| TC-A05 入 tar | ✅ | 归档内 `extensions/harmony-git/**` 与 `vendor/**` 齐备 | `assemble-payload --apply` 通过 |
| TC-A06 HAP 编译 | ✅ | `BUILD SUCCESSFUL`（HAP **131,167,056 B**，含调试通道代码、不含语例脚本） | — |
| 共享 `TC-H01…H09` | ✅ **设备侧 26 通过 / 0 失败** | 设备上的 `devtest/run.mjs --suite 204-unit`（跑的是物化后的 `pi-agent/extensions/harmony-git/tests/`，两种形态各一遍） | 口径：`node:test` 事件区分不出 skip，故只报总数；PC 侧同一批语例＝25 过 + 1 跳过＝26 |
| 共享 `TC-L01…L08` | ✅ **设备侧本地链 17 步全通** | 设备上 `devtest` 的 `204-e2e` 套件：init/config/add/commit/log/status/diff/branch/checkout/tag/stash/围栏拒绝 | 围栏越界路径**按设计被结构化拒绝**（`expectError` 计为通过） |
| 共享 `TC-D02`（无账号公开仓库） | ⚠️ **PC 侧通过；设备侧受网络限制** | PC：clone(depth=1)/status/log 全成功。设备：`Request timed out` —— 设备网络到 `github.com` 20 s 超时，而 `codeload.github.com` 200（探针实测） | 结论是**环境**而非代码；设备接入可路由该主机的网络后重跑同一套件即可 |
| 共享 `TC-D04`（带账号仓库） | ⚠️ **PC 侧通过；设备侧受网络限制** | PC：缺凭据结构化报错 → 设凭据后全链成功（含 push）。设备：`getaddrinfo ENOTFOUND <host>`（设备 DNS 不解析该内网域名，同主机 IP 也不可达） | 结论是**网络拓扑**；本轮**未**在设备上 push，故未新增远端测试分支 |
| 共享 `TC-D03` 凭据 | ✅ **设备侧通过** | 设备上 `credentials set` / `list`：只回显协议/host/用户名，口令恒 `********` | 测试后已删除设备上的凭据文件（`<filesDir>/pi-agent/.git-credentials`） |
| TC-AD01 物化 | ✅ | 设备 `<filesDir>/pi-agent/extensions/harmony-git/` 存在，含 `lib/tools` 23 文件与 `tests/` 5 个语例 | 工具清单本身需会话（模型驱动），见 TC-AD02…AD04 |
| TC-AD02…AD04 | ⬜ | — | 需模型驱动会话；PC 侧已用同代码覆盖等价路径 |

## 3.1 证据来源（2026-10-20 第 2 轮起）

2026-10-20 第 2 轮起，本模块的**普通与端到端用例一律在真机上执行**（设备上的 Node 进程，
两形态各一遍）；PC 侧只用于调执行器本身。通道、命令与原始输出见
[`../overall-test-cases.md`](../overall-test-cases.md) §3 与 [`../../logs/20261020-2/TEST_REPORT.md`](../../logs/20261020-2/TEST_REPORT.md)。
远端仓库用例的设备侧结论受**设备网络拓扑**限制（探针实测：`github.com` 超时、内网域名 DNS 不存在），
不记为代码缺陷。

## 4. 本轮发现并修复的缺陷

| # | 缺陷 | 影响 | 修法 | 状态 |
|---|---|---|---|---|
| D1 | `lib/fence.js#resolveWithinReal` 只 realpath 目标、用原始 root 字符串比较 | Windows 8.3 短名/大小写、root 自身是软链时，**正常读写被误判为软链逃逸** | root 也 realpath（`canonicalRoot`，失败退回原值） | ✅ 已修（`fs-adapter.test.mjs` 3/3 通过） |
| D2 | **20 个 `lib/tools/*.js`** 的 `catch` 引用 `try` 内声明的 `root` | 任何失败路径抛 `ReferenceError`，真实错误被覆盖 | `mapOsError(e, typeof root === 'undefined' ? undefined : root)` | ✅ 已修（20 处，错误文案恢复） |
| D3 | `lib/tools/stash.js` 的 `catch` 引用 `try` 内声明的 `hintSuffix` | `git_stash` 失败路径 `ReferenceError` | `hintSuffix` 提升到 `try` 前并预置 `''` | ✅ 已修 |

## 5. 远端副作用

- `TC-D04` 的推送在远端留下一个**唯一命名**测试分支（`pi-selftest-<时间戳>`）；删除尝试失败（开发机 `git` 经代理返回 502；`isomorphic-git.deleteRemoteRef` 未成功）⇒ **请人工按分支名删除**。
