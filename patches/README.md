# `patches/` —— 本工程消费的上游补丁集（被 patch 的是 **`pi-web`**）

> 纪律与 `pi-desktop-hos/patches/README.md` §「新增补丁时必须遵守的规则」**同一条**：
> 幂等（先 `--reverse --check`，命中即跳过）· 冲突即终止（绝不 `--3way`）· 可往返
> （应用 → 反向 → 受影响文件 SHA-256 逐条还原）· 按**被 patch 的上游 tag** 建目录 ·
> 只在**独立 detached worktree** 里生成 · 每条登记「触发条件 / 实施时机 / 替代方案」。

> **现状（2026-11-27）**：**6 条**补丁，`patches/v0.11.1/` `v0.12.1/` `v0.13.0/` `v0.14.1/` `v0.14.2/` `v0.15.0/` `v0.17.0/` `v0.18.0/` 保留可追溯，当前目录 **`patches/v0.19.0/`**（被 patch 的上游 `pi-web` tag `v0.19.0` `7b77aa1a`）。
> **301 退场（2026-11-24）**：`0007-sync-daemon-settings-tab` 已移除（中枢服务同步对接由 `pi-desktop` 单独提供，本工程不再内嵌 sync-daemon）；故目录内编号保留空洞（0006 早在 v0.12.1 并入 0005，0007 本轮退役），不复用既有编号。
> **v0.14.1 重出记录**：上游 **#1462** 在 `components/DirectoryPicker.tsx` 新增 backdrop 按下追踪
> （`backdropPressRef`/`createBackdropPressRef`）并把 `canSelect` 并入 `!loading`、移除 `canCreate`，
> 致 `0005-directory-picker-contract` 与 `0006-directory-picker-permission-flow` **上下文漂移**；
> 已在独立 detached worktree 上**重出**（**保留** #1462 修复语义，在其上重放主目录 Tab 契约 / 权限流），
> `0001/0002/0003/0004` 为 `v0.13.0/` 同内容拷贝。全栈在 pristine v0.14.1 上按序 `git apply` 全 PASS、
> 反向往返回 pristine 全 PASS；`assemble-payload.mjs` `PI_WEB_PATCH_TAG=v0.14.1`。
> **v0.14.2（2026-11-04）**：补丁领域 6 个文件在 v0.14.1→v0.14.2 均无变更 ⇒ `patches/v0.14.1/` 六条直接拷贝为 `patches/v0.14.2/`（逐字节相同），零漂移；已在本轮 pristine v0.14.2 上按序应用 + 反向往返回 pristine PASS；`assemble-payload.mjs` `PI_WEB_PATCH_TAG=v0.14.2`。
> **v0.15.0（2026-11-05）**：上游唯一补丁领域交集是 session-export（`1fbf6c6` 删除被 pi 1.5.0 迭代模板废弃的 `patchExportHtml()`），与本工程 `0004-session-export-runtime-identity-guard` 的 `exportSession()` 改动区域**不重叠** ⇒ `patches/v0.14.2/` 六条直接拷贝为 `patches/v0.15.0/`（逐字节相同）；已在 pristine v0.15.0 上按序累计 dry-run 全绿（14/14，含 hos/android 集合）；`assemble-payload.mjs` `PI_WEB_PATCH_TAG=v0.15.0`。

目录名 = 被 patch 的那一侧的上游 tag（当前 **`v0.19.0`**，即 `pi-web` `7b77aa1a`）。
上游升级时**新建目录**、旧目录保留可追溯，并同步
`scripts/assemble-payload.mjs` 的 `PI_WEB_PATCH_TAG`。


## 0.0 v0.19.0 rebase 记录（2026-11-27）

| 项 | 内容 |
|---|---|
| 上游基线 | `pi-web` tag **`v0.19.0`**（`7b77aa1a01a74597280dd5bbc9221195411bddf4`，annotated tag `e5192a7557f73dadea42a76aab785f65597f2197`，`Release v0.19.0`）· `pi` tag **`v1.6.1`**（`ef4a1cfcca62b77ad3558337ff3e1c7f6beeadfe`） |
| 生成方式 | 独立 detached worktree `git worktree add --detach ../.tmp/wt-019 v0.19.0`；逐条 `git apply`（冲突条目手工重放）→ `git add` → `git commit` → `git diff HEAD^ HEAD > patches/v0.19.0/<同名>.patch`；**未经 PowerShell 重定向**，全目录 **UTF-8 / LF** |
| 上游变更（v0.18.0→v0.19.0） | 284 文件，+8976/−2383，44 提交 |
| 冲突与处置 | 见下「本轮变更」 |
| 验证 | ① pristine v0.19.0 上按文件名排序逐条 `git apply --check` + `git apply` 全绿（6/6）；② 反序 `git apply --reverse` 后 `git status --porcelain` 为空 |

