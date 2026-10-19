# 规格文档索引 —— `pi-desktop-ark`

**项目名称：** `pi-desktop-ark` · **定位名：** **HarmonyOS Edition**（HarmonyOS 版；对应 `pi-desktop-hos` = Electron on HarmonyOS Edition）
**应用名 / 包名：** **Pi Desktop Ark** / `org.fellow99.pi.PiDesktopArk`
**需求：** **000-scaffold 工程搭建** · **规范文档存放目录：** `specs/`
**版本：** `v0.1`（规划 2026-10-16；Phase 0 骨架 + 关键实证已完成，Phase 1 进行中）
**目标设备：** `2in1` / `tablet`（真机 HAD-W24 · 7.0.0.107(SP7C00E100R13P5) · OpenHarmony-7.0.0.105 · API 26 · arm64-v8a）；**不做 phone、不做 x86_64**
**技术栈：** ArkTS 宿主（UIAbility + **ArkWeb**）+ `@fellow99/node-bridge`（进程内 `dlopen` + `node::Start`，Node v24.2.0，见[库文档](../../ohos-node-bridge/docs/000-工程规划.md)）+ 端上 `pi-web` 服务端（同源 HTTP + SSE）+ 同名工具扩展（纯 JS）；**不带任何 Chromium/Electron**
**文档生成时间：** 2026-10-16 · **最后更新：** 2026-10-16

> **权威规划文档是 [`../docs/000-工程规划.md`](../docs/000-工程规划.md)（v0.1）。**
> 本目录是它的**收敛/展开版**：只做细化与验收，**不复制粘贴**，所有结论回引规划的 § 号，避免两份文档漂移。
> **运行时的一切结论以库文档为准** —— [`../../ohos-node-bridge/docs/000-工程规划.md`](../../ohos-node-bridge/docs/000-工程规划.md) **§6 对接契约** 与冻结契约 [`../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md`](../../ohos-node-bridge/logs/20261016-1/IMPLEMENTATION_CONTRACT.md)。

---

## 一、文档总览

| 层级 | 分类 | 文档数量 | 说明 |
|---|---|---|---|
| 整体 | 项目级顶层文档 | 5 | `constitution.md` · `ARCHITECTURE.md` · `TECH.md` · `STRUCTURE.md` · `SPECS_CHECKLIST.md` |
| 整体 | 整体规格文档 | 4 | `overall-spec.md` · `overall-plan.md` · `overall-data-model.md` · `overall-test-cases.md` |
| 模块 | 运行时与载荷（`101`–`102`） | 4 | 运行时接入与启动编排 · 载荷流水线（组装与裁剪） |
| 模块 | 渲染与能力（`103`–`104`） | 4 | 渲染壳（ArkWeb 与页面） · 宿主能力（ArkTS 实现） |
| 模块 | 鉴权、扩展与合规（`105`–`107`） | 6 | 鉴权（loopback 与 Cookie） · 工具扩展（同名顶替） · 合规（上架前置清单） |
| 索引 | 本索引 | 1 | `README.md` |
| **合计** | **8 目录 / 24 文件** | | `specs/` 自身 1 + 模块目录 7 = **8 目录**；项目级 8 + 索引 2 + 模块 14 = **24 个 `.md` 文件**（实测：7 个模块目录，模块文档 14 份） |

> **刻意不生成** `API.md` 与 `overall-api.md`：前端与数据面（`/`、`/api/*`、SSE）由**上游 `pi-web`** 提供，
> 它跑在本工程进程内的 Node 里 —— **本工程不自有 API**。界面对外的是 ArkTS 内部接口（`PiDesktopRuntime`、`EntryAbility`），
> 能力面是**库冻结的 `HostBridge` 八个能力名**（见 [`overall-data-model.md`](./overall-data-model.md) §1.3 与
> [`104-host-capabilities-arkts-impl/spec.md`](./104-host-capabilities-arkts-impl/spec.md) §1.1）。
> `overall-test-cases.md` 属**明确要求**的交付物，已生成。

---

## 二、项目级顶层文档

全局性的原则、架构、技术、结构与完成度文档，定义项目基线与开发准则。

