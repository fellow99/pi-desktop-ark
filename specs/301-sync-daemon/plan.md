# 301 — 中枢服务同步 技术实现方案【pi-desktop-ark】

> 与 `spec.md` 成对。行为基准：`pi-desktop/specs/301-sync-daemon/{spec,plan}.md`（D1–D20）。
> 本方案只解决「ark 无子进程」与「ArkWeb 设置数据面」两个差异。

## 1. 技术上下文

- 宿主：ArkTS `UIAbility` + **ArkWeb**；Node 由 `@fellow99/node-bridge` + `@fellow99/node-runtime`（Node 24.13）
  在**应用进程内**运行；`payload/pi-web-launch.js`（CJS）进程内起 Next，写 `pi-web.ready.json`。
- 无 Electron/Chromium；服务绑 loopback；`HOME` 为应用沙箱。
- 载荷：`scripts/assemble-payload.mjs` 把 `build/pi-dist` 裁剪为 `assets/pi-web/pi-web.tar.gz`。
- 上游包：`@pi-agent-hub/sync-daemon@0.1.2`、`@pi-agent-hub/sync-plugin-pi-web@0.1.2`。

## 2. 关键决策

| # | 决策 | 理由 |
|---|---|---|
| DK-1 | 同进程运行 daemon + 插件 | ark 子进程链路不可用（seccomp/`execve` 封死） |
| DK-2 | 复用 `Daemon`，替换 `manager`/`executor` | 复用 hub/调度/SSE/下发；避免自研 |
| DK-3 | 不走 `daemon.start()`，用嵌入式启动序列 | 上游 `start()` 安装 `process.exit` 崩溃钩子，嵌入会杀 App |
| DK-4 | 插件 `InProcessClient` | 直接 import `PiWebPlugin`，按 `dist/main.js` 方法表调用 |
| DK-5 | 设置 UI = pi-web 补丁 + `/api/sync-daemon` route | 与桌面一致；ArkWeb 无 Electron 桥；令牌不出服务端 |
| DK-6 | 配置 `<HOME>/.pi-desktop/sync-daemon.json` | 与桌面同构；pluginRoot/控制面隔离 |
| DK-7 | 依赖装入 pi-dist staging | 离线运行；keep `@pi-agent-hub/**` |

## 3. 组件与数据流

```
pi-web 设置 ›「中枢服务」（补丁 SyncConfig.tsx）
   │ fetch GET/PUT /api/sync-daemon（同源）
   ▼
app/api/sync-daemon/route.ts（补丁；读 control.json → 代理）
   ▼
payload/sync-runtime.js（控制面 127.0.0.1 + Bearer）
   ├─ 配置读写（0600/原子）
   ├─ 嵌入式 Daemon 启动序列
   └─ InProcessPluginManager + InProcessClient（PiWebPlugin）
```

- `payload/pi-web-launch.js`：ready marker 后 `startSyncRuntime(...)`（非阻塞）；shutdown 钩子 `stopSyncRuntime()`。
- route 标记 `pi-sync-daemon-route-v1` 供装配脚本断言。

## 4. 文件与落点

| 文件 | 动作 |
|---|---|
| `payload/sync-runtime.js` | **新增**（与 Android 同源） |
| `payload/pi-web-launch.js` | **改**：就绪启动 / 关停停止 |
| `scripts/assemble-payload.mjs` | **改**：payload 条目 + 安装 `@pi-agent-hub/*` + keep + 标记 |
| `patches/v0.17.0/0007-sync-daemon-settings-tab.patch` | **新增** |
| `patches/README.md` | **改**：登记 P301-K1 |
| `specs/301-sync-daemon/{spec,plan}.md` | **替换** |
| `docs/000-工程规划.md`、`README(_zh).md`、`specs/README.md` | **改**：口径/补丁数 |

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 同进程阻塞 | 上游串行化；异步控制面；交接方观测首屏/交互 |
| `Daemon` 内部字段随上游变化 | 固定 0.1.2；升级复核；补丁 README 记录 |
| 无全局崩溃钩子导致同步错误静默 | 运行时捕获并落状态/日志，不阻塞主流程 |
| 依赖被裁剪 | keep `@pi-agent-hub/**` + 装配后入口断言 |
| Ark 设备内存/长进程 | 观察 RSS；上游已有高内存告警 |

## 6. 验证

- 静态：补丁往返、`node --check`、装配（标记/入口断言）。
- 真机（交接）：安装 HAP → 设置配置 → hub 观察 `sse`/会话 → 禁用/恢复 → 退出清理。