### 本轮变更

| 补丁 | 变更 |
|---|---|
| `0001-terminal-capability-unsupported` | **导入重定位**：上游 #1757 给 `app/api/terminal/route.ts` 加了 `import { errorMessage } from "@/lib/errors"`，正好落在本补丁插入 `terminalCapability` 导入的位置。本轮改为插在 `errorMessage` 之后，`GET()` 与 `POST` 能力门位置不变 |
| `0002-cwd-sandbox-root-from-hos-roots` | 无冲突，逐字节沿用 |
| `0003-cwd-hdc-path-alias-normalize` | 无冲突，逐字节沿用 |
| `0004-session-export-runtime-identity-guard` | 无冲突（上游改动只在 `Content-Disposition` 抽函数处），逐字节沿用 |
| `0005-directory-picker` | **1 处上下文冲突**：同 HOS `0001`，上游把 `components/DirectoryPicker.tsx` 的 `createDirectory` 改用 `readJsonOrThrow` 并把两处错误处理改为 `errorMessage(cause)`。处置：`--exclude=components/DirectoryPicker.tsx` 应用其余文件后，在 v0.19.0 上重放该文件（上游 4 处改动逐一采纳；`loadDirectories` 仍保留本补丁的 `BrowseError`，需读回 `code`/`permission`/`canRequest`）。补丁 43570 B |
| `0008-system-back` | 无冲突（上游 `components/AppShell.tsx` +45/−22 不在本补丁上下文区间），逐字节沿用 |

## 0.0b v0.18.0 rebase 记录（2026-11-22）

| 项 | 内容 |
|---|---|
| 上游基线 | `pi-web` tag **`v0.18.0`**（`2daa0d131eae6c2fd8c2a80872eee01ea3c7a0a1`，annotated tag `38bb6805`，`Release v0.18.0`）· `pi` tag **`v1.6.0`**（`faac585884ae2c013a6b1400f3e9e77f10b34bac`） |
| 生成方式 | 独立 detached worktree `git worktree add --detach ../.tmp/wt-018 v0.18.0`；逐条 `git apply`（冲突条目手工重放）→ `git add` → `git commit` → `git diff HEAD^ HEAD > patches/v0.18.0/<同名>.patch`；**未经 PowerShell 重定向**，全目录 **UTF-8 / LF** |
| 行尾口径修正 | v0.17.0 目录下 19 条补丁中 15 条为 **CRLF**（`pi-desktop/0001` 与四条 `sync-daemon`/`system-back` 系为 LF）。在 LF 工作树（WSL/Linux）上 `git apply` 对 CRLF 补丁必然失败，只有 Git-for-Windows（`core.autocrlf=true`）能容错。本轮起**统一 LF**，与「UTF-8 / LF」纪律一致，并已在 LF 环境下逐条验证可应用 |
| 上游变更（v0.17.0→v0.18.0） | 127 文件，+4874/−946，34 提交 |
| 冲突与处置 | 见下「本轮变更」 |
| 验证 | ① pristine v0.18.0 上按文件名排序逐条 `git apply --check` + `git apply` 全绿；② 反序 `git apply --reverse` 后 `git status --porcelain` 为空（受影响文件 SHA-256 逐条还原） |

### 本轮变更

| 补丁 | 变更 |
|---|---|
| `0001-terminal-capability-unsupported` | **重定位**：上游 #1750 在 `app/api/terminal/route.ts` 顶部新增 `import { cwdMissingBody } from "@/lib/missing-cwd"` 并把 `stat(cwd)` 包进 try/catch 返回 400，致原 hunk 上下文漂移。本轮把能力门的 `import { terminalCapability }` 插到 `cwdMissingBody` 之后、`createTerminal` 之前，`GET()` 与 `POST` 能力门位置不变。语义与上游不重叠（上游判 cwd 存在性，本补丁判 PTY 能力） |
| `0002-cwd-sandbox-root-from-hos-roots` | 无冲突，重新生成 |
| `0003-cwd-hdc-path-alias-normalize` | 无冲突，重新生成 |
| `0004-session-export-runtime-identity-guard` | **删除冗余 hunk 片段**：上游 #1695 已自行加 `/* webpackIgnore: true */`，故本轮保留首 hunk（`runtimeIsSpawnable` 运行时判据）与 `console.warn` 诊断块，删去重复的 import 行改写与 4 行中文说明 |
| `0005-directory-picker` | 无冲突，重新生成 |
| `0008-system-back` | 无冲突，重新生成 |

