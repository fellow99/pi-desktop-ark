# 已知坑：cwd 与沙箱路径（2026-10-17 真机实测）

设备：HAD-W24 / `7.0.0.107(SP7C00E100R13P5)` / API 26。应用：`org.fellow99.pi.PiDesktopArk`。

## 1. 沙箱根只有**一个**基座：`context.filesDir`

应用沙箱根的**唯一事实源**是 `context.filesDir` = `/data/storage/el2/base/haps/entry/files`。
派生根（默认工作目录 `pi-cwd`、数据根 `pi-agent`、工作区根 `workspace`）一律 `<filesDir>/<名字>`。

**踩过的坑**：基座少取一层（把 `…/el2/base` 当基座再加 `/files`）会得到
`/data/storage/el2/base/files/workspace` —— 它**不是** `filesDir` 的前缀关系，目录也不存在，
表现为目录选择器打开即 404（`GET /api/cwd/browse?path=…` → `{"error":"Directory does not exist"}`），
用户只能手打绝对路径。旧壳 `pi-desktop-hos/src-main/main.js` 的 `join(userData,'workspace')`
（`userData` 在鸿蒙上就是 `…/el2/base/files`）就是这种形态的来源。

**现在的护栏（C2，启动即见）**：

| 层 | 位置 | 行为 |
| --- | --- | --- |
| ArkTS | `entry/src/main/ets/common/Constants.ets#sandboxRoot()` / `#checkSandboxRoot()` | 单一派生点；启动时 `Log.info('沙箱基座：…')`，不以 `filesDir` 为前缀则 `Log.error('沙箱基座断言失败：…')`，并进诊断串 `sandboxBase` |
| Node 侧 env | `payload/env.js#buildRoots()` | `PI_HOS_ROOTS` 的 `sandbox` 项不在 `HOME` 之内时 `[env]` 警告（不改写值） |

## 2. 同一个目录有**两种写法**；API 认 el2 别名

| 写法 | 形态 | 谁看得见 |
| --- | --- | --- |
| el2 别名 | `/data/storage/el2/base/haps/<module>/files/…` | 应用自己（`context.filesDir` 就是这个形态） |
| `hdc shell` 视角 | `/data/app/el2/<uid>/base/<bundle>/haps/<module>/files/…` | 开发者在设备上 `ls` 到的是这个 |

真机上把 `hdc` 写法直接交给 API 曾经一律 **400** `Directory does not exist`（`app/api/cwd/validate`、
`app/api/agent/new` 把路径直接交给 `statSync`/`existsSync`）。现在补丁 `patches/v0.12.1/0003-*`
在三条 cwd 路由（`cwd/validate`、`cwd/browse`、`agent/new`）进入判定**之前**把
`/data/app/el2/<uid>/base/<bundle>/haps/<module>/files` 前缀换成 `HOME`（= `context.filesDir`）：
以 HOME 为锚、不硬编码 bundle/uid、纯字符串重写 ⇒ **幂等**（el2 形态不再匹配）且**可逆**
（不写盘、不缓存；响应回显 el2 形态，是同一个真实目录）。

映射做不到时（HOME 不是 el2 形态）路径**原样**返回，并在 400 里带 `hint`
（`received=… expected=… normalized=el2-alias pi-hos-sandbox-alias`），不静默改写。

## 3. 目录选择器的「沙箱」入口来自 `PI_HOS_ROOTS`

`GET /api/cwd/browse?root=<id>` 列宿主声明的主目录（`sandbox`/`desktop`/`documents`/`download`）；
无 `root`、无 `path` 的裸打开落在 `sandbox` 根上（该根不存在时才退回 `homedir()`）。
未知 `root` id 报 **400** 并列出已声明的 id；已声明但目录不存在的根报 **404** 且带
`code=ENOENT` + `rootId` + `rootPath`（「是谁声明的」比「不存在」更重要）。两者都不静默换成别的根。
