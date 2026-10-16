# SPECS_CHECKLIST.md —— 规格文档完成度追踪

> 工程：`pi-desktop-ark` · 应用名：**Pi Desktop V2** · 包名：`org.fellow99.pi.PiDesktopArk` · 需求：**000-scaffold 工程搭建**
> 规范文档存放目录：`specs/` · 生成日期：**2026-10-16**
> 权威规划文档：[`../docs/000-工程规划.md`](../docs/000-工程规划.md)（v0.1，**结论以它为准**）；运行时契约见库文档 [`../../ohos-node-bridge/docs/000-工程规划.md`](../../ohos-node-bridge/docs/000-工程规划.md) **§6**
>
> 状态口径：✅ 已完成 · ⚠️ 已完成但含未闭合项（见备注）· ⬜ 待生成

---

## 一、项目级文档

| # | 文档 | 路径 | 状态 | 说明 |
|---|---|---|---|---|
| P-01 | 项目宪法 | [constitution.md](./constitution.md) | ✅ | 10 条不可协商原则（A1 一切经 HTTP · A2 壳薄契约硬 · A3 运行时结论以库为准 · A4 不改上游 · A5 失败可见 · A6 不隐藏平台真相 · A7 判据可证伪 · A8 单实例与随机端口 ⑰ · A9 异常兜底 ⑱ · A10 声明面 ≠ 授权面）+ 代码规约（T 系列）+ 证据纪律 + 合规红线 + 评审清单 + 变更流程 |
| P-02 | 整体架构 | [ARCHITECTURE.md](./ARCHITECTURE.md) | ✅ | 分层与数据流、启动时序、状态机、ArkTS 侧必须重实现的 16 项能力 × 现状、鉴权两路线的架构位置、载荷两条路线与可写缓存外置、关键架构决策、与库的责任分界、合规架构位置 |
| P-03 | 技术选型 | [TECH.md](./TECH.md) | ✅ | 选型表（版本/用途/理由）+ **明确否掉的选项** + 工具链基线 + 兼容矩阵 + 选型带来的硬性代码约束 + 待定稿选型（Phase 1–2）+ 被推翻时的替换路径 + 证据锚点 |
| P-04 | 目录结构 | [STRUCTURE.md](./STRUCTURE.md) | ✅ | as-built 目录树 + 逐文件用途 + 关键配置 + 路由/页面清单 + `rawfile` vs `resfile` 规则 + 不入库清单 + 模块编号 ↔ 目录落点 + 新增文件落点纪律 |
| P-05 | 整体规格 | [overall-spec.md](./overall-spec.md) | ✅ | 技术无关的能力需求（`FR-ARK-*`，RFC 2119）、非功能需求（`NFR-ARK-*`）、系统边界、可证伪验收判据 |
| P-06 | 整体技术方案 | [overall-plan.md](./overall-plan.md) | ✅ | 技术上下文、宪法合规检查、分阶段实现策略、跨切面关注点、测试策略、构建与装机流水线、风险/开放问题处置、变更与评审流程 |
| P-07 | 数据模型 | [overall-data-model.md](./overall-data-model.md) | ✅ | ArkTS 常量与壳侧状态、库侧消费面类型、状态机迁移表、环境变量契约表、文件系统实体与凭据落点、权限数据模型（声明面/授权面）、载荷体积模型、HTTP 数据面模型 |
| P-08 | 测试用例索引 | [overall-test-cases.md](./overall-test-cases.md) | ✅ | L0–L4 五层测试 + `TC-ARK-*` 与 `TC-101-*`…`TC-107-*` 用例族 + 四条真机取证通道 + **禁止的判据** + 已有基线数值 + 待验证清单 + 用例编写规则 |
| P-09 | 规格检查清单 | SPECS_CHECKLIST.md | ✅ | 本文件 |
| P-10 | 规格索引 | [README.md](./README.md) | ✅ | 项目/文档总览 + 全量文件索引 + 模块编号一览 + 文档结构规范 + 快速导航 + 快照命令 |
| — | `API.md` / `overall-api.md` | — | ⛔ 刻意不生成 | 前端与数据面（`/`、`/api/*`、SSE）属**上游 `pi-web` 服务**（由本工程进程内的 Node 承载），**本工程不自有 API**：界面契约是 ArkTS 内部接口（`PiDesktopRuntime` 等），对外能力面是**库冻结的 `HostBridge` 八个能力名** —— 落点见 [`overall-data-model.md`](./overall-data-model.md) §1.3（库 API 形态）与 [`104-host-capabilities-arkts-impl/spec.md`](./104-host-capabilities-arkts-impl/spec.md) §1.1 / [`plan.md`](./104-host-capabilities-arkts-impl/plan.md)。`overall-test-cases.md` 是**用户明确要求**的交付物，已生成（P-08）。 |