## 0. 已登记补丁

### `PTY-1` — 终端路由把「平台没有 PTY」报成结构化能力缺失，而不是 500 模块加载错误

| 项 | 内容 |
|---|---|
| 文件 | `patches/v0.12.1/0001-terminal-capability-unsupported.patch`（7,514 B；sha256 `a4589e698cf6cc230c79d2a37687b9efd75bc68d09a3b12aa9813656e4035221`；LF；UTF-8） |
| 全局编号 | `PTY-1`（只增不改、不复用；能力降级补丁，不挂编号需求） |
| 被 patch 的上游 | `pi-web` tag **`v0.12.1`**（`f83b1a502f8e434555a7153fe08e1c135dd65ca9`，与 `Branch_v0.12.1` HEAD 相同） |
| 触及文件（2） | `app/api/terminal/route.ts`（新增 `GET` 能力查询 + `POST` 前置能力门 ⇒ 501）、`lib/terminal-capability.ts`（**新增**，能力事实源与实测 evidence） |
| **触发条件** | 设备上 `POST /api/terminal` 一律 500，`error` 为 `Cannot load the node-pty native terminal module for openharmony-arm64`。平台事实（`pi-desktop-hos/docs/鸿蒙环境能力清单-v0.11.1.md` §REV-2 真机实测）：`/proc/mounts` 325 行里 `devpts` 命中 **0**、`/dev` 是 `devfs`、`/dev/ptmx` 打开返回 `EACCES` ⇒ **平台没有 PTY 设施**，node-pty 永远装不上，重编/重试都不会改变。把「平台能力缺失」报成 500 加载错误会让调用方（和排查者）一直往「装依赖」的方向走。 |
| **实施时机** | `000-scaffold` 收尾（2026-10-17，轮次 5）：应用侧早已把 `terminal.pty = unsupported` 写进能力串（`HostCapabilities.capabilitiesJson()`），但**上游 HTTP 面**仍是 500；本轮把它补上。由 `scripts/assemble-payload.mjs` 在**载荷组装期**幂等应用（见 §1）。 |
| **替代方案** | ① 只在壳侧改文案（诊断面板显示「终端不可用」）：`/api/terminal` 仍对任何调用方返回 500，事实没变（已否决）；② 在 payload 覆盖层里改编译产物（`.next/server/app/api/terminal/route.js`）：那不是上游补丁，升级即碎（已否决）；③ 伪造一个假 PTY：平台没有 `devpts`，做不到，且属「伪造支持」（已否决）。 |
| 语义 | `supported:false` 是**前置门**：`process.platform` ∈ {`openharmony`,`harmonyos`} 时 `POST` 直接返 **501**（不进入 `createTerminal`，因此**永远不会**把原生加载错误抛给客户端）；其余平台走**上游原路径**（失败仍是上游的 500 + 修复指引），行为逐字节不变。`GET /api/terminal` 返回 **200** + 能力标志（与 `/api/web-auth` 的「200 + 标志位」同形；无副作用，供探活/诊断用）。 |
| 状态码为什么是 501（读调用方定的） | 唯一调用方是 `components/TerminalPanel.tsx:191` → `lib/terminal-client.ts#terminalRequest`：`if (!response.ok) throw new Error(data.error ?? …)`，面板 `setError(reason.message)`。所以 `POST` **必须**非 2xx（否则面板会把 `{ok:false}` 当成成功去连 SSE），并且要在 `error` 里给一句人读文案；`501 Not Implemented` 表达「请求合法、本平台无实现可能」，与 400（参数）/403（授权）/500（服务器出错）都区分开。 |
| 往返校验 | 生成时在独立 detached worktree 上验：`git apply --check` 通过 · 应用 → `--reverse --check` 命中（幂等判据）· 应用 → 反向 → `sha256sum` 与 pristine 逐条相同。运行时由 `assemble-payload.mjs` 每次重跑同一套断言，失败即 `exit 2`。 |
| 生成方式 | `git -C ../pi-web worktree add --detach <scratch>/piweb-patch v0.12.1` → 改文件 → `git add -A && git diff --cached > patches/v0.12.1/0001-…patch` → `worktree remove --force`（`../pi-web` 工作树全程零改动）。 |
| 回退方式 | `git -C ../pi-web apply --reverse patches/v0.12.1/0001-terminal-capability-unsupported.patch` |
| 规格 | `pi-desktop-ark/logs/20261016-1/DEV_CHECKLIST.md` §R5、`pi-desktop-hos/docs/鸿蒙环境能力清单-v0.11.1.md` §REV-2 |