| 文档 | 路径 | 说明 |
|---|---|---|
| **项目宪法** | [constitution.md](./constitution.md) | 10 条不可协商原则（A1 一切经 HTTP · A2 壳薄契约硬 · A3 结论以库为准 · A4 不改上游 · A5 失败可见 · A6 不隐藏平台真相 · A7 判据可证伪 · A8 单实例与随机端口 ⑰ · A9 异常兜底 ⑱ · A10 声明面 ≠ 授权面）+ 代码规约 + 证据纪律 + 合规红线 + 评审清单 + 变更流程 |
| **整体架构** | [ARCHITECTURE.md](./ARCHITECTURE.md) | 分层与数据流、启动时序、状态机、**必须由 ArkTS 侧重实现的 16 项能力 × 现状**、鉴权两路线的架构位置、载荷两条路线、责任分界、合规架构位置 |
| **技术选型** | [TECH.md](./TECH.md) | 选型表 + 明确否掉的选项（含理由）+ 工具链基线 + 兼容矩阵 + 硬性代码约束 + 待定稿选型 + 替换路径预案 + 证据锚点 |
| **项目结构** | [STRUCTURE.md](./STRUCTURE.md) | 完整目录树 + 逐文件用途 + 关键配置 + 路由/页面清单 + `rawfile` vs `resfile` 规则 + 不入库清单 + 模块编号 ↔ 落点 |
| **检查清单** | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | 规格文档完成度追踪（项目级 + 模块级）+ 质量检查 + **未闭合项**（按 Phase/§ 号归属）+ 生成顺序与依据 |
| **规格索引** | [README.md](./README.md) | 本文件：文档总览 + 全量索引 + 模块编号一览 + 文档结构规范 + 快速导航 + 快照命令 |
| **API 文档（刻意不生成）** | `API.md` / `overall-api.md`（文件不存在） | ⛔ 本工程不自有 API：数据面属上游 `pi-web`，能力面是库冻结的 `HostBridge` 能力名 —— 契约落点见 `overall-data-model.md` §1.3 与模块 `104` 的 `spec.md` §1.1 / `plan.md`（宪法 A2） |

### 整体规格文档

跨模块的全局规格、方案、数据模型与测试索引。

| 文档 | 路径 | 说明 |
|---|---|---|
| **整体规格** | [overall-spec.md](./overall-spec.md) | 技术无关的能力需求（`FR-ARK-*` / `NFR-ARK-*`，RFC 2119）、系统边界、可证伪验收判据 |
| **整体方案** | [overall-plan.md](./overall-plan.md) | 技术上下文、宪法合规检查、分阶段实现策略、跨切面关注点、测试策略、构建装机流水线、风险处置 |
| **数据模型** | [overall-data-model.md](./overall-data-model.md) | ArkTS 状态与常量、库侧消费面类型、状态机迁移、环境变量契约、文件系统实体与凭据落点、权限数据模型、载荷体积模型、**HTTP 数据面模型** |
| **测试用例索引** | [overall-test-cases.md](./overall-test-cases.md) | L0–L4 五层测试 + `TC-ARK-*` / `TC-1NN-*` 用例族 + 四条真机取证通道 + **禁止的判据** + 已有基线数值 + 待验证清单 |

---

## 三、运行时与载荷（`101`–`102`）

### 101 — 运行时接入 · 启动编排 (`runtime-integration-launch-orchestration`)

> 把「**受管运行时 + 本地服务**」接入应用，并使整条启动路径**可观测、可失败、可判定**：以预构建产物消费运行时提供方（跨工程源码导入被拒 `00309001`）、投放委托、三段式启动编排（准备入口 → 投递启动 → 就绪探活）、壳侧状态与运行时状态并列映射、随机端口与单实例、关停与日志读回。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [101-runtime-integration-launch-orchestration/spec.md](./101-runtime-integration-launch-orchestration/spec.md) | 运行时接入与启动编排功能规格（`FR-101-001..020`、`AC-101-01..13`，技术无关口径） |
| 技术方案 | [101-runtime-integration-launch-orchestration/plan.md](./101-runtime-integration-launch-orchestration/plan.md) | 技术上下文、宪法合规检查、壳 ↔ 库状态映射、`launch()` 六步算法、真实文件行数、Phase 1/2 待实现清单 |

### 102 — 载荷流水线 · 组装与裁剪 (`payload-pipeline-assembly-crop`)

> 把上游界面与助手组装成可在目标设备上运行的**载荷**，并保证它「**能装进去、能起来、不臃肿、能升级、能如实报错**」：从上游构建产物原样组装（不改上游源码）、四项裁剪（先删后验）、投放两条路线（只读直读优先 / 归档 + 运行时自解包）、可写缓存外置、内容级幂等、载荷内启动脚本与异常兜底。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [102-payload-pipeline-assembly-crop/spec.md](./102-payload-pipeline-assembly-crop/spec.md) | 载荷组装、裁剪、投放路线与启动脚本功能规格（`FR-102-001..022`、`AC-102-01..12`） |
| 技术方案 | [102-payload-pipeline-assembly-crop/plan.md](./102-payload-pipeline-assembly-crop/plan.md) | 组装/裁剪规则、`resfile` 与 `tar.gz` 两路线对比、进程内托管与端口回传、体积账与 Phase 1/2 待实现清单 |