---

## 二、模块级文档（编号依规划 §14.2）

| # | 模块 | 目录 | 分类 | spec.md | plan.md | 状态 | 备注（`plan.md` §9 的主要 ⬜ 项） |
|---|---|---|---|---|---|---|---|
| M-01 | 运行时接入 · 启动编排 | [`101-runtime-integration-launch-orchestration/`](./101-runtime-integration-launch-orchestration/) | 运行时与载荷 | ✅ | ✅ | ⚠️ | 端口随机/先探测空闲 + `payload/port` 回传、`launchType: "singleton"`、探活端点收口、日志读回（`logs()`/`lastCrash()`）、失败态完整化属 Phase 1；优雅关停（`shutdown()`）属 Phase 2（§9 共 12 项） |
| M-02 | 载荷流水线 · 组装与裁剪 | [`102-payload-pipeline-assembly-crop/`](./102-payload-pipeline-assembly-crop/) | 运行时与载荷 | ✅ | ✅ | ⚠️ | `pi-dist` 组装 + 四项裁剪逐项离线验证、`resfile` 只读直读投放（P0-13）、自解包归档路线（备选）、进程内托管与端口回传、体积实测回写属 Phase 1；载荷内关停钩子属 Phase 2（§9 共 13 项） |
| M-03 | 渲染壳 · ArkWeb 与页面 | [`103-arkweb-shell-render-and-pages/`](./103-arkweb-shell-render-and-pages/) | 渲染与能力 | ✅ | ✅ | ⚠️ | `clearHistory()` + 返回键守卫、导航围栏（`onLoadIntercept`/`isMainFrame()`）、新窗口拦截、宿主侧错误视图与诊断面板、渲染能力与长连接/进程模型取证属 Phase 1；外链围栏分流联调属 Phase 2（§9 共 13 项） |
| M-04 | 宿主能力 · ArkTS 实现 | [`104-host-capabilities-arkts-impl/`](./104-host-capabilities-arkts-impl/) | 渲染与能力 | ✅ | ✅ | ⚠️ | ⬜ **本模块 0 行实现**：注册器 + `runtime.facts`、`perm.*`、`fs.pick*`、`shell.openExternal`、`log.hilog`、`notify.show`、主目录清单、窗口尺寸记忆属 Phase 2；**阻塞项** = 库放开 handler 异步签名（§9 共 13 项，第 13 项已澄清收口） |
| M-05 | 鉴权 · loopback 与 Cookie | [`105-auth-loopback-and-cookie/`](./105-auth-loopback-and-cookie/) | 鉴权、扩展与合规 | ✅ | ✅ | ⚠️ | ⬜ **整体未落地**：路线 ① 定稿、环境装配鉴权分支三项复核、就绪探针切恒定放行端点、凭据派生 + `session.json` 原子写、壳侧注入时序、凭据卫生检索属 Phase 1；路线 ② 全链路属 Phase 2（§9 共 9 项） |
| M-06 | 工具扩展 · 同名顶替 | [`106-tools-extensions-same-name-overrides/`](./106-tools-extensions-same-name-overrides/) | 鉴权、扩展与合规 | ✅ | ✅ | ⚠️ | ⬜ **设备侧 0 行落地**：四扩展物化 + §4.1 两处正文适配 + 模板投放（仅缺失时写）+ 离线旗标 + 搜索/查找真机验证属 Phase 1；主目录供数联调与 `spawn` 复测属 Phase 2（§9 共 9 项） |
| M-07 | 合规 · 上架前置清单 | [`107-compliance-listing-checklist/`](./107-compliance-listing-checklist/) | 鉴权、扩展与合规 | ✅ | ✅ | ⚠️ | G1/G3–G11 逐条落实与取证、证据归档与材料正文属 Phase 3；`G2`（无浏览器语义）**现状 ✅ 成立**，本模块只做防回归核对（§9 共 13 项） |

