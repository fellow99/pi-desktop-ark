# 013 — 品牌化（branding）功能规格

> **Module:** branding ｜ **Status:** Partial（图标与文案已完成；页面 Logo 与统一命名待收口） ｜ **Last Updated:** 2026-10-31
> **上游基线:** `pi` v1.2.0 / `pi-web` v0.12.1（品牌化实施轮次为 2026-10-17）
> **应用名 / 包名:** **Pi Desktop Ark** / `org.fellow99.pi.PiDesktopArk`
> **物料唯一来源:** 父工程 `../assets/`（`logo.svg`、`logo.png`、`logo-1024-with-bg.png`）
> **规划依据:** [`../../docs/001-能力复刻评估.md`](../../docs/001-能力复刻评估.md) §H.3、E11/E13、REV-2/REV-12；[`../../docs/000-工程规划.md`](../../docs/000-工程规划.md) 头部表
> **同型参考:** `pi-desktop` / `pi-desktop-hos` / `pi-desktop-android` 的 `013-branding`

## 1. 模块概述

### 1.1 目的

把 HarmonyOS 纯血版交付物中的上游品牌与占位图标清掉，统一为 **Pi Desktop** 家族品牌：

- 应用图标位（`app_icon` / `icon` / `startIcon`）由父工程物料生成；
- 载荷（pi-web 产物副本）中用户可见 `Pi Web` → `Pi Desktop`；
- 运行时 `PI_WEB_APP_NAME=Pi Desktop`、`PI_WEB_SKIP_VERSION_CHECK=1`；
- 技术标识符（`pi-web`、`PI_WEB_*`、`PiWeb`、路由）保持不变。

### 1.2 解决的问题

- 应用名曾是 `Pi Desktop Ark`，与其它三版的 `Pi Desktop` 不一致（上架前需定名）。
- 载荷直接暴露上游 `Pi Web` 文案与图标。
- 旧图标位存在 `icon.png ≡ startIcon.png` 的占位缺陷。
- 无 SVG 光栅化器，页面 Logo 仍引用上游 PNG。

### 1.3 范围

**包含**

- `scripts/brand-assets.mjs`：从父工程物料生成 `app_icon` / `icon` / `startIcon`，硬校验尺寸/透明度/幂等。
- `scripts/assemble-payload.mjs#applyWebBranding`：载荷暂存副本内 `Pi Web` → `Pi Desktop`（产物级 0 残留）。
- `payload/env.js`：默认 `PI_WEB_APP_NAME=Pi Desktop`、`PI_WEB_SKIP_VERSION_CHECK=1`。
- 文档回写：能力评估 §H.3、README、真机记录。

**不包含**

- 改上游 `pi` / `pi-web` 源码。
- 页面 Logo 改用 `logo.svg`（**当前未完成**：本机无 SVG 光栅化器；需在 pi-web 侧直接引用矢量文件）。
- 首屏标记探测（ark 无 `UI_HTML_MARKERS` 等价物，**未完成**）。
- 应用名从 `Pi Desktop Ark` 改为 `Pi Desktop`（**待产品定名**）。

## 2. 用户故事

- 作为用户，我在桌面图标与启动页看到的是 Pi 品牌，而不是占位图。
- 作为用户，我在对话界面、登录页、侧栏看到的是 `Pi Desktop`，而不是 `Pi Web`。
- 作为维护者，我换父工程物料并重跑脚本，图标全量更新且字节稳定。
- 作为审核者，我能用 `--check` 与产物 grep 证明 0 残留、物料缺失即失败。

## 3. 功能需求

### 3.1 图标物料

- **FR-013-001**（MUST）：`app_icon` 必须由 `logo.png`（200²、含透明）放大到 1024×1024 并合成白底，输出无 alpha（colorType=2，minAlpha=255）。
- **FR-013-002**（MUST）：`icon` 必须由 `logo.png` 同源同参生成（1024²、合成白底、不透明）；`startIcon` 由 `logo.png` 生成（512²、保留 alpha）。
- **FR-013-003**（MUST）：物料缺失、尺寸不符、透明度不符 ⇒ 构建失败；`--check` 可只校验不改写。
- **FR-013-004**（MUST）：生成必须幂等（同一物料连续运行字节不变）。
- **FR-013-005**（MUST）：每一个被引用的图标位都必须来自同一物料；不得保留占位图或 `icon ≡ startIcon` 的字节相同缺陷。

