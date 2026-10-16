# overall-plan.md —— Pi Desktop V2 整体技术方案

> 本文件写「**怎么做**」：技术上下文、宪法合规检查、分阶段实现策略、跨切面关注点、测试策略、构建装机流水线。
> 依据：规划 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) **§11 分阶段计划 / §12 风险与开放问题 / §14.2 模块编号 / §14.3 流水线**；运行时契约 `../../ohos-node-bridge/docs/000-工程规划.md` **§6**。
> 现状口径：**Phase 0 已完成，Phase 1 未开始**（`specs/` 八件套是 Phase 1 的第一件交付物）。

---

## 1. Technical Context

| 项 | 值 |
|---|---|
| 形态 | ArkTS 宿主（Ability + ArkWeb）+ 库提供的**进程内** Node（`dlopen` + `node::Start`，detached 线程）+ 端上 `pi-web` 服务端 |
| 数据面 | 同源 HTTP + SSE：`/`（SPA）、`/api/*`、SSE；零 CORS、零头改写、零 IPC 载体 |
| 运行时 | Node **v24.2.0**（`platform=openharmony`、`modules=137`），产物锁在 `ohos-node-bridge/runtime.lock.json` |
| 上游载荷 | `pi-web`（Next 16.3.8 非 standalone）+ `pi` agent；设备侧 SWC 只能走 WASM |
| 设备 | HAD-W32 / HarmonyOS 6.1.0 / API 26 / arm64-v8a；`2in1` + `tablet` |
| 权限 | 声明面 24 `requestPermissions` + 2 `definePermissions` + `taskKeeping`；**3 项 ACL** 已获批并进 Profile |
| 已实证结论 | ACL 生效 ⇒ 无 `Cpp Crash`、`wasm.available/validate=true`、热循环 **6–9 ms/2e6**；端口冲突 ⇒ 整进程 abort；`dup2` 日志混流 |
| 当前产物 | 签名 HAP **129,347,874 B**；载荷（`pi-dist`）**尚未接入**（`resfile/pi-web/` 仅 README） |
| 构建链 | `scripts/build-bridge-har.sh` → `scripts/provision-runtime.sh` → `hvigorw assembleHap` → `hdc install -r` |
| 关键未知 | ArkWeb→`127.0.0.1`（P0-3）、`resfile` 直读（P0-13）、裁剪后 Next 能否起（O1/O2）、SSE 长连接行为（A5） |

---

## 2. 宪法合规检查（逐条）

| 原则 | 判定 | 理由（现状证据） |
|---|---|---|
| **A1 一切经 HTTP** | ✅ | 形态即同源 HTTP + SSE；无 preload/IPC 载体；宿主能力桥（⬜ Phase 2）在设计上只承载宿主能力（`specs/ARCHITECTURE.md` §1 数据流规则已写死禁止项） |
| **A2 壳薄、契约硬** | ✅ | 壳只做启动/观测/宿主能力/渲染四件事；业务全在 Node 侧；`PiDesktopRuntime` 不碰业务语义 |
| **A3 运行时结论以库文档为准** | ✅ | 本目录全部文档只引用库 §号，不复制论证；应用层新结论（ACL/端口/日志）回引 `docs/ACL配置.md` |
| **A4 不改上游** | ✅ | 当前 0 条补丁；两条候选（P-ark-1/P-ark-2）都登记为「优先不补」 |
| **A5 失败可见** | ⚠️ | 状态机 + `detail` 文案已落；⬜ ArkTS 加载页/错误页/诊断面板未落（`Index.ets:70` 明标 Phase 1）；⚠️ 「重试」按钮当前只重新 `loadUrl`，语义需按宪法 A5 收敛 |
| **A6 不隐藏平台真相** | ⚠️ | 原则成立且已写进宪法；但**界面尚未输出任何平台缺口提示**（终端/`git`/后台/用户目录直写都是 Phase 2 的宿主能力与文案工作） |
| **A7 判据可证伪** | ✅ | `overall-test-cases.md` 全部用例带「看哪里」与基线数值；禁用的判据单独成节 |
| **A8 单实例与随机端口** | ❌ | **端口写死 15577**（`Constants.ets:7`）；`launchType` 未显式声明 ⇒ 两条都必须在 Phase 1 落地（这是与本宪法冲突的**唯一硬项**） |
| **A9 异常兜底** | ❌ | `selfcheck.js` 未装 `uncaughtException`/`unhandledRejection`，`listen` 无 `error` 处理 ⇒ 端口冲突仍会 abort（✅ 已实测过该后果） |
| **A10 声明面 ≠ 授权面** | ✅ | 24+2+`taskKeeping` 声明面与旧壳逐项一致；Profile 含 3 项 ACL 并已装机验证；复验步骤已固化 |