**每个模块目录下必须成对提供 `spec.md`（需求与验收）与 `plan.md`（设计与实现方案）**；复杂模块可再追加 `tasks.md` / `test-cases.md`（当前 7 个模块的用例族统一由 [`overall-test-cases.md`](./overall-test-cases.md) §2 覆盖，未单独立文件）。7 个模块均**含未闭合项**（Phase 0 只有启动/渲染骨架与构建链），故状态一致记 ⚠️。

---

## 三、生成顺序与依据

1. **先整体、后模块**：项目级文档（P-01…P-08）先建立术语、责任分界、模块编号（规划 §14.2）与证据口径，模块文档再细化 —— 避免前后引用不存在的文件。
2. **最后生成索引**：`README.md` 与 `SPECS_CHECKLIST.md` 在全部文档完成后按**实际目录内容**扫描生成（`ls` + `wc -l`），不预测结构、不写未生成的文件名。
3. **不复制粘贴**：所有结论回引 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) 的 § 号、库文档 § 号或冻结契约（[`../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md`](../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md)）；新增平台结论必须先落规划文档，再回到 `specs/` 引用（宪法 A3）。
4. **证据标记**：每条非显然结论带 ✅ 实测 / 🔶 沿用 / ⬜ 待验证 / ⚠️ 冲突·风险 之一（口径见 [`constitution.md`](./constitution.md) §三）。

---

## 四、质量检查

| 检查项 | 结果 |
|---|---|
| 每条结论可回溯到规划 § 号、库文档 § 号、冻结契约或真实代码 | ✅ |
| 无占位内容（`TODO` / `TBD` / 「待补充」） | ✅ |
| `spec.md` 不含实现细节（框架名、文件路径、组件名） | ✅（各模块头部显式声明术语抽象与 `plan.md` 落点） |
| `plan.md` 引用真实文件路径与真实行数 | ✅（7/7 均有 §8「文件清单（真实行数：`wc -l`）」） |
| `plan.md` 交叉引用本模块 `spec.md` 的 `FR-1NN-*` | ✅（`FR-101-001..020` / `102-001..022` / `103-001..018` / `104-001..030` / `105-001..018` / `106-001..024` / `107-001..030`） |
| 每个模块都同时有 `spec.md` 与 `plan.md` | ✅（7/7） |
| 模块数与 `NNN-*/` 实际目录数一致 | ✅（7/7，规划 §14.2 的 `101`–`107`） |
| 模块边界在 `spec.md` 与 `plan.md` 之间一致 | ✅ |
| `README.md` 链接全部指向存在的文件 | ✅（相对链接逐条 `[ -e ]` 校验，0 断链） |
| as-built 与 planned 已逐条区分（`⬜ 规划未实现（Phase N）`） | ✅ |
| 用例族覆盖每个模块（`TC-1NN-*`）与横切面（`TC-ARK-*`） | ✅（8 个族，见 `overall-test-cases.md` §2） |
| 未闭合项只记**实现**工作，不混入「文档缺失」 | ✅（见 §五） |

