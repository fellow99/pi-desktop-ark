# Pi Desktop · HarmonyOS Edition（`pi-desktop-ark`）

> **定位：HarmonyOS Edition**（HarmonyOS 版）—— Pi Desktop 的两个鸿蒙版别之一；另一个是 `pi-desktop-hos`
> （**Electron on HarmonyOS Edition**，Electron-on-鸿蒙运行时）。本版**不带任何 Chromium/Electron**：
> **进程内 Node.js 运行时**（`@fellow99/node-bridge`）+ 端上 `pi-web` 服务 + **ArkWeb** 渲染前端；
> 功能目标是与 Electron on HarmonyOS 版对齐。

| 项 | 值 |
| --- | --- |
| 版别 | **HarmonyOS Edition**（`pi-desktop-ark`） |
| 应用名（桌面/窗口标签）/ 包名 | Pi Desktop Ark / `org.fellow99.pi.PiDesktopArk` |
| 目标设备 | `2in1` / `tablet` / `phone` / `tv`（同一产物，四种形态均已声明；已在 2in1、tablet、phone 真机验证） |
| 后端 | `@fellow99/node-bridge` 起的 Node v24.2.0（进程内，`dlopen` + `node::Start`） |
| 前端 | ArkWeb 加载 `http://127.0.0.1:<port>/`（页面由本地服务渲染，同源零 CORS） |
| 当前状态 | **骨架**：依赖接线与编译构建已通；载荷、鉴权、能力对齐待 Phase 1–3 |
| 规划文档 | [`docs/000-工程规划.md`](docs/000-工程规划.md)（v0.1，**结论以它为准**）；运行时契约见 `ohos-node-bridge/docs/000-工程规划.md` §6 |

## 目录

```
pi-desktop-ark/
├── AppScope/app.json5              # 包名 / 版本 / 图标
├── entry/                          # 主模块（HAP）
│   ├── src/main/ets/entryability/  # EntryAbility（形态取编译期常量；--ps 仅设备侧用例通道）
│   ├── src/main/ets/pages/Index.ets# 主界面：状态条 + ArkWeb（boot 页 → 本地服务页）
│   ├── src/main/ets/app/           # PiDesktopRuntime：启动/探活编排（消费方逻辑）
│   ├── src/main/ets/common/        # 常量与日志（含 BuildConfig：编译期形态开关）
│   ├── src/main/resources/rawfile/ # boot.html（首屏，必须有）
│   └── src/main/resources/resfile/pi-web/  # ← 应用载荷落点（gitignored，见其 README）
├── scripts/provision-runtime.sh    # 投放运行时（委托 ohos-node-bridge/tools/provision.mjs）
├── hvigorfile.ts                   # 签名注入（仓库内不落密钥）
└── signing.debug.local.json.sample # 签名材料模板
```

## 构建

```bash
# ① 投放运行时（libnode.so ≈121 MB + libc++_shared.so）—— 必须先做，否则 HAP 里没有 Node
./scripts/provision-runtime.sh            # 或 --check / --download（国内需 NODE_USE_ENV_PROXY=1）

# ② 构建 HAP
export DEVECO_SDK_HOME='D:\oh-workspace\command-line-tools\sdk'
export PATH="/d/oh-workspace/DevEco Studio/tools/node:$PATH"
cmd //c "D:\oh-workspace\command-line-tools\bin\hvigorw.bat assembleHap --mode module -p product=default -p buildMode=debug --no-daemon"
# 产物：entry/build/default/outputs/default/entry-default-signed.hap（有签名材料时）
#       没有签名材料则产出未签名包
```

## 装机前必须知道的两件事

| # | 事项 | 说明 |
| --- | --- | --- |
| 1 | **调试签名** | 已在 DevEco 为 `org.fellow99.pi.PiDesktopArk` 生成（证书与包名绑定）。材料写在 `build-profile.json5` 的 `signingConfigs` 里；也可改用 `signing.debug.local.json` + 环境变量覆盖 |
| 2 | **JIT 的 ACL** | 声明面 **21 项 requestPermissions + 2 项 definePermissions + `taskKeeping`**（基线取 `web_engine` 23 项 + `KEEP_BACKGROUND_RUNNING`，之后**收窄 3 项**：剪贴板 / 桌面 / 持久化授权；文档与下载两项保留用于点 Tab 时授权，见 [`docs/001-能力复刻评估.md`](docs/001-能力复刻评估.md) REV-5·6·7 与 [`docs/ACL-无ACL评估.md`](docs/ACL-无ACL评估.md)）。⚠️ **但 Profile 不含 ACL 时装机会被拒**（实测 `9568289 / PermissionName: ohos.permission.READ_PASTEBOARD`）——详见 [`docs/ACL配置.md`](docs/ACL配置.md)，那里给了「走 ACL」与「获批前先跑通」两条路径 |