**结论**：A8/A9 是「**已知与宪法冲突、且已实测会致命**」的两项，属 Phase 1 的**必做**（不是「优化项」）；A5/A6 是「原则成立但实现欠账」，随加载页/诊断面板与宿主能力一并补齐。

---

## 3. 实现策略总览

### 3.1 Phase × 模块 × 交付物

| Phase | 状态 | 目标 | 涉及模块 | 出口判据（可证伪） |
|---|---|---|---|---|
| **Phase 0 可行性验证** | ✅ **已完成**（2026-10-16） | 依赖接线、构建链、ACL 授权面、JIT 实证、启动编排骨架 | `101`（骨架）、`107`（声明面） | 装机成功 + `/facts` 正确 JSON（`wasm.validate=true`、热循环 6–9 ms） |
| **Phase 1 端到端产品链路** | ⬜ **当前** | 载荷组装裁剪 → 进程内 Next 宿主 → 端到端 UI → 收口 P0-3/P0-4/P0-13 | `101` `102` `103` `105` `106` | 不接外网完成：新建会话 → 发消息 → **流式回复** → 工具调用可视化 → 重启后会话仍在（截图序列） |
| **Phase 2 宿主能力补齐** | ⬜ | 窗口状态、外链、权限预检、目录选择器、导航围栏、优雅关停、通知（按需） | `104` `103` `101` | `§8.1` 里所有「✅ 预期一致」的行变成 ✅ 实测 |
| **Phase 3 合规与上架** | ⬜ | G1–G11 逐条落实 + 材料口径 + PoC 清理 + `versionCode` 递增 | `107` | 提交材料齐备；PoC 资产（`--inspect`/诊断开关/调试端点）在发布物中**不存在** |
| **Phase 4 回归基线** | ⬜ | 签名产物哈希、首启耗时、包体、`/facts` 关键字段作为**回归四件套**；每次换运行时版本重跑 | 全模块 | 基线与本次数值可逐项对照（无恶化） |

### 3.2 Phase 1 工作分解（按模块编号，逐条可验收）

| 顺序 | 工作项 | 模块 | 判据 |
|---|---|---|---|
| 1 | 载荷组装：`pi-dist` 组装 + **四项裁剪**（`.nft.json`、`@next` win32 SWC、`@img`、`node-pty`）→ 投放 `resfile/pi-web/` | `102` | 离线真机起服务成功；`tmp/next-swc` 不出现；包体下降可测 |
| 2 | Node 侧启动脚本：env 装配（`PI_*`）+ 进程内 Next 宿主（搬旧壳候选 A/A′）+ 异常兜底 + 独立日志 | `101` `102` | `/facts` 之外出现 pi-web 的 `/api/*` 200；`payload/app.log` 有内容 |
| 3 | 入口/物化路径切换：从 `rawfile/selfcheck.js` 切到载荷入口；探活判据改为真实端点 | `101` | `UIState` 能到 `READY`（截图 + `/log` 有服务侧输出） |
| 4 | 随机端口 + 单实例 + 端口探测 | `101` | 占用候选端口后仍能起；二次启动不产生第二实例 |
| 5 | Web UI 端到端：`/` 出 SPA、`/api/*` 通、**SSE 流式**稳定 | `103` | AC-2 的截图序列 |
| 6 | 鉴权路线定稿（路线 ① 免密，P0-3 证伪则切 ②）+ Cookie 注入预案 | `105` | 首屏无登录页；`/api/*` 无需 Basic 头即通 |
| 7 | 三个同名扩展（`bash`/`find`/`grep`）搬入 + 工作区主目录 + 预置模板 | `106` | 命令执行返回退出码；搜索工具输出含跳过规则；`/roots` 类自检可用 |
| 8 | 加载页/错误页/诊断面板（阶段文本 + 日志尾 + 崩溃提示） | `103` `101` | AC-1/AC-8 |
| 9 | 停用（不进生产）`--inspect` 与诊断开关 | `107` | release 构建下无调试通道 |