---

## 四、渲染与能力（`103`–`104`）

### 103 — 渲染壳 · ArkWeb 与页面 (`arkweb-shell-render-and-pages`)

> 用**系统提供的渲染组件**承载应用自带的本地界面，并把「启动 → 就绪 → 渲染 → 失败」四态**全部做可见**：应用内首屏加载页（阶段文本 + 进度、**必须不**白屏）、探活成功后切到本地服务地址（同源零 CORS）、清历史 + 返回键守卫、主框架导航围栏、宿主侧错误视图与诊断面板、**无浏览器语义**（无地址栏/标签页/任意网址导航）。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [103-arkweb-shell-render-and-pages/spec.md](./103-arkweb-shell-render-and-pages/spec.md) | 渲染组件配置、首屏与就绪切换、历史与返回键、失败可见、渲染侧能力功能规格（`FR-103-001..018`、`AC-103-01..12`） |
| 技术方案 | [103-arkweb-shell-render-and-pages/plan.md](./103-arkweb-shell-render-and-pages/plan.md) | 渲染组件属性与 `databaseAccess` 对照、导航围栏与历史清理实现、四态视图分层、取证类工作与 Phase 1/2 待实现清单 |

### 104 — 宿主能力 · ArkTS 实现 (`host-capabilities-arkts-impl`)

> 把旧壳（Electron）替我们做掉的那一层**宿主能力**在应用宿主侧重新实现 —— 权限预检与去设置页、文件/目录选择器、外链、通知、系统日志、运行时事实、工作区主目录清单、窗口状态记忆；**能力名逐字使用库冻结的 v1 清单**（`runtime.facts` / `perm.check` / `perm.openAppInfo` / `fs.pickFiles` / `fs.pickFolder` / `shell.openExternal` / `log.hilog` / `notify.show`），实现 100% 在本模块（库只做注册表 + 传输）。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [104-host-capabilities-arkts-impl/spec.md](./104-host-capabilities-arkts-impl/spec.md) | 八个冻结能力名的语义、失败语义、权限去向、选择器与外链围栏功能规格（`FR-104-001..030`、`AC-104-01..14`） |
| 技术方案 | [104-host-capabilities-arkts-impl/plan.md](./104-host-capabilities-arkts-impl/plan.md) | 注册器与 handler 形态、结构化错误、权限预检两段式、真实文件行数、Phase 2 逐条待实现清单（含库侧**阻塞项**） |

---

## 五、鉴权、扩展与合规（`105`–`107`）

### 105 — 鉴权 · loopback 与 Cookie (`auth-loopback-and-cookie`)

> 让渲染组件**无交互**地进入本地服务页并使 `/api/*` 可用，同时把暴露面压到最小：**首选**「只监听 loopback + 不设密码」（上游源码已证实未设密码则认证整体关闭、loopback 主机名/IP 直接放行），**回退**「绑局域网 + 随机强密码 + 会话 cookie 注入」（cookie 对含 `/api/*` 在内的所有请求生效）。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [105-auth-loopback-and-cookie/spec.md](./105-auth-loopback-and-cookie/spec.md) | 两条鉴权路线的目的、失败判据、会话凭据实体与共同纪律（`FR-105-001..018`、`AC-105-01..10`） |
| 技术方案 | [105-auth-loopback-and-cookie/plan.md](./105-auth-loopback-and-cookie/plan.md) | 上游三条逐行事实（`path:line`）、凭据派生与 `session.json` 原子写、注入时序、凭据卫生检索、Phase 1/2/3 待实现清单 |

### 106 — 工具扩展 · 同名顶替 (`tools-extensions-same-name-overrides`)

> 把旧壳已验证的三个**同名工具扩展**（`bash` / `find` / `grep`）与两个辅助扩展、两份预置模板搬进本工程载荷，用「同名顶替」补齐平台缺口（内建 `bash` 等子进程结束事件、内建 `find`/`grep` 依赖设备上不存在且禁止下载的 `fd`/`rg`），并让「工作区主目录清单」在助手侧可见、可自检。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [106-tools-extensions-same-name-overrides/spec.md](./106-tools-extensions-same-name-overrides/spec.md) | 同名顶替、搜索/查找、主目录清单与自检、模板与离线策略、上游补丁功能规格（`FR-106-001..024`、`AC-106-01..12`） |
| 技术方案 | [106-tools-extensions-same-name-overrides/plan.md](./106-tools-extensions-same-name-overrides/plan.md) | 常驻 shell + 哨兵行、进程组杀与迟到输出丢弃、纯 JS 走查实现、两处正文适配清单、Phase 1/2/3 待实现清单 |