> **签名材料与 git**：DevEco 的「自动生成签名」会把证书路径与**本机加密口令**直接写进
> `build-profile.json5`（该文件本身入库，所以会表现为**本地未提交改动** —— 请勿把它提交进仓库）。
> `hvigorfile.ts` 不会覆盖它：只有提供 `signing.<mode>.local.json` 或证书环境变量时才注入自己的材料，
> 否则如实使用 `build-profile.json5` 里的配置（并补上 `products[].signingConfig` 指针 —— 少了这个指针，
> 即便材料在也**静默产出未签名包**）。

## 运行形态：**编译期固定为 compat（`--jitless`）**

本版**不做运行期形态切换**，形态是构建期常量（`entry/src/main/ets/common/BuildConfig.ets` 的 `NODE_MODE`）：

| 决策 | 内容 |
| --- | --- |
| ① **所有 `deviceTypes` 默认走 compat（`--jitless`）** | `2in1` / `tablet` / `phone` / `tv` 一视同仁，默认 `NODE_MODE = 'compat'` |
| ② **不做运行期切换，只在编译期切换** | 运行期**没有**调试参数（`probeFlags` / `piNodeMode` 已移除）、没有设置项、没有 ACL 探测参与决策；出 jit 变体 = 改 `BuildConfig.NODE_MODE = 'jit'` 后重新构建 |
| ③ **compat 形态禁用 code-mode** | 代码沙箱（`quickjs-wasi`）依赖 `WebAssembly`，compat 下自检即失败 ⇒ code-mode 工具**不注册**，本版不提供替代沙箱 |

为什么是 compat：`--jitless` 是**进程级**形态，而进程内 Node 每进程只能起一次、失败即终态（`ohos-node-bridge` 契约 §2.6）——
一次形态误判就是整机不可用。且实测证明"权限位授予"不能当 JIT 可用性预检：手机 `JUY-AL80` 上
`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 查询为**已授予**，按 jit 启动仍在 `libnode_bridge` 内
**SIGTRAP** 秒崩（同一 HAP 改 compat 则 1.6 s 正常就绪）。

compat 的代价（逐项核对见 [`docs/ACL-无ACL评估.md`](docs/ACL-无ACL评估.md) §10）：
**真正缺失只有 code-mode**；其余是变慢（V8 热循环 7–10×、超限图重编码最坏 25–30 s）与调试信息降级（无 source map）；
MCP 工具从"预声明"变为经 `tool_search` 按需发现（仍可用）。对话/SSE、图片与视觉识图、Git 扩展、文件与 `bash` 工具、
ArkWeb 页面渲染**均不受影响**（同一份 WASM 依赖链已在载荷侧改掉：`next.config` 预编译 `.mjs`、纯 JS `fetch` 垫片、纯 JS `photon`）。

每台设备的形态判定都会落盘为 `<filesDir>/payload/node-mode.json`（`mode` / `reason` / `flags` / `deviceType` / `deviceModel`），
便于在没有 hilog 的机型（如手机）上归因。

## 运行时状态与被观测的事实

- `scripts/provision-runtime.sh` 走的是**唯一一份**投放实现（`ohos-node-bridge/tools/provision.mjs`），
  版本与 SHA-256 固化在 `ohos-node-bridge/runtime.lock.json`，投放前跑七项 ELF 门禁；
- 启动链路：`PiDesktopRuntime.launch()` → `NodeRuntime.start()`（投递）→ **探活** `http://127.0.0.1:<port>/`；
  只有探活成功才是 `READY`（`start()` 返回 ok 只代表已投递）；
- 崩溃是**终态**：进程内 Node 无法在应用内重启，只能靠 `<filesDir>/payload/node.log` 取证 + 提示用户重启应用。

## 已知限制（继承自运行时，见 `ohos-node-bridge/docs/000-工程规划.md`）

`node::Start` 每进程一次 · `process.cwd() = /` · `process.execPath = /system/bin/appspawn` ·
`os.cpus()` 长度 0 · `dlopen` 只认裸名 `libnode.so` · 无 ACL 时必须 `--jitless`。

## 许可

MIT（见 `LICENSE`）。