### 3.3 依赖顺序（不可并行者）

```
[1 载荷组装/裁剪] ──► [2 启动脚本+Next 宿主] ──► [3 入口切换+探活收口] ──► [5 UI 端到端] ──► [Phase 2 宿主能力]
        │                       │                        │
        └──[P0-13 直读判据]──────┴──[O1/O2 裁剪判据]      └──[4 随机端口/单实例]（可与 2/3 并行，但必须在 [5] 之前）
[6 鉴权定稿] 依赖 [5] 的第一张截图（无登录页即路线 ① 成立）
[7 工具扩展] 依赖 [2]（扩展要落到 `pi-agent/extensions/`）
[8 加载页/诊断面板] 依赖 [3]（需要真实阶段与日志）
```

---

## 4. 跨切面关注点

### 4.1 错误处理与失败态 UX

| 失败面 | 处置 | 现状 |
|---|---|---|
| 投递失败（`start()` 返回 `ok=false`） | 立即 `FAILED` + `result.message` 上屏 | ✅ |
| 探活超时 | `FAILED` + 重试次数/间隔 + 日志路径 | ✅（措辞含常量值） |
| 端口被占用（已实测致整进程 abort） | ⬜ 随机端口 + 端口探测；⬜ 载荷 `listen` 的 `error` 处理把 `EADDRINUSE` 变成可读错误 | ❌ |
| 载荷未捕获异常 | ⬜ `uncaughtException`/`unhandledRejection` → 自己的日志 + 结构化错误 | ❌ |
| 服务已崩溃 | ⬜ 终态失败页 + 「请重启应用」；**不得**自动重启 | ⬜ |
| 目录未授权 | ⬜ 明确「未授权 + 去系统设置」文案 | ⬜ |
| 平台缺口（终端/`git`/后台） | ⬜ 可见降级提示（宪法 A6） | ⬜ |

**UX 规则**：任何 `FAILED` 必须让用户看到**三件事**——阶段、原因、下一步（重试 / 看日志 / 重启应用）；「重试」只重做可重做的阶段。

### 4.2 日志（谁写谁读 + 独立通道）

| 通道 | 写者 | 读者 | 现状 |
|---|---|---|---|
| `node.log`（库 `dup2` fd1/fd2） | Node + 原生层（**含 ArkWeb/Chromium 原生输出噪声**） | 壳（`Logger.tail`）、`/log` 端点、`hdc fport`+`curl` | ✅ 已实测混流问题 |
| 载荷自己的日志（`payload/app.log`） | 载荷（结构化：阶段/错误/崩溃） | 壳的诊断面板 + `/log`（⬜ 需扩展端点或第二端点） | ⬜ Phase 1 |
| `hilog`（`PI_DESKTOP_ARK` + `NODE_BRIDGE`，DOMAIN `0xD0033`） | 壳与库 | `hdc shell hilog` | ✅ |
| 真机回传 | 端上 POST → 开发机 `hdc rport tcp:19999` | 开发机 | 通道可用（见 `overall-test-cases.md` §3） |

**纪律**：库侧 `dup2` 的排空问题按库 §5.10 第 5 条由**库**改为「pipe + 独立 reader 线程」；本工程**不**在壳侧绕。
**纪律 2**：任何「写成功」的判据都必须有读回路径（库宪法 C3；本工程用 `/log` 与诊断面板）。

### 4.3 安全