### 107 — 合规 · 上架前置清单 (`compliance-listing-checklist`)

> 把「上架合规」从**风险条目**变成**可逐条勾选的清单**：G1 渲染形态与材料口径、G2 无浏览器语义、G3 包内无第三方浏览器内核、G4 第三方许可清单、G5 ELF 合规、G6 AI 生成内容标识、G7 图标/命名/备案三一致、G8 隐私声明可达、G9 PoC 资产清理、G10 无内测字样、G11 不含绕过平台代码签名/可执行内存控制的组件。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [107-compliance-listing-checklist/spec.md](./107-compliance-listing-checklist/spec.md) | G1–G11 逐项的判据、材料口径、清理清单与假设（`FR-107-001..030`、`AC-107-01..14`） |
| 技术方案 | [107-compliance-listing-checklist/plan.md](./107-compliance-listing-checklist/plan.md) | 每项的证据落点与现状标记、产物清单核对方法、Phase 3 待实现清单（13 项，含两项横切） |

---

## 六、模块编号一览

| 编号 | 模块名 | 二级模块 | 英文名 | 分类 | 阶段 |
|---|---|---|---|---|---|
| 101 | 运行时接入 | 启动编排 | runtime-integration-launch-orchestration | 运行时与载荷 | Phase 0 ✅ 骨架 / Phase 1 主体 |
| 102 | 载荷流水线 | 组装与裁剪 | payload-pipeline-assembly-crop | 运行时与载荷 | Phase 1（归档路线为备选） |
| 103 | 渲染壳 | ArkWeb 与页面 | arkweb-shell-render-and-pages | 渲染与能力 | Phase 0 ✅ 骨架 / Phase 1 主体 |
| 104 | 宿主能力 | ArkTS 实现 | host-capabilities-arkts-impl | 渲染与能力 | Phase 2（当前 0 行实现） |
| 105 | 鉴权 | loopback 与 Cookie | auth-loopback-and-cookie | 鉴权、扩展与合规 | Phase 1（路线 ② 属 Phase 2） |
| 106 | 工具扩展 | 同名顶替 | tools-extensions-same-name-overrides | 鉴权、扩展与合规 | Phase 1（设备侧当前 0 行） |
| 107 | 合规 | 上架前置清单 | compliance-listing-checklist | 鉴权、扩展与合规 | Phase 3（G2 现状 ✅，其余 ⬜） |

> 编号依规划 **§14.2**（`101`–`107`）；阶段依规划 **§11** 的分阶段实施计划。`108`–`199` 为**预留编号**，
> 规划未分配（后续细分模块或第二阶段扩展自 `108` 起续排，规则同样写入规划 §14.2）。

---

## 七、模块文档结构规范

每个模块目录 `1NN-<模块>-<二级模块>/` 下**必须成对**提供以下两份文档：

| 文件 | 命名 | 说明 |
|---|---|---|
| 功能规格 | `spec.md` | **技术无关**：模块概述（目的/解决的问题/范围）、用户故事、功能需求（`FR-1NN-NNN`，RFC 2119 的 MUST/SHOULD/MAY）、关键实体、验收场景（Given/When/Then，编号 `AC-1NN-NN`）、非功能需求、假设与约束、依赖 |
| 技术方案 | `plan.md` | **实现特定**：技术上下文与依赖版本、宪法合规检查（逐条 ✅/⚠️/⬜ + 理由）、研究结论与替代方案、数据模型、接口契约（提供/消费/事件协议）、实现策略（架构模式/关键算法/错误处理/性能）、测试考虑（呼应 `overall-test-cases.md` 的 `TC-1NN-*`）、文件清单（**真实行数** `wc -l`）、待实现清单 + 验收判据 + 依据 |

> 复杂模块可再追加：
> - `tasks.md` — 任务拆解、依赖关系、里程碑
> - `test-cases.md` — 模块级单步用例（本工程当前统一由 [`overall-test-cases.md`](./overall-test-cases.md) §2 的用例族覆盖，未单独立文件）

**三条纪律**：

1. `spec.md` 写「做什么、验收判据是什么」；`plan.md` 写「怎么做」。两份都**回引**规划 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) 的 § 号与库文档的 § 号。
2. `spec.md` 不出现框架名、组件名与文件路径；`plan.md` 不出现没有源码依据的断言。
3. as-built 与 planned 必须逐条区分：未实现的写 `⬜ 规划未实现（Phase N）`，**不得**把规划当既成事实（宪法 A7）。