---

## 五、未闭合项（不属文档缺失，属**实现/取证**阶段工作）

| 项 | 归属 | 依据 |
|---|---|---|
| `pi-dist` 载荷组装 + 四项裁剪（`.nft.json` / win32 SWC / `@img` / `node-pty`）落地与真机实测 | Phase 1 | 规划 §7.2、§12 R5/A2；`102/plan.md` §9 第 1–3 项 |
| `resfile` 只读直读路线验证（P0-13 / A1）与 `resfile` 读权限边界（A6） | Phase 1 | 规划 §12.1 A1、§12.2 A6；`TC-102-001/010` |
| `.next/**/*.nft.json`（348 MB）可删性（O1） | Phase 1 | 规划 §12.2 O1；`TC-102-002` |
| 删 `@next/swc-win32-*`（106 MB）后是否仍走 WASM SWC / 是否触发联网补下载（O2） | Phase 1 | 规划 §12.2 O2；`TC-102-003` |
| ArkWeb 访问 `127.0.0.1` 与 Cookie 注入 API 可用性（P0-3 / R3） | Phase 1（最高优先级） | 规划 §12.1 R3、§11 Phase 1 第 4 条；`TC-103-002` |
| SSE 长连接与前后台/息屏行为（A5） | Phase 1 | 规划 §12.2 A5、§11 Phase 1 第 3 条；`TC-103-008` |
| 渲染进程模型取证（O9）：`aa dump` + 系统日志 | Phase 1 | 规划 §12.2 O9；`TC-103-010` |
| 宿主能力桥传输层（库侧 handler 异步签名 / 线程安全回投） | Phase 2 | 冻结契约 §2.7 vs 库规划 §5.4；`104/plan.md` §9 第 1 项 |
| 签名 HAP 体积与首启耗时最终实测（O6） | Phase 1 | 规划 §12.2 O6；`overall-data-model.md` §6.4 |
| 四个同名扩展真机装载 + 两处正文适配（设备侧当前 0 行） | Phase 1 | 规划 §8.3；`106/plan.md` §9 第 1–4 项 |
| 鉴权路线最终选型（① 定稿；② 仅在 ① 被证伪时启动） | ① Phase 1 / ② Phase 2 | 规划 §6.2、§12.1 R3；`105/plan.md` §9 第 1–7 项 |
| 合规 G4（第三方许可清单）与 G6–G8 / G10 / G11 的取证与材料 | Phase 3 | 规划 §13；`107/plan.md` §9 第 4/6–11 项 |
| G9 PoC 资产清理（样例 Ability、`--inspect`、诊断开关、`selfcheck` 调试端点） | Phase 3 | 规划 §13 G9；`107/plan.md` §9 第 9 项 |
| `pi-web` 上游补丁（预计 0–2 条：`P-ark-1` 优先不补 / `P-ark-2` 沿用旧壳已验证补丁） | Phase 1–2 | 规划 §9 |
| 目录选择器最优形态定稿（O8）与 MCP stdio 真机复测（O5） | Phase 2 | 规划 §12.2 O5/O8；`TC-104-003`、`TC-106-001` |
| 优雅关停联调（库 `shutdown()` 到位后）与单实例 `launchType` 声明 | Phase 1–2 | 规划 §5 第 13/16 条；`101/plan.md` §9 第 2/3 项 |
| HAP 内 `.so` 与 `rawfile/resfile` 压缩方式实测为 `0（STORED）`，与规划附录 A 的 `8（DEFLATE）` 口径不符 ⇒ 修复或改口径 | Phase 1 / 3 | 规划 附录 A；`overall-data-model.md` §6.2、`TC-ARK-007` |
| 回归四件套基线（产物 SHA-256 / 首启耗时 / 包体与压缩方式 / `/facts` 四字段） | Phase 4 | 规划 §11 Phase 4；`TC-ARK-014` |