| 面 | 方案 | 现状 |
|---|---|---|
| 服务监听 | 路线 ① `127.0.0.1` + 随机端口 + **不设** `PI_WEB_PASSWORD`（上游因此关闭认证；loopback 由 Host 围栏直接放行） | ⬜ |
| 回退（路线 ②） | 绑局域网 + 随机强密码 + 会话 cookie 派生（`v1.<exp>.<nonce>.<HMAC-SHA256>`）后注入渲染组件 | ⬜ |
| 凭据落点 | `<filesDir>/pi-agent/`（`PI_CODING_AGENT_DIR`）；**不得**进日志/崩溃记录/导出物 | ⬜ 目录未建 |
| 出网面 | 仅用户配置的模型接口；`PI_OFFLINE=1` 禁插件联网安装与二进制下载 | ⬜ |
| 代理 | `NO_PROXY/no_proxy` 追加 loopback（避免走系统代理导致本机请求失败） | ⬜ |
| 签名与密钥 | 材料不入库；`build-profile.json5` 的 `signingConfigs` 属本地未提交改动 | ✅ |
| 调试通道 | `--inspect` 仅 debug；release 必须关（旧壳 R7） | ⬜ Phase 3 收口 |

### 4.4 ACL：声明面与授权面

| 面 | 内容 | 状态 |
|---|---|---|
| 声明面 | `module.json5`：24 `requestPermissions`（8 项带 `reason`+`usedScene`）+ 2 `definePermissions` + `backgroundModes:["taskKeeping"]` | ✅ 与旧壳逐项一致 |
| 授权面 | Profile 必须含 **3 项 ACL**（`kernel.ALLOW_WRITABLE_CODE_MEMORY`、`READ_PASTEBOARD`、`READ_WRITE_DESKTOP_DIRECTORY`）+ 目录/持久化授权 | ✅ 已验证；Profile 变更必须重走 `install -r` 复验 |
| 运行期 | `user_grant` 项（剪贴板、目录）首次访问弹窗；**申请流程必须在首屏之后** | ⬜ Phase 1 |
| 判据 | ① `install bundle successfully.` ② 启动不带 `--jitless` 且 `hilog` 无 `Cpp Crash` ③ `/facts` 的 `wasm.validate=true` | ✅ 已达成 |

### 4.5 单实例与端口

- **硬约束（⑰）**：端口冲突 ⇒ 载荷 `EADDRINUSE` ⇒ 未捕获异常 ⇒ **整个 App 进程 abort**（✅ 实测）。
- 方案：Node 侧 `listen(0)`/先探测空闲 → 把实际端口回传壳（⬜ 通道：写 `payload/port` 文件或经宿主桥；**不得**让壳猜端口）；壳侧探活用回传端口。
- 单实例：`launchType: singleton` + 二次启动走 `onNewWant` 复用已有实例（⬜ 显式声明与验证）。

### 4.6 体积与裁剪

| 项 | 现值 | 处置 | 预期收益 | 判据 |
|---|---|---|---|---|
| `pi-dist` 总计 | 884,167,367 B / ≈27.2k 文件（`tar.gz` 156,592,393 B） | — | — | `du -sb` / `stat` |
| `.next/**/*.nft.json` | 348,096,301 B / 76 文件 | 删（先验证能否起） | 30–40 MB（压缩后） | 删除后真机起服务成功 |
| `node_modules/@next`（win32 SWC） | 106,203,772 B | 删（保留 `next/wasm/@next/swc-wasm-nodejs/`） | 35–42 MB | 离线真机起服务，且无联网补下载 |
| `node_modules/@img`（sharp） | 28,767,709 B | 删（`images.unoptimized = true`） | 10–12 MB | 图片相关路径不报错 |
| `node_modules/node-pty` | 26,931,902 B | 删（PTY 平台不可用 + 残留 win32 `conpty.dll`/`OpenConsole.exe`） | 9–11 MB | 终端面板本就不做；`require('node-pty')` 不再被触发 |
| 合计 | → `tar.gz` 预估 **70–90 MB** | — | — | ⬜ 待实测（不得按 5.65:1 线性外推） |

**包体预算**：库侧 ≈44 MB + 载荷 70–90 MB + ArkTS/HAP 数 MB ⇒ 签名 HAP **≈115–140 MB**（现状 129 MB 只含库，**不含载荷** ⇒ Phase 1 结束后必须重新量）。

---

## 5. 测试策略