### 3.2 载荷文案

- **FR-013-006**（MUST）：载荷暂存副本（`node_modules/` 之外）用户可见 `Pi Web` 必须替换为 `Pi Desktop`，产物级 0 残留。
- **FR-013-007**（MUST NOT）：替换不得触及技术标识符 `pi-web`、`@agegr/pi-web`、`pi-web:*`、`PI_WEB_*`、`PiWeb`。
- **FR-013-008**（MUST）：替换必须按内容判定文本（覆盖 `.rsc` 等无扩展名载荷），不得只按扩展名白名单。
- **FR-013-009**（MUST）：运行时必须置位 `PI_WEB_APP_NAME=Pi Desktop` 与 `PI_WEB_SKIP_VERSION_CHECK=1`。

### 3.3 未闭合项（明确登记）

- **FR-013-010**（SHOULD）：页面 Logo 应改用父工程 `logo.svg`；当前 **⬜ 未完成**（无 SVG 光栅化器；方案见 plan D4）。
- **FR-013-011**（SHOULD）：应用名应从 `Pi Desktop Ark` 统一为 `Pi Desktop`；当前 **⬜ 待产品定名**（`AppScope/.../string.json`）。
- **FR-013-012**（SHOULD）：首屏标记探测应与品牌化后的产物一致；当前 **⬜ 未实现**（ark 无 `UI_HTML_MARKERS` 等价物）。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|---|---|---|
| 物料 | 父工程 `assets/` | `logo.png` 200² 含透明；`logo-1024-with-bg.png` 1024² 不透明；`logo.svg` |
| 图标位 | `AppScope/resources/base/media/*` | `app_icon`、`icon`、`startIcon` |
| 载荷文案 | pi-web 产物 | `Pi Web` → `Pi Desktop`；技术标识符不变 |
| 运行时环境 | `payload/env.js` | `PI_WEB_APP_NAME`、`PI_WEB_SKIP_VERSION_CHECK` |

## 5. 验收场景

### 场景：图标生成

- Given 父工程 `assets/` 三个物料在位
- When 执行 `node scripts/brand-assets.mjs`
- Then 三个图标位生成，`app_icon`/`icon` 无 alpha、`startIcon` 有 alpha；连续两次 SHA-256 不变

### 场景：物料缺失

- Given `--assets /tmp/nonexistent`
- When 执行 `brand-assets.mjs`
- Then exit 1，提示物料路径，不产出图标

### 场景：载荷 0 残留

- Given 已组装载荷暂存树
- When 执行 `assemble-payload.mjs` 并 grep `Pi Web`（排除 `node_modules/`）
- Then 0 处；`Pi Desktop` 出现；技术标识符计数不变

### 场景：真机

- Given 已安装 HAP
- When 启动并 dumpLayout
- Then `Pi Desktop` 出现、`Pi Web` 为 0、图标为生成物料

## 6. 非功能需求

- **确定性**：ffmpeg scale 固定参数，连续运行字节稳定。
- **性能**：图标生成在构建期，秒级；运行时无额外开销。
- **安全**：脚本不读取凭据；不修改签名材料。
- **可维护**：`--assets` 可覆盖物料目录。

## 7. 假设与约束

- 父工程 `assets/` 在位；CI/他机需先获取物料。
- 本机 `ffmpeg 7.1` 可用；无 SVG 光栅化器（页面 Logo 方案受限）。
- 应用名 `Pi Desktop Ark` 是当前定名，统一为 `Pi Desktop` 需产品决策。

## 8. 依赖

- 父工程：`../../specs/013-branding/`、`assets/`。
- 模块：`102-payload-pipeline-assembly-crop`（载荷暂存树）、`104-host-capabilities-arkts-impl`（宿主显示名）。
- 同型实现：`pi-desktop` / `pi-desktop-hos` / `pi-desktop-android` 的 `013-branding`。
