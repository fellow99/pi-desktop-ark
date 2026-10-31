# 013 — 品牌化（branding）技术方案（As-Built）

> **Module:** 013-branding ｜ **Status:** Partial ｜ **Last Updated:** 2026-10-31
> **对应规格:** [`spec.md`](./spec.md)（FR-013-001 … FR-013-012）
> **实现落点:** `scripts/brand-assets.mjs`、`scripts/assemble-payload.mjs#applyWebBranding`、
> `payload/env.js`、`AppScope/resources/base/media/*`、`entry/src/main/resources/base/media/*`
> **证据:** [`../../docs/001-能力复刻评估.md`](../../docs/001-能力复刻评估.md) §H.3、E11/E13、REV-2/REV-12

## 1. 技术上下文

### 1.1 运行环境

- 宿主：ArkTS + ArkWeb；构建：DevEco / hvigor。
- 运行时：`@fellow99/node-bridge` 0.1.0 + `node-runtime` 24.2.0。
- 图像工具：`ffmpeg 7.1`（scale / 合成白底）；**无 SVG 光栅化器**。

### 1.2 依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `logo.png` | 200×200、含透明 | `startIcon` / 透明位图 |
| `logo-1024-with-bg.png` | 1024×1024、不透明 | 备用/其它版应用图标（ark 未直接使用） |
| `logo.svg` | 矢量 | 页面 Logo（**未接入**） |
| ffmpeg | 7.1 | 缩放/合成 |

## 2. 宪法合规检查

| 原则 | 合规 | 说明 |
|---|---|---|
| A1 一切经 HTTP | ✅ | 品牌化不改数据面 |
| A2 壳薄契约硬 | ✅ | 只改资源与载荷副本 |
| A3 结论以库为准 | ✅ | 图标尺寸/透明度由脚本硬校验 |
| A4 不改上游 | ✅ | 载荷副本替换，上游零改动 |
| A5 失败可见 | ✅ | 物料缺失/尺寸不符/残留 `Pi Web` 均失败 |
| A6 不隐藏平台真相 | ✅ | 页面 Logo / 应用名未完成项如实登记 |

## 3. 研究结论

- **D1 图标生成**：`brand-assets.mjs` 用 ffmpeg 从 `logo.png` 生成 `app_icon` / `icon`（1024²、合成白底、rgb24、minAlpha=255），
  从 `logo.png` 生成 `startIcon`（512²、rgba、minAlpha<255）；`--check` 校验尺寸/颜色类型/透明度。
- **D2 文案替换**：`assemble-payload.mjs#applyWebBranding(tarRoot)` 在暂存副本上做大小写敏感的 `Pi Web` → `Pi Desktop`；
  **按内容判文本**（前 8 KB 无 NUL，跳过 `.map`），覆盖 `.rsc` 等无扩展名载荷。
  曾用扩展名白名单导致 9 个 `.rsc` 残留，已改为内容判定（31 文件 / 1011 处）。
- **D3 运行时开关**：`payload/env.js` 默认 `PI_WEB_APP_NAME=Pi Desktop`、`PI_WEB_SKIP_VERSION_CHECK=1`。
- **D4 页面 Logo 未完成**：本机无 SVG 光栅化器；可选方案：
  1. 在 pi-web 产物中把 `<img src>` 直接指向 `/icons/logo.svg` 并复制 SVG（不改上游源码，只改副本）；
  2. 引入可用的 SVG 光栅化器（librsvg / resvg）生成 180/192 位图。
  当前未实施，登记为 ⬜。
- **D5 应用名未统一**：`AppScope/resources/base/element/string.json` 仍为 `Pi Desktop Ark`；统一为 `Pi Desktop` 需产品定名。

## 4. 数据模型

| 实体 | 字段 / 文件 | 规则 |
|---|---|---|
| 应用图标 | `AppScope/resources/base/media/app_icon.png` | 由 `logo.png` 放大 + 白底；1024²，rgb24，minAlpha=255 |
| 启动图标 | `entry/src/main/resources/base/media/startIcon.png` | 512²，rgba，minAlpha<255 |
| 普通图标 | `entry/src/main/resources/base/media/icon.png` | 由 `logo.png` 同源同参；1024²，rgb24 |
| 文案 | `Pi Web` → `Pi Desktop` | 仅用户可见；技术标识符不变 |
| 环境 | `PI_WEB_APP_NAME` / `PI_WEB_SKIP_VERSION_CHECK` | 默认 `Pi Desktop` / `1` |

## 5. 接口契约

### 5.1 提供的接口

- `node scripts/brand-assets.mjs [--assets <dir>] [--check]`：生成/校验图标；失败非 0。
- `applyWebBranding(tarRoot)`：载荷暂存树品牌化；残留 `Pi Web` 即抛错。
- `payload/env.js`：注入品牌环境变量。

### 5.2 消费的接口

- 父工程 `../assets/` 三个物料。
- `scripts/assemble-payload.mjs` 的暂存根。
- `AppScope` / `entry` 资源目录。

## 6. 实现策略

### 6.1 图标生成

1. 校验物料存在与尺寸/透明度。
2. `app_icon`：`logo.png` → 1024² rgb24（放大并合成白底）。
3. `icon`：同源同参 → 1024² rgb24。
4. `startIcon`：`logo.png` → 512² rgba。
5. `--check` 读回 PNG IHDR 校验，不写入。

### 6.2 载荷文案

1. 递归遍历暂存树，跳过 `node_modules/` 与 `.map`。
2. 按内容判定文本（前 8 KB 无 NUL）。
3. 替换 `Pi Web` → `Pi Desktop`。
4. 终检 `node_modules/` 之外 0 处 `Pi Web`，否则抛错。

### 6.3 未完成项的实施建议

- 页面 Logo：优先在副本中替换 `src` 为 `/icons/logo.svg` 并复制 SVG（不需光栅化器）。
- 应用名：产品定名后同步 `string.json`、README、文档与截图。
- 首屏标记：在 `EntryAbility` 或加载页增加 `Pi Desktop` 文本探测，或明确不实现。

## 7. 测试考量

- 正向：三图标生成、尺寸/透明度/幂等校验。
- 负向：物料缺失、尺寸不符、透明通道不符、`Pi Web` 残留。
- 真机：安装 HAP，dumpLayout 校验 `Pi Desktop` 出现、`Pi Web` 为 0。
- 回归：对话、工具、Git 扩展不受影响。

## 8. 文件清单

| 文件 | 作用 |
|---|---|
| `scripts/brand-assets.mjs` | 图标生成/校验 |
| `scripts/assemble-payload.mjs` | 载荷品牌化 + 组装 |
| `payload/env.js` | 品牌环境变量 |
| `AppScope/resources/base/media/app_icon.png` | 应用图标 |
| `entry/src/main/resources/base/media/{icon,startIcon}.png` | 图标位 |
| `AppScope/resources/base/element/string.json` | 应用名（待统一） |

## 9. 与规格交叉引用

| FR | 落点 |
|---|---|
| FR-013-001/002/003/004/005 | `scripts/brand-assets.mjs` |
| FR-013-006/007/008 | `assemble-payload.mjs#applyWebBranding` |
| FR-013-009 | `payload/env.js` |
| FR-013-010 | 页面 Logo（⬜，方案 D4） |
| FR-013-011 | 应用名（⬜，待定名） |
| FR-013-012 | 首屏标记（⬜，未实现） |