| 层 | 目标 | 手段 | 通过判据 |
|---|---|---|---|
| L0 host 构建门禁 | 构建链不断 | `provision-runtime.sh --check`（七项 ELF 门禁 + SHA）、`hvigorw assembleHap` 成功、产物存在且大小合理 | 命令退出码 0 + 产物 `stat` 与预算相符 |
| L1 真机装机 | 授权面就位 | `hdc install -r` | 输出 `install bundle successfully.`（失败样例：`code:9568289 / PermissionName: ohos.permission.READ_PASTEBOARD`） |
| L2 真机功能 | 用户能力可用 | 四条取证通道（见 §5.1）+ 端到端证书 | 截图序列 / HTTP 端点返回 / 回传日志三者互证 |
| L3 真机性能 | 档位未回退 | `/facts` 的 `wasm.*`、`hotloop_ms_2e6`；首启计时 | 热循环 6–9 ms/2e6 量级；`wasm.validate=true` |
| L4 合规回归 | 红线不破 | HAP 内容清单（无浏览器内核、`compress_type=8`）、命名/图标/版本一致性、AI 标识可见 | 清单与截图 |

### 5.1 四条真机取证通道（缺一不可）

```bash
# ① 看：截图
hdc shell snapshot_display -f /data/local/tmp/s.jpeg && hdc file recv /data/local/tmp/s.jpeg ./
# ② 点：模拟输入（坐标来自截图）
hdc shell uitest uiInput click <x> <y>
# ③ 回传：端上日志 POST 到开发机
hdc rport tcp:19999
# ④ hilog
hdc shell hilog -x | grep -E "Cpp Crash|node-bridge|org.fellow99.pi"
# 端到端证书（最有价值的一条）
hdc fport tcp:15577 tcp:15577 && curl -s http://127.0.0.1:15577/facts
hdc fport tcp:15577 tcp:15577 && curl -s http://127.0.0.1:15577/log
```

### 5.2 禁止的判据（与宪法 A7 同源）

`uitest dumpLayout`（本机拿不到结果）· 用 hilog「有没有那一行」判执行 · 用 `VmSize` 判 V8 起来 ·
用「点击看起来生效」判 UI · 用日志里出现 `(target MAGLEV)` 判 JIT（该行不可观测）· 用「目录存在」判载荷就位（必须内容级幂等）。

### 5.3 用例索引

全模块用例见 [`overall-test-cases.md`](overall-test-cases.md)（`TC-ARK-*` 项目级 + `TC-1NN-*` 模块级），
其中包括 P0-3/P0-4/P0-13/O1/O2/O5/O8/O9/A5/A6 的**待验证清单与验证方式**。

---

## 6. 构建与装机流水线

```bash
# ① 构建库 HAR（消费方不直接用源码目录 —— 见踩坑 00309001）
./scripts/build-bridge-har.sh                  # → libs/@fellow99/node-bridge.har

# ② 投放运行时（≈121 MB；委托库唯一一份实现；幂等 + 七项 ELF 门禁）
./scripts/provision-runtime.sh                 # 或 --check / --download（国内需 NODE_USE_ENV_PROXY=1）

# ③ 构建 HAP
export DEVECO_SDK_HOME='D:\oh-workspace\command-line-tools\sdk'
export PATH="/d/oh-workspace/DevEco Studio/tools/node:$PATH"
cmd //c "D:\oh-workspace\command-line-tools\bin\hvigorw.bat assembleHap --mode module \
         -p product=default -p buildMode=debug --no-daemon"
# 产物：entry/build/default/outputs/default/entry-default-signed.hap（有签名材料时）

# ④ 装机与取证
hdc install -r entry/build/default/outputs/default/entry-default-signed.hap
hdc shell "aa force-stop org.fellow99.test.NodeProbe"        # ⚠️ 探针会占 15577
hdc shell "aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk --ps probeFlags '--no-verify-heap'"
```

