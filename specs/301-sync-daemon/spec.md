# 301 — 中枢服务同步（sync-daemon 内嵌）功能规格【pi-desktop-ark】

> 需求编号 `301-sync-daemon`（跨端）。行为基准：`pi-desktop/specs/301-sync-daemon/spec.md`
> （FR-301-001~023）＋第二轮改版（设置并入 pi-web，D18–D20）。
> 本文件定义 **HarmonyOS Edition（ArkWeb + 进程内 Node）** 的实现口径。

## 1. 目标与范围

- 在 **ark 版**内嵌 `@pi-agent-hub/sync-daemon@0.1.2` + `@pi-agent-hub/sync-plugin-pi-web@0.1.2`，
  把本机 pi 会话上行到中枢并接收下行事件。
- 设置入口：**pi-web 设置对话框最后的「中枢服务」分区**（构建期补丁），不新增原生设置页。
- **不使用独立进程**：ark 的应用内 Node 无可用 `fork/exec`（`node -e` 触发 L1 seccomp `Signal 31`），
  daemon 与插件 MUST 在同一 Node 运行时内运行。

## 2. 与桌面版的差异

| 项 | pi-desktop | **pi-desktop-ark** |
|---|---|---|
| daemon 运行 | 子进程 | **同进程**（`payload/pi-web-launch.js` 的 Node） |
| 插件通信 | stdio JSON-RPC 子进程 | 直接 import `PiWebPlugin`（方法调用，无 stdio） |
| 启动点 | pi-web 就绪后 | 同（写 `pi-web.ready.json` 之后） |
| 设置桥 | preload + IPC | **同源 HTTP** `/api/sync-daemon`（补丁 route） |
| 崩溃处理 | 子进程隔离 | MUST NOT 安装 `process.exit` 全局钩子；循环错误只记状态/日志 |

## 3. 功能需求

- **FR-301-121**：pi-web 就绪后 MUST 按 `enabled` 在同一 Node 运行时启动同步；MUST NOT 阻塞首屏。
- **FR-301-122**：MUST 复用上游 `Daemon`（hub/调度/SSE/下发/串行化），但 MUST NOT 走会安装全局
  `process.exit` 崩溃钩子的 `daemon.start()`；MUST 使用嵌入式启动序列。
- **FR-301-123**：插件 MUST 进程内直连（`PiWebPlugin` + 方法表），MUST NOT spawn/stdio。
- **FR-301-124**：配置 MUST 落 `<HOME>/.pi-desktop/sync-daemon.json`（SyncDaemonConfig + enabled）；
  `pluginRoot=<HOME>/.pi-desktop/sync-daemon`，`pluginInstall=false`，运行时注入 server/agentDir/password。
- **FR-301-125**：设置 UI MUST 为 pi-web 设置对话框「中枢服务」分区（状态灯/三字段/令牌/开关/应用），
  三套 locale；MUST 由构建期补丁交付。
- **FR-301-126**：设置数据 MUST 走同源 `GET/PUT /api/sync-daemon`；route 代理本地控制面，令牌不下发页面。
- **FR-301-127**：应用 MUST 校验 → 原子写 → 停旧 → 按 enabled 重启；错误可读、不覆盖原配置。
- **FR-301-128**：状态 MUST 为 running/starting/disabled/stopped(reason)；绿=运行时存活，不代表中枢连通。
- **FR-301-129**：宿主退出 MUST 停止同步（定时器/SSE/控制面）；MUST NOT `process.exit`。
- **FR-301-130**：依赖固定 0.1.2，随 payload `node_modules` 分发；运行期不 npm install。
- **FR-301-131**：pi-web 改动以 `patches/v0.17.0/` 幂等补丁交付，构建后回退 pristine。

## 4. 非功能

- 同进程：同步循环串行、不得阻塞 HTTP/WebView；控制面仅 127.0.0.1 + Bearer；配置 0600；日志脱敏。
- 兼容：ark Node 24.13；`fetch`/`AbortSignal.timeout`/ESM 动态 import 可用。
- 内存：长进程 + 大上传时监控 RSS（上游 0.1.2 有高内存告警日志）。

## 5. 场景

- S1：首屏 → 设置 ›「中枢服务」→ 运行中；hub 出现本 host 与会话。
- S2：关闭启用 → 应用 → 停止/未启用。
- S3：地址错 → 红 + 日志；改对后恢复。
- S4：退出应用 → 无定时器/连接残留。
- S5：校验失败 → 拒绝且配置不变。

## 6. 落点与验证

- `payload/sync-runtime.js`（与 Android 同源）、`payload/pi-web-launch.js`、`scripts/assemble-payload.mjs`、
  `patches/v0.17.0/0007-sync-daemon-settings-tab.patch`、`patches/README.md`、文档口径。
- 交付前：补丁往返、`node --check`、payload 装配（含 `/api/sync-daemon` 标记断言）。
- 真机：交接方按 `D:\knowledge-base\pi-workspace\301-sync-daemon-测试交接安卓鸿蒙.md` 执行（hdc）。
