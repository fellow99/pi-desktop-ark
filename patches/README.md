# `patches/` —— 本工程消费的上游补丁集（被 patch 的是 **`pi-web`**）

> 纪律与 `pi-desktop-hos/patches/README.md` §「新增补丁时必须遵守的规则」**同一条**：
> 幂等（先 `--reverse --check`，命中即跳过）· 冲突即终止（绝不 `--3way`）· 可往返
> （应用 → 反向 → 受影响文件 SHA-256 逐条还原）· 按**被 patch 的上游 tag** 建目录 ·
> 只在**独立 detached worktree** 里生成 · 每条登记「触发条件 / 实施时机 / 替代方案」。

目录名 = 被 patch 的那一侧的上游 tag（当前 **`v0.12.1`**，即 `pi-web` `f83b1a5`）。
上游升级时**新建目录**、旧目录保留可追溯，并同步
`scripts/assemble-payload.mjs` 的 `PI_WEB_PATCH_TAG`。

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