| 门禁 | 检查 | 失败含义 |
|---|---|---|
| 构建前 | `provision-runtime.sh --check` | 运行时缺失/被篡改（SHA 不符）⇒ HAP 里没有可用的 Node |
| 构建中 | `assembleHap` 输出 + 产物存在 | 依赖接线/HAR 缺失、ArkTS 编译错误 |
| 构建后 | 产物 `stat` 与预算对照；HAP 内 `libs/` 清单（`compress_type` 必须是 8） | 体积异常、原生库未压缩（上架材料要写清） |
| 装机 | `install bundle successfully.` | Profile 授权面缺失（宪法 A10） |
| 启动 | `hilog` 无 `Cpp Crash` + `/facts` 可读 | ACL 未生效（JIT 路径 SIGTRAP）或端口被占 |
| 端到端 | `/facts`、`/log`、`/`（⬜ Phase 1 起） | 载荷未接入 / 探活判据不匹配 |

> **签名前提**：`build-profile.json5` 的 `signingConfigs` 或 `signing.<mode>.local.json`；都没有 ⇒ **静默产出未签名包**（构建不报错，装机才能发现）。这是已知坑，流水线里必须显式检查产物名。

---

## 7. 风险与开放问题（引用 + 处置）

| 风险 | 影响 | 本方案的处置 |
|---|---|---|
| **R3** ArkWeb 访问不到 `127.0.0.1` | 中（需切路线 ②） | Phase 1 首项实测（P0-3）；回退路线已备 |
| **R4** 渲染侧 API 缺失（SSE/Worker/`crypto.subtle`） | 中 | 逐项测；缺失项用 document-start 注入兜底 |
| **R5/R6** 载荷体积与首启 | 中 | 四项裁剪 + 零解压首选；如实记录首启耗时 |
| **R10** 子进程语义不可靠 | 中 | 设计不依赖 `exit`/`close`；`bash` 用哨兵行 |
| **R12** 上游漂移 | 中 | 上游固定 tag/分支；所有上游结论带 `path:line`，升级逐条复核 |
| **A1** `resfile` 直读未验证 | 高 | P0-13 实测；不行退 `tar.gz` |
| **A2** 裁剪后 Next 起不来 | 中 | 逐项删逐项验（O1/O2） |
| **A3** 进程内不可重启 | 中 | 异常兜底 + 崩溃记录可导出 + 终态失败 UX |
| **A4** 上架审核口径 | 高 | §13 全清单 + 材料口径预先备好（`ARCHITECTURE.md` §9） |
| **本方案新增关注** | — | ① 探活判据与载荷不匹配（`ARCHITECTURE.md` §3.4）② 库 `NodeRuntimeOptions` 无 `env` 字段，`PI_*` 只能由 Node 侧脚本自设（`overall-data-model.md` §3）③ `AppScope/app.json5` 的 `minAPIVersion/targetAPIVersion`（17/24）与规划「API 26」口径不一致 |

| 开放问题 | 验证方式 | 时限 |
|---|---|---|
| O1 `.nft.json` 能否删 | 删除后真机起服务 | Phase 1 |
| O2 win32 SWC 删除后是否触发联网下载 | 离线真机 + `tmp/next-swc` 是否出现 | Phase 1 |
| O5 MCP stdio 是否真不可用 | 真机起 stdio 服务器看三事件 | Phase 2 |
| O6 首启耗时与 HAP 体积最终值 | 真机计时 + 产物解析 | Phase 1 |
| O8 目录选择器最优形态 | 两方案各一次真机 | Phase 2 |
| O9 渲染进程模型 | `aa dump`/`hilog` | Phase 1 |
| A5 SSE 长连接 + 前后台行为 | 长连接计时 + 前后台切换 | Phase 1 |
| A6 `resfile` 读取权限边界 | 真机读大文件 + `require` 全链 | Phase 1 |

---

## 8. 变更与评审流程（落地）

1. 每个 Phase 的工作项都必须有 `spec.md`（要什么 + 验收判据）+ `plan.md`（怎么做），编号取规划 §14.2 的 `101`–`107`；
2. 评审按 [`constitution.md`](constitution.md) 第五节清单逐条过；**A8/A9 两条未收口前，任何「端到端完成」的结论都不成立**；
3. 真机每轮取证必须落 `docs/evidence/YYYY-MM-DD-*.md`（原始 JSON + 复现命令），`specs/` 只引用；
4. 换运行时版本（`runtime.lock.json` 变更）⇒ 重跑 Phase 4 回归四件套（产物哈希、首启耗时、包体、`/facts` 关键字段）。