### `CWD-1` — 目录选择器的「沙箱」入口取宿主声明的根（`PI_HOS_ROOTS`），不再按父级猜

| 项 | 内容 |
|---|---|
| 文件 | `patches/v0.12.1/0002-cwd-sandbox-root-from-hos-roots.patch`（6,089 B；sha256 `2e37b2ed3fbc5260ac5f0f6f5c033e1447cf119771a1ccb83d246cc88e9cf9a4`；UTF-8） |
| 全局编号 | `CWD-1`（只增不改、不复用；缺陷修复补丁，不挂编号需求） |
| 被 patch 的上游 | `pi-web` tag **`v0.12.1`**（`f83b1a5`） |
| 触及文件（2） | `lib/directory-browser.ts`（新增 `getWorkspaceRoots()`/`findWorkspaceRoot()`；`getBrowseStartDirectory()` 裸打开时用宿主声明的 `sandbox` 根）、`app/api/cwd/browse/route.ts`（新增 `?root=<id>`，未知 id → 400、已声明但不存在 → 404 带 `rootId`/`rootPath`） |
| **触发条件** | 工作区根的**唯一事实源**是宿主应用（ArkTS 侧 `context.filesDir`），上游只认 `homedir()`：选择器只能从沙箱**父级**一层层点进 `workspace`。任何「按父级再拼一个 `workspace`」的写法都会拼出 `…/el2/base/files/workspace`（少了 `haps/<module>`），真机 `GET /api/cwd/browse?path=…` → **404**，用户只能手打绝对路径。 |
| **实施时机** | 本轮缺陷修复（2026-10-17）：由 `scripts/assemble-payload.mjs` 在载荷组装期幂等应用（见 §1）。 |
| **替代方案** | ① 让宿主改 `homedir`：`homedir()` 是库注入的 `HOME`，改它会把 `pi-agent`/`pi-cwd` 等所有派生路径一起挪走（已否决）；② 在 ArkWeb 侧注入 JS 覆盖选择器起点：绕过 API 且随页面重构即碎（已否决）；③ 只报 400 + 提示：用户仍无法一键到达沙箱根（已否决）。 |
| 语义 | `root` 缺失且无 `path` 时：宿主声明的 `sandbox` 根**存在**就落在它上面，不存在退回 `homedir()`（不让选择器停在死目录）；响应新增 `rootId`/`rootPath`，与原状字段并存（向后兼容）。 |
| 生成方式 | `git -C ../pi-web worktree add --detach <scratch>/piweb-patch2 v0.12.1` → 改 → `git diff`（生成后 `worktree remove --force`，`../pi-web` 工作树零改动） |
| 回退方式 | `git -C ../pi-web apply --reverse patches/v0.12.1/0002-cwd-sandbox-root-from-hos-roots.patch` |
| 规格 | `specs/104-host-capabilities-arkts-impl/spec.md` FR-104-026、`docs/已知坑-cwd与沙箱路径.md` |

### `CWD-2` — `hdc shell` 视角的沙箱路径（`/data/app/el2/…`）改写为 el2 别名后再判定

| 项 | 内容 |
|---|---|
| 文件 | `patches/v0.12.1/0003-cwd-hdc-path-alias-normalize.patch`（9,177 B；sha256 `e4cc65c09583298a3dd9f0e1e7fffc42fcdd391e5ac2a42ebe1aec9a30d1acce`；UTF-8） |
| 全局编号 | `CWD-2`（只增不改、不复用；缺陷修复补丁） |
| 被 patch 的上游 | `pi-web` tag **`v0.12.1`**（`f83b1a5`） |
| 触及文件（4） | `lib/hos-sandbox-path.ts`（**新增**：`normalizeHosSandboxPath()` / `describePathForms()`）、`app/api/cwd/validate/route.ts`、`app/api/cwd/browse/route.ts`、`app/api/agent/new/route.ts`（三条 cwd 路由在判定前归一） |
| **触发条件** | 同一个沙箱目录有两种写法：应用认 el2 别名 `/data/storage/el2/base/haps/<module>/files/…`，而开发者在 `hdc shell` 里看到的是 `/data/app/el2/<uid>/base/<bundle>/haps/<module>/files/…`。后者以前一律 **400** `Directory does not exist`（路由把路径直接交给 `statSync`/`existsSync`），把「合法路径」报成「目录不存在」，排查方向从一开始就错。 |
| **实施时机** | 本轮缺陷修复（2026-10-17），与 `CWD-1` 同批应用（`0003` 上下文按 `0002` 之后生成）。 |
| **替代方案** | ① 只在 400 里加提示、不归一：用户仍要手改路径（已否决；本轮取归一，提示同时保留）；② 在宿主侧改写请求体：宿主不在 HTTP 链路上（已否决）；③ 硬编码 uid/bundle：设备/安装形态一变就失效（已否决）。 |
| 语义 | 以 `HOME`（= `context.filesDir`）为锚做**纯字符串重写**：幂等（el2 形态不再匹配）、可逆（不写盘、不缓存，响应回显 el2 形态）、不猜测（`HOME` 不是 el2 形态则原样返回）。400 仍在，并带 `hint`（`received=… expected=… normalized=el2-alias`）。 |
| 生成方式 / 回退方式 | 同上（`--reverse patches/v0.12.1/0003-cwd-hdc-path-alias-normalize.patch`） |
| 规格 | `docs/已知坑-cwd与沙箱路径.md` §2 |

