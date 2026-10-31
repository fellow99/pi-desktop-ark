# 规格文档索引 —— `pi-desktop-ark`

**项目名称：** `pi-desktop-ark` · **定位名：** **HarmonyOS Edition**（HarmonyOS 版；对应 `pi-desktop-hos` = Electron on HarmonyOS Edition）
**应用名 / 包名：** **Pi Desktop Ark** / `org.fellow99.pi.PiDesktopArk`
**版本：** 应用 `0.1.0` / `versionCode` `100`；发布 tag `v0.12.1`；上游 `pi` v1.2.0 + `pi-web` v0.12.1
**技术栈：** ArkTS 宿主（UIAbility + **ArkWeb**）+ `@fellow99/node-bridge` 0.1.0（进程内 `dlopen` + `node::Start`，Node v24.2.0）+ 端上 `pi-web` 服务（同源 HTTP + SSE）+ 同名工具扩展（纯 JS）；**不带任何 Chromium/Electron**
**目标设备：** `2in1` / `tablet` / `phone`（真机 HAD-W24 · API 26 · arm64-v8a；TV 不列为验收对象）
**文档生成时间：** 2026-10-16 ｜ **最后更新：** 2026-10-31（编号按父工程规则统一）

> **权威规划文档是 [`../docs/000-工程规划.md`](../docs/000-工程规划.md)。**
> 本目录是它的**收敛/展开版**：只做细化与验收，不复制论证；所有结论回引规划的 § 号。
> **运行时结论以库文档为准** —— [`ohos-node-bridge/docs/000-工程规划.md`](https://github.com/fellow99/ohos-node-bridge/blob/main/docs/000-工程规划.md) **§6 对接契约**。
> 本目录是父工程 [`../../specs/`](../../specs/) 的子工程实现侧：整体规划与跨工程公共需求在父工程，本目录只写本工程实现。

---

## 一、文档总览

| 层级 | 分类 | 文档数量 | 说明 |
|---|---|---|---|
| 整体 | 项目级顶层文档 | 9 | `constitution.md` · `ARCHITECTURE.md` · `TECH.md` · `STRUCTURE.md` · `SPECS_CHECKLIST.md` · `overall-spec.md` · `overall-plan.md` · `overall-data-model.md` · `overall-test-cases.md` |
| 模块 | 公共模块（`011` / `013`） | 4 | 版本更新 0.12.1、品牌化 |
| 模块 | 运行时与载荷（`101`–`102`） | 4 | 运行时接入与启动编排 · 载荷流水线 |
| 模块 | 渲染与能力（`103`–`104`） | 4 | 渲染壳（ArkWeb） · 宿主能力（ArkTS） |
| 模块 | 鉴权、扩展与合规（`105`–`107`） | 6 | 鉴权（loopback/Cookie） · 工具扩展 · 合规清单 |
| 模块 | 形态与插件（`108` / `204`） | 6 | JITless 形态 · Git 插件 |
| 索引 | 本索引 | 1 | `README.md` |
| **合计** | **12 目录 / 36 文件** | | `specs/` 自身 1 + 模块目录 11 = **12 目录**；项目级 9 + 索引 1 + 模块 26 = **36 个 `.md` 文件** |

> **刻意不生成** `API.md` 与 `overall-api.md`：数据面由上游 `pi-web` 提供，本工程不自有 API。
> 能力面是库冻结的 `HostBridge` 能力名（见 [`overall-data-model.md`](./overall-data-model.md) §1.3 与
> [`104-host-capabilities-arkts-impl/spec.md`](./104-host-capabilities-arkts-impl/spec.md) §1.1）。

---

## 二、项目级顶层文档

| 文档 | 路径 | 说明 |
|---|---|---|
| **项目宪法** | [constitution.md](./constitution.md) | 10 条不可协商原则（A1–A10）+ 代码规约 + 证据纪律 + 合规红线 + 评审清单 |
| **整体架构** | [ARCHITECTURE.md](./ARCHITECTURE.md) | 分层与数据流、启动时序、状态机、16 项宿主能力、鉴权路线、载荷路线、责任分界 |
| **技术选型** | [TECH.md](./TECH.md) | 选型表 + 否掉的选项 + 工具链 + 兼容矩阵 + 硬性代码约束 + 证据锚点 |
| **项目结构** | [STRUCTURE.md](./STRUCTURE.md) | 目录树 + 逐文件用途 + `rawfile` vs `resfile` + 模块编号 ↔ 落点 |
| **检查清单** | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | 文档完成度 + 未闭合项 + 质量检查 |
| **整体规格** | [overall-spec.md](./overall-spec.md) | `FR-ARK-*` / `NFR-ARK-*`、系统边界、可证伪验收 |
| **整体方案** | [overall-plan.md](./overall-plan.md) | 技术上下文、宪法合规、分阶段策略、跨切面、测试、构建、风险 |
| **数据模型** | [overall-data-model.md](./overall-data-model.md) | ArkTS 状态、库侧类型、状态机、环境变量、文件系统、权限、HTTP 数据面 |
| **测试用例索引** | [overall-test-cases.md](./overall-test-cases.md) | L0–L4 测试 + `TC-ARK-*` / `TC-1NN-*` + 真机取证通道 + 禁止判据 |
| **规格索引** | [README.md](./README.md) | 本文件 |

---

## 三、公共模块（`011` / `013`）

### 011 — 版本更新：0.12.1（version）

> 上游 `pi` v1.2.0 + `pi-web` v0.12.1；运行时 `@fellow99/node-bridge` 0.1.0 + `node-runtime` 24.2.0；
> 应用版本 `0.1.0` / `100`；`patches/v0.12.1/` 六条；发布 tag `v0.12.1`。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [011-version-0.12.1/spec.md](./011-version-0.12.1/spec.md) | 基线、版本号分离、补丁、发布与证据（`FR-011-*`） |
| 技术方案 | [011-version-0.12.1/plan.md](./011-version-0.12.1/plan.md) | 版本收敛步骤、运行时包、构建与真机验证 |

### 013 — 品牌化（branding）

> 图标由父工程物料生成；载荷 `Pi Web` → `Pi Desktop`；`PI_WEB_APP_NAME` / `PI_WEB_SKIP_VERSION_CHECK`。
> **部分完成**：页面 Logo、应用名统一、首屏标记仍为 ⬜（见 spec §3.3）。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [013-branding/spec.md](./013-branding/spec.md) | 图标/文案/运行时开关 + 未闭合项（`FR-013-*`） |
| 技术方案 | [013-branding/plan.md](./013-branding/plan.md) | ffmpeg 图标生成、内容判定替换、未完成项方案 |

---

## 四、运行时与载荷（`101`–`102`）

### 101 — 运行时接入 · 启动编排 (`runtime-integration-launch-orchestration`)

> 把「受管运行时 + 本地服务」接入应用，使启动路径可观测、可失败、可判定：预构建产物消费运行时、
> 投放委托、三段式启动编排、壳侧与运行时状态映射、随机端口与单实例、关停与日志读回。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [101-runtime-integration-launch-orchestration/spec.md](./101-runtime-integration-launch-orchestration/spec.md) | `FR-101-001..020`、`AC-101-01..13` |
| 技术方案 | [101-runtime-integration-launch-orchestration/plan.md](./101-runtime-integration-launch-orchestration/plan.md) | 壳 ↔ 库状态映射、`launch()` 六步算法、待实现清单 |

### 102 — 载荷流水线 · 组装与裁剪 (`payload-pipeline-assembly-crop`)

> 把上游界面与助手组装成可运行载荷：原样组装（不改上游）、四项裁剪、两条投放路线、可写缓存外置、
> 内容级幂等、载荷内启动脚本与异常兜底。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [102-payload-pipeline-assembly-crop/spec.md](./102-payload-pipeline-assembly-crop/spec.md) | `FR-102-001..022`、`AC-102-01..12` |
| 技术方案 | [102-payload-pipeline-assembly-crop/plan.md](./102-payload-pipeline-assembly-crop/plan.md) | 组装/裁剪规则、`resfile` vs `tar.gz`、体积账 |

---

## 五、渲染与能力（`103`–`104` / `108`）

### 103 — 渲染壳 · ArkWeb 与页面 (`arkweb-shell-render-and-pages`)

> 用系统 ArkWeb 承载本地界面，四态可见（启动/就绪/渲染/失败）、同源加载、清历史 + 返回键守卫、
> 导航围栏、错误视图与诊断面板、无浏览器语义。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [103-arkweb-shell-render-and-pages/spec.md](./103-arkweb-shell-render-and-pages/spec.md) | `FR-103-001..018`、`AC-103-01..12` |
| 技术方案 | [103-arkweb-shell-render-and-pages/plan.md](./103-arkweb-shell-render-and-pages/plan.md) | 组件属性、导航围栏、四态视图分层 |

### 104 — 宿主能力 · ArkTS 实现 (`host-capabilities-arkts-impl`)

> 在应用宿主侧重实现 Electron 旧壳的宿主能力：权限、选择器、外链、通知、日志、运行时事实、
> 工作区根、窗口状态；能力名逐字使用库冻结清单。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [104-host-capabilities-arkts-impl/spec.md](./104-host-capabilities-arkts-impl/spec.md) | `FR-104-001..030`、`AC-104-01..14` |
| 技术方案 | [104-host-capabilities-arkts-impl/plan.md](./104-host-capabilities-arkts-impl/plan.md) | 注册器、结构化错误、权限两段式、阻塞项 |

### 108 — JITless 形态 (`jitless`)

> 编译期固定 `compat`（`--jitless`）：无 WASM / code-mode 不注册；换来手机与平板一致的可用性。
> 决策依据见 [`../docs/108-jitless-方案决策.md`](../docs/108-jitless-方案决策.md)。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [108-jitless/spec.md](./108-jitless/spec.md) | 形态开关、能力影响、验收 |
| 技术方案 | [108-jitless/plan.md](./108-jitless/plan.md) | `NODE_MODE`、裁剪链、真机对比 |
| 任务 / 用例 | [tasks.md](./108-jitless/tasks.md) · [test-cases.md](./108-jitless/test-cases.md) | 任务与测试 |

---

## 六、鉴权、扩展与合规（`105`–`107`）

### 105 — 鉴权 · loopback 与 Cookie (`auth-loopback-and-cookie`)

> 渲染组件无交互进入本地服务：首选「只监听 loopback + 不设密码」；回退「绑局域网 + 随机强密码 + 会话 cookie」。
> 当前 ark 采用 **loopback 免密**路线（同进程，不隔离）。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [105-auth-loopback-and-cookie/spec.md](./105-auth-loopback-and-cookie/spec.md) | `FR-105-001..018`、`AC-105-01..10` |
| 技术方案 | [105-auth-loopback-and-cookie/plan.md](./105-auth-loopback-and-cookie/plan.md) | 上游事实、凭据派生、注入时序、凭据卫生 |

### 106 — 工具扩展 · 同名顶替 (`tools-extensions-same-name-overrides`)

> 把 `bash` / `find` / `grep` 与辅助扩展、预置模板搬进载荷，同名顶替补齐平台缺口；
> 工作区根清单在助手侧可见、可自检。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [106-tools-extensions-same-name-overrides/spec.md](./106-tools-extensions-same-name-overrides/spec.md) | `FR-106-001..024`、`AC-106-01..12` |
| 技术方案 | [106-tools-extensions-same-name-overrides/plan.md](./106-tools-extensions-same-name-overrides/plan.md) | 常驻 shell + 哨兵、纯 JS 搜索、适配清单 |

### 107 — 合规 · 上架前置清单 (`compliance-listing-checklist`)

> 把上架合规变成可勾选清单：G1 渲染形态、G2 无浏览器语义、G3 无第三方内核、G4 许可、G5 ELF、
> G6 AI 标识、G7 图标/命名/备案、G8 隐私、G9 PoC 清理、G10 无内测字样、G11 无绕过签名组件。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [107-compliance-listing-checklist/spec.md](./107-compliance-listing-checklist/spec.md) | `FR-107-001..030`、`AC-107-01..14` |
| 技术方案 | [107-compliance-listing-checklist/plan.md](./107-compliance-listing-checklist/plan.md) | 证据落点、产物核对、Phase 3 待实现 |

---

## 七、插件模块（`204`）

### 204 — 插件：Git 操作（plugin-git）

> 纯 JS `harmony-git` 扩展（isomorphic-git 1.44.2）：21 个 `git_*` 工具 + `git_credentials`；
> 从 hos 单一事实源同步；无系统 git 二进制。

| 文档 | 链接 | 说明 |
|---|---|---|
| 功能规格 | [204-plugin-git/spec.md](./204-plugin-git/spec.md) | 共享需求 + ark 差异（`FR-ARK-204-*`） |
| 技术方案 | [204-plugin-git/plan.md](./204-plugin-git/plan.md) | 同步、装配、物化、权限桥 |
| 任务 / 用例 | [tasks.md](./204-plugin-git/tasks.md) · [test-cases.md](./204-plugin-git/test-cases.md) | 任务与端到端用例 |

---

## 八、编号规则与迁移

### 8.1 编号规则（与父工程 `../../specs/constitution.md` 一致）

1. `0XX` 公共模块：`011-version-<VERSION>`、`013-branding`；`012-building-workflow` 按父工程规则
   **鸿蒙工程暂无**（本工程不使用该编号）。
2. `1XX` 本工程基础模块：101 运行时接入、102 载荷流水线、103 渲染壳、104 宿主能力桥、105 鉴权、
   106 工具扩展、107 合规、108+ 平台特有职责。
3. `2XX` 插件模块：203 目录选择器、204 Git、205 pnpm、206 PTY（后两者本工程未启用）。
4. 编号只增不改、不复用；模块编号 ⇄ 目录 ⇄ `FR-<module>-*` 三处一致。

### 8.2 编号迁移对照（2026-10-31）

| 旧编号 | 新编号 | 说明 |
|---|---|---|
| 无（新增） | `011-version-0.12.1` | 版本模块统一为 011 |
| 无（新增） | `013-branding` | 品牌化公共模块；原分散在 001/102 文档 |

> `108-jitless`、`204-plugin-git` 编号不变；本轮只补公共模块索引。

---

## 九、文档结构规范

1. **成对交付**：`spec.md` 与 `plan.md` 必须成对；复杂模块加 `tasks.md` / `test-cases.md`。
2. **目录命名**：`<NNN>-<kebab-name>`；公共 `0NN`、基础 `1NN`、插件 `2NN`。
3. **统一文档头**：`Module` / `Status` / `Last Updated` / 上游基线。
4. **状态流转**：Proposed → Accepted → Implementing → Implemented → Superseded。
5. **需求条目**：`FR-<module>-<三位数>`；MUST / MUST NOT / SHOULD / MAY；只追加不修订。
6. **plan 回引 FR**；**源码即真理**；证据标记 ✅ / 🔶 / ⬜ / ⚠️ 必须给出处。
7. **不生成** `API.md` / `overall-api.md`（本工程不自有 API）。

---

## 十、快速导航

| 目标读者 | 推荐阅读顺序 |
|---|---|
| 先看全貌 | [`../../specs/`](../../specs/) → 本文件 → [`../docs/000-工程规划.md`](../docs/000-工程规划.md) |
| 新加入开发者 | [constitution.md](./constitution.md) → 101 → 103 → 104 |
| 构建 / 发布 | [011-version-0.12.1](./011-version-0.12.1/) → [102-payload-pipeline-assembly-crop](./102-payload-pipeline-assembly-crop/) → [108-jitless](./108-jitless/) |
| 平台能力 | 104 → 105 → 106 → 107 |
| 品牌 / 合规 | [013-branding](./013-branding/) → 107 |
| 插件 | 204 → 106 |
| 真机 / 证据 | [overall-test-cases.md](./overall-test-cases.md) → `../docs/001-能力复刻评估.md` |