---

## 八、快速导航

| 目标读者 | 推荐阅读顺序 |
|---|---|
| **新加入开发者** | [constitution.md](./constitution.md) → [STRUCTURE.md](./STRUCTURE.md) → [overall-spec.md](./overall-spec.md) → [ARCHITECTURE.md](./ARCHITECTURE.md) → 目标模块的 `spec.md` |
| **架构师 / Tech Lead** | [ARCHITECTURE.md](./ARCHITECTURE.md) → [TECH.md](./TECH.md) → [overall-plan.md](./overall-plan.md) → [overall-data-model.md](./overall-data-model.md) → 规划 §4 / §14.2 |
| **ArkTS 宿主实现者** | [constitution.md](./constitution.md) §二（代码规约）→ [101-runtime-integration-launch-orchestration/plan.md](./101-runtime-integration-launch-orchestration/plan.md) · [103-arkweb-shell-render-and-pages/plan.md](./103-arkweb-shell-render-and-pages/plan.md) · [104-host-capabilities-arkts-impl/plan.md](./104-host-capabilities-arkts-impl/plan.md) → 对应 `spec.md` → 库文档 §6 对接契约 |
| **Node 侧载荷实现者** | [102-payload-pipeline-assembly-crop/plan.md](./102-payload-pipeline-assembly-crop/plan.md) → [overall-data-model.md](./overall-data-model.md) §3（环境契约）/ §4（文件系统实体）+ [105-auth-loopback-and-cookie/spec.md](./105-auth-loopback-and-cookie/spec.md) → 规划 §7 + 库文档 §5.5 |
| **测试 / QA** | [overall-test-cases.md](./overall-test-cases.md) → [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) §五 → 各模块 `plan.md` §7（测试考虑） |
| **合规 / 上架** | [constitution.md](./constitution.md) §四（合规红线）→ 规划 §13（G1–G11）→ [107-compliance-listing-checklist/spec.md](./107-compliance-listing-checklist/spec.md) → [107-compliance-listing-checklist/plan.md](./107-compliance-listing-checklist/plan.md) §9 |
| **排障 / 值班** | [overall-test-cases.md](./overall-test-cases.md) §3（四条取证通道）/ §4（禁止的判据）→ [101-runtime-integration-launch-orchestration/plan.md](./101-runtime-integration-launch-orchestration/plan.md) §6.3（错误处理）→ 规划 §12（风险） |

### 快照命令（先看证据，再看结论）

```bash
# ① 构建库 HAR（消费构建产物，不用源码目录 —— 踩坑 00309001）
./scripts/build-bridge-har.sh                                   # → libs/@fellow99/node-bridge.har
# ② 运行时投放门禁（幂等 + 七项 ELF 门禁 + SHA-256）
./scripts/provision-runtime.sh --check                          # 只校验，不改文件
# ③ 构建 HAP
export DEVECO_SDK_HOME='D:\oh-workspace\command-line-tools\sdk'
export PATH="/d/oh-workspace/DevEco Studio/tools/node:$PATH"
cmd //c "D:\oh-workspace\command-line-tools\bin\hvigorw.bat assembleHap --mode module \
         -p product=default -p buildMode=debug --no-daemon"
# ④ 装机与启动（探针占 15577，先腾出端口）
hdc install -r entry/build/default/outputs/default/entry-default-signed.hap
hdc shell "aa force-stop org.fellow99.test.NodeProbe"
hdc shell "aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk --ps probeFlags '--no-verify-heap'"
hdc shell "aa dump -l"                                          # 前台确认（截图/uitest 只作用前台）
# ★ 端到端证书：不经 UI 直接读回运行时事实
hdc fport tcp:15577 tcp:15577 && curl -s http://127.0.0.1:15577/facts
# 四条真机取证通道：① snapshot_display ② uitest uiInput click <x> <y> ③ hdc rport tcp:19999 ④ hilog
hdc shell snapshot_display -f /data/local/tmp/s.jpeg && hdc file recv /data/local/tmp/s.jpeg ./
```

> 命令与口径的权威来源：规划 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) **§14.3 / 附录 A**，以及本仓库根 `README.md`。
> ⚠️ `hdc shell uitest dumpLayout` 在本机拿不到结果，**不作为取证通道**（见 `overall-test-cases.md` §4）。

---

**文档维护者：** `pi-desktop-ark` 开发团队 · **权威来源：** [`../docs/000-工程规划.md`](../docs/000-工程规划.md)（v0.1）
