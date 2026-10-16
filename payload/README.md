# `payload/` —— 本工程的 **Node 侧载荷**（不是 ArkTS 代码）

这里的东西**全部在 Node 侧运行**，由库的 bootstrap 在进程内 Node 线程里 `require`。
它们的投放位置是 `entry/src/main/resources/resfile/pi-web/`（路线 ① 只读直读，见 `scripts/assemble-payload.mjs`），
与 `pi-dist` 的裁剪产物**放在同一个载荷根**里。

## 布局

```
payload/
├── pi-web-launch.js          # Node 侧入口（库的 bootstrap 按 entry 解析后 require 它）
├── env.js                    # 环境契约的**唯一事实源**（应用语义变量）
├── config/
│   ├── settings.json         # pi 预置 settings（shellPath / defaultTools / defaultProjectTrust=ask）
│   └── mcp.json              # pi 预置 MCP 服务器表（空）
├── extensions/               # 壳专用扩展：以**同名工具**顶替 pi 内建实现（原样搬自旧壳）
│   ├── harmony-exec.js       # bash  → /system/bin/sh 常驻 + 随机哨兵行（不依赖 spawn 完成事件）
│   ├── harmony-search.js     # find/grep → 纯 JS 遍历（设备上无 fd/rg 且 PI_OFFLINE=1）
│   ├── harmony-runtime.js    # /harmony-info 命令（运行时事实与工具可用性自报）
│   └── harmony-workspace-roots.js # /roots 命令（工作区主目录解析与可读性/授权状态）
└── README.md                 # 本文件
```

> `config/` 与 `extensions/` 由 `pi-web-launch.js`（或 Phase 2 的宿主桥）**copy 到** `PI_CODING_AGENT_DIR`
> 下才会被 pi 拾取（`<filesDir>/pi-agent/{settings.json,mcp.json,extensions/}`）。
> 设备侧 `symlink` 不可用（应用域 EACCES），一律 **copy 物化**，绝不建软链。

## 环境契约（§7.4 的「本工程负责」那半边）

`env.js#buildEnv(base)` 是名字与语义的**唯一事实源**；`pi-web-launch.js` 在启动时调用它把结果
写回 `process.env`，并把最终值打进 `[env]` 日志（错了才查得动）。

| 变量 | 值 | 谁设 |
|---|---|---|
| `PI_CODING_AGENT_DIR` | `<HOME>/pi-agent`（会话/凭据/扩展落点） | 本工程（`env.js`） |
| `PI_OFFLINE` | `1`（设备无 npm/git ⇒ 只走本地源） | 本工程 |
| `NO_PROXY` / `no_proxy` | 追加 `127.0.0.1` / `localhost` / `::1`（保留继承值） | 本工程 |
| `PI_HOS_ROOTS` | 工作区主目录 JSON（选择器结果优先，缺席则用沙箱+三用户目录兜底） | 本工程 |
| `PI_WEB_HOSTNAME` / `PI_WEB_PORT` | 路线 ①：`127.0.0.1` + `0`（**由 Node 侧探空闲端口并回报**） | 本工程 |
| `PI_WEB_PASSWORD` | 路线 ① **不设**（loopback 免密）；路线 ② 由宿主生成强密码 | 本工程 |
| `PI_WEB_SKIP_VERSION_CHECK` / `PI_WEB_APP_NAME` | `1` / `Pi Desktop`（**用上游开关**，零上游改动） | 本工程 |
| `HOME` / `TMPDIR` / `TMP` / `TEMP` / `NODE_ENV` / `NODE_OPTIONS` | — | **库**（`env.js` 刻意不设，见其文件头注释） |

## 怎么被走到（从 ArkTS 到这里的链路）

```
EntryAbility.onWindowStageCreate → loadContent('pages/Index')          # 先 loadContent（⑪）
  → PiDesktopRuntime.launch(context, flags)
      → NodeRuntime.start(context, {
            entry: 'pi-web/pi-web-launch.js',      # 路线 ①：相对 readonlyRoot
            readonlyRoot: context.resourceDir,     # 安装目录下的 resources/resfile
            payloadRoot: <filesDir>/payload,       # Node 可写根
            env: { PI_* … },                       # ← 与 env.js 同一批名字
        })
      → 库：dlopen libnode.so → node::Start → （bootstrap 解析 entry）→ require('pi-web-launch.js')
      → 本入口：env → 端口 → 进程内 Next → /api/web-auth 就绪 → 写 pi-web.ready.json + 日志行
  → ArkTS：waitUntilRunning → 读 marker/日志拿**真实端口** → HTTP 探活 → markRunning → ArkWeb loadUrl
```

## 日志的读回方式

- **载荷自己的通道**：`<filesDir>/payload/app.log`（`pi-web-launch.js` 追加写，含 `[pi-web]` 前缀）。
  为什么必须另开一路：库的 stdio 通道会把 **ArkWeb 原生输出**混进 `node.log`（硬约束 ⑱）。
- **库的通道**：`<filesDir>/payload/node.log`（`out|err|sys` 行；ArkTS 侧 `Logger.tail(path, n)` 读回）。
- **端上命令行读回**（取证用，应用域日志 `hdc` 读不到，必须走 HTTP）：
  ```bash
  hdc fport tcp:<port> tcp:<port> && curl -s http://127.0.0.1:<port>/log
  ```
  其中 `<port>` 从就绪 marker（`<filesDir>/payload/pi-web.ready.json`）或诊断面板读出。