### `FENCE-1` — 目录选择器移除手输路径入口，闭合根围栏（FR-203-007）

| 项 | 内容 |
|---|---|
| 文件 | `patches/v0.15.0/0007-directory-picker-root-fence.patch`（只含 `components/DirectoryPicker.tsx`） |
| 全局编号 | `FENCE-1`（只增不改、不复用；安全属性补丁，挂需求 203） |
| 被 patch 的上游 | `pi-web` tag **`v0.15.0`**（`f130910`），**在 `0006` 之后**（基线 = 0006 应用后的 `DirectoryPicker.tsx`） |
| 触及文件（1） | `components/DirectoryPicker.tsx`：移除 `pathInput` state、`handlePathSubmit`、路径表单 + Go 按钮；`canSelect` 简化；标题栏改为返回按钮 + 只读当前路径，保留「返回上级」 |
| **触发条件** | 0005/0006 的「主目录 Tab + 授权门」已上线，但 **`pathInput` 表单仍可用**：用户可键入任意绝对路径（如 `/`）沿 `?path=` 浏览越出根围栏；而本模块代码注释与 hos 规范（FR-203-007）都宣称「无手动路径输入」—— 代码与声明的安全属性不一致。 |
| **实施时机** | 评审修复（2026-11-07，需求 203 轮）；由 `scripts/assemble-payload.mjs` 载荷组装期幂等应用（`0007` 排最后）。 |
| **替代方案** | ① 就地禁用 input（`disabled`）仍会渲染输入框（误导）；② 只藏 Go 按钮、留回车提交（仍有提交点）；③ 在路由层拒绝任意 `path`（会破坏 pi-web 其它合法用法，也仍留下表单残留）。移除表单是最小且语义一致的闭合。 |
| 往返校验 | pristine v0.15.0 按序 0001…0007 全 PASS；0006 态上正向 → `--reverse --check` 命中（幂等）→ 反向 → 与 0006 态字节一致。 |
| 版本回填 | `v0.14.1/` `v0.14.2/` 的 `DirectoryPicker.tsx` 基座与 v0.15.0 逐字节相同 ⇒ 0007 逐字节拷贝回填；`v0.12.1/` `v0.13.0/` 基座不同（旧式 `canCreate` / 无 `backdropPressRef`），**未回填**（历史 tag 不再构建）。 |
| 规格 | `specs/203-plugin-workspace-picker/` |

## 1. 构建脚本如何消费本目录（已实现，2026-10-17）

`scripts/assemble-payload.mjs` 在 `--apply` 时、**打包 tar.gz 之前**执行「上游补丁阶段」：

```
① 幂等应用 patches/<PI_WEB_PATCH_TAG>/*.patch（按文件名排序，确定性）
   ├ git apply --reverse --check 命中 → 已应用，skip（幂等）
   ├ 否则 git apply --check 命中 → 记录受影响文件 SHA-256（补丁新增的文件记为 null）
   │    ├ git apply → git apply --reverse → 断言 SHA-256 逐条还原（不等即 exit 2）
   │    └ git apply（正式生效）
   └ 两者都失败 → exit 2（绝不 --3way）
② 载荷里没有标记「terminal.pty」⇒ 用**打了补丁的源码**重新编译 pi-web
   （next build --webpack，node 由 --pi-web-node 指定），再把 .next 镜像进 --from（默认 pi-dist）；
   镜像后仍无标记 ⇒ exit 2（不产出「看起来只是没打补丁」的载荷）
③ 打包 → 收尾把 pi-web 还原成 pristine（--keep-patches 可留）
```

因此载荷**不依赖手改 `../pi-web` 工作树**：源码补丁 + 重新编译 + 产物断言三件事都在同一条命令里。
