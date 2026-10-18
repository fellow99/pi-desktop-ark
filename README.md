# Pi Desktop · HarmonyOS Edition（`pi-desktop-ark`）

> **定位：HarmonyOS Edition**（HarmonyOS 版）—— Pi Desktop 的两个鸿蒙版别之一；另一个是 `pi-desktop-hos`
> （**Electron on HarmonyOS Edition**，Electron-on-鸿蒙运行时）。本版**不带任何 Chromium/Electron**：
> **进程内 Node.js 运行时**（`@fellow99/node-bridge`）+ 端上 `pi-web` 服务 + **ArkWeb** 渲染前端；
> 功能目标是与 Electron on HarmonyOS 版对齐。

| 项 | 值 |
| --- | --- |
| 版别 | **HarmonyOS Edition**（`pi-desktop-ark`） |
| 应用名（桌面/窗口标签）/ 包名 | Pi Desktop V2 / `org.fellow99.pi.PiDesktopArk` |
| 目标设备 | `2in1` / `tablet`（不做 phone） |
| 后端 | `@fellow99/node-bridge` 起的 Node v24.2.0（进程内，`dlopen` + `node::Start`） |
| 前端 | ArkWeb 加载 `http://127.0.0.1:<port>/`（页面由本地服务渲染，同源零 CORS） |
| 当前状态 | **骨架**：依赖接线与编译构建已通；载荷、鉴权、能力对齐待 Phase 1–3 |
| 规划文档 | [`docs/000-工程规划.md`](docs/000-工程规划.md)（v0.1，**结论以它为准**）；运行时契约见 `ohos-node-bridge/docs/000-工程规划.md` §6 |

## 目录

```
pi-desktop-ark/
├── AppScope/app.json5              # 包名 / 版本 / 图标
├── entry/                          # 主模块（HAP）
│   ├── src/main/ets/entryability/  # EntryAbility（读 --ps probeFlags）
│   ├── src/main/ets/pages/Index.ets# 主界面：状态条 + ArkWeb（boot 页 → 本地服务页）
│   ├── src/main/ets/app/           # PiDesktopRuntime：启动/探活编排（消费方逻辑）
│   ├── src/main/ets/common/        # 常量与日志
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
| 2 | **JIT 的 ACL** | 声明面已配好（与 `pi-desktop-hos` 逐项一致：**24 项 requestPermissions + 2 项 definePermissions + `taskKeeping`**）。⚠️ **但 Profile 不含 ACL 时装机会被拒**（实测 `9568289 / PermissionName: ohos.permission.READ_PASTEBOARD`）——详见 [`docs/ACL配置.md`](docs/ACL配置.md)，那里给了「走 ACL」与「获批前先跑通」两条路径 |

> **签名材料与 git**：DevEco 的「自动生成签名」会把证书路径与**本机加密口令**直接写进
> `build-profile.json5`（该文件本身入库，所以会表现为**本地未提交改动** —— 请勿把它提交进仓库）。
> `hvigorfile.ts` 不会覆盖它：只有提供 `signing.<mode>.local.json` 或证书环境变量时才注入自己的材料，
> 否则如实使用 `build-profile.json5` 里的配置（并补上 `products[].signingConfig` 指针 —— 少了这个指针，
> 即便材料在也**静默产出未签名包**）。

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
