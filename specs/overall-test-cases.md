# overall-test-cases.md —— `pi-desktop-ark` 全模块测试用例索引

> 本文件是**索引与执行台账**：分层规则、用例族 ID 分配、真机取证通道、禁止的判据、基线数值、待验证清单、以及**每轮执行结果**。
> 单步细节不写在这里 —— 有独立用例文档的模块以模块文档为准（见 §2.0），其余模块的用例暂由本索引承载。
> 依据：[`../docs/000-工程规划.md`](../docs/000-工程规划.md) §10.4 判据 / §11 阶段出口 / §12 风险 / 附录 A 命令；库文档 `../../ohos-node-bridge/docs/000-工程规划.md` §5.7 / §D.8 / §D.10。
> 状态值域：`✅ 通过` · `⚠️ 部分通过 / 口径需修订` · `❌ 不通过（→ 修复项）` · `⬜ 未执行`。**未跑过的用例一律 ⬜，不得写「预期通过」**。

---

## 1. 测试分层

| 层 | 名称 | 运行位置 | 目的 | 通过判据 | 不通过意味着 |
|---|---|---|---|---|---|
| **L0** | host 构建门禁 | 开发机（Git-Bash） | 构建链不断、产物可信 | `provision-runtime.sh --check` 退出码 0 + `assemble-payload`/`assembleHap` 成功 + 产物存在且大小在预算内 | 依赖接线断裂 / 运行时被篡改 / 签名材料缺失 |
| **L1** | 真机装机 | 开发机 + 真机（hdc） | 授权面就位（宪法 A10） | `hdc install -r` → `install bundle successfully.` | Profile 缺权限项（样例见 §5 B8） |
| **L2** | 真机功能 | 真机 + 取证通道 | 用户能力可用（`overall-spec.md` §3） | 截图序列 / HTTP 端点 / 回传日志**三者互证** | 功能未实现或实现漂移 |
| **L3** | 真机性能 | 真机（`/facts` 或载荷自报 + 计时） | 档位未回退 | `WebAssembly` 存在性与热循环与基线同量级、就绪耗时在预算内 | ACL 失效 / 载荷变大 / 首启退化 |
| **L4** | 合规回归 | 产物 + 真机 | 上架红线不破（规划 §13） | HAP 内容清单 + 命名/版本一致性 + AI 标识可见 | 上架被驳回 |

---

## 2. 用例文档与引用关系

### 2.0 模块 → 文档清单（**引用关系的唯一事实源**）

| 模块 | 规格 | 方案 | 独立用例文档 | 用例 ID 前缀 | 用例归属 |
|---|---|---|---|---|---|
| 101 运行时接入 | [`101…/spec.md`](101-runtime-integration-launch-orchestration/spec.md) | [`plan.md`](101-runtime-integration-launch-orchestration/plan.md) | —（寄存在本索引） | `TC-101-*` | 本文件 §2.2 |
| 102 载荷流水线 | [`102…/spec.md`](102-payload-pipeline-assembly-crop/spec.md) | [`plan.md`](102-payload-pipeline-assembly-crop/plan.md) | — | `TC-102-*` | 本文件 §2.3 |
| 103 ArkWeb 壳与页面 | [`103…/spec.md`](103-arkweb-shell-render-and-pages/spec.md) | [`plan.md`](103-arkweb-shell-render-and-pages/plan.md) | — | `TC-103-*` | 本文件 §2.4 |
| 104 宿主能力 | [`104…/spec.md`](104-host-capabilities-arkts-impl/spec.md) | [`plan.md`](104-host-capabilities-arkts-impl/plan.md) | — | `TC-104-*` | 本文件 §2.5 |
| 105 鉴权 | [`105…/spec.md`](105-auth-loopback-and-cookie/spec.md) | [`plan.md`](105-auth-loopback-and-cookie/plan.md) | — | `TC-105-*` | 本文件 §2.6 |
| 106 工具扩展 | [`106…/spec.md`](106-tools-extensions-same-name-overrides/spec.md) | [`plan.md`](106-tools-extensions-same-name-overrides/plan.md) | — | `TC-106-*` | 本文件 §2.7 |
| 107 合规上架 | [`107…/spec.md`](107-compliance-listing-checklist/spec.md) | [`plan.md`](107-compliance-listing-checklist/plan.md) | — | `TC-107-*` | 本文件 §2.8 |
| **108 无 JIT 模式** | [`108-jitless/spec.md`](108-jitless/spec.md) | [`108-jitless/plan.md`](108-jitless/plan.md) | ✅ [`108-jitless/test-cases.md`](108-jitless/test-cases.md) | `TC-108-*` | **模块文档**（本文件 §2.9 只做索引） |
| **204 Git 插件** | [`204-plugin-git/spec.md`](204-plugin-git/spec.md) | [`204-plugin-git/plan.md`](204-plugin-git/plan.md) | ✅ [`204-plugin-git/test-cases.md`](204-plugin-git/test-cases.md) | `TC-A0*` / `TC-AD0*` + 共享 `TC-H0*`/`TC-L0*`/`TC-B0*`/`TC-D0*` | **模块文档 + 上游共享文档**（见下） |
| 项目级横切 | [`overall-spec.md`](overall-spec.md) | [`overall-plan.md`](overall-plan.md) | — | `TC-ARK-*` | 本文件 §2.1 |

> **204 的共享用例**：主机/加载/构建/真机四组用例与宿主侧同源工程**共用一份**（[`../../pi-desktop-hos/specs/204-plugin-git/test-cases.md`](../../pi-desktop-hos/specs/204-plugin-git/test-cases.md) §1–§4，`TC-H0*`/`TC-L0*`/`TC-B0*`/`TC-D0*`），
> ark 侧只维护**增量**（`TC-A0*`/`TC-AD0*`，见 [`204-plugin-git/test-cases.md`](204-plugin-git/test-cases.md) §1–§2）。两边执行同一份步骤，结果分别记在各自文档的「结果记录」里。

### 2.1 项目级横切（`TC-ARK-*`）

> 命令列给出最小可复现命令；`$HAP` = `entry/build/default/outputs/default/entry-default-signed.hap`；设备序列号见 §5。

| 用例族 ID | 名称 | 层 | 覆盖模块 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|---|
| `TC-ARK-001` | 运行时投放门禁 | L0 | 101 | `provision-runtime.sh --check` 退出码 0；`entry/libs/arm64-v8a/libnode.so` 的 SHA-256 == `runtime.lock.json`（`3019bf5f…51a1`） | `./scripts/provision-runtime.sh --check` | ✅ 通过（2026-10-20 复跑：期望/实测 SHA 一致，七项 ELF 门禁 OK） |
| `TC-ARK-002` | HAP 构建成功 | L0 | 101/102 | `assembleHap` 退出码 0 且产物存在，体积与 §5 B7 一致 | `hvigorw assembleHap …` | ✅ 通过（`BUILD SUCCESSFUL`；`$HAP` **131,159,826 B**） |
| `TC-ARK-003` | 装机（授权面就位） | L1 | 107 | 输出含 `install bundle successfully.` | `hdc install -r $HAP` | ✅ 通过 |
| `TC-ARK-004` | 启动无崩溃 | L1/L2 | 101 | `hilog` 中 `Cpp Crash` **0 命中**；应用与渲染子进程存活 | `hdc shell hilog -x \| grep -c "Cpp Crash"` | ✅ 通过（实测 **0**） |
| `TC-ARK-005` | JIT/WASM 档位 | L3 | 101/108 | jit 形态：载荷日志 `WebAssembly=object` / `jitless 兼容层：active=false`；`Cpp Crash` 0 | `app.log` + `hilog` | ✅ 通过（**判据口径已从 Phase-0 的 `/facts` 迁移到载荷日志**：`/facts` 属自检载荷） |
| `TC-ARK-006` | 日志读回通道 | L2 | 101 | 载荷日志可读回且含库/载荷输出行 | `hdc shell tail <filesDir>/payload/app.log` | ✅ 通过（口径同样迁移：`/log` 端点属自检载荷；现役读回 = `app.log`/`node.log` 双通道） |
| `TC-ARK-007` | 包体与压缩方式 | L0/L4 | 102/107 | HAP 内**原生库** `compress_type == 8`（DEFLATE） | `python -c "import zipfile;…"`（§5 脚本） | ⚠️ 部分通过：4 个 `.so` 全为 `8`；`resources/**` 仍为 `0`（STORED，不随 `compressNativeLibs` 压缩）。**附录 A 的「全部为 8」需按实测修订** |
| `TC-ARK-008` | 单实例 | L2 | 101 | `module.json5` 声明 `launchType: "singleton"`；二次 `aa start` 不产生第二实例 | 配置断言 + `aa dump -l` | ✅ 通过（配置断言命中；第二次 `aa start` 复用同一进程，pid 不变） |
| `TC-ARK-009` | 端口冲突下的可见失败 | L2 | 101/108 | 载荷改为「探空闲端口再监听」后，端口被占不再导致整进程 abort | 占端口后启动 + `app.log` | ✅ 通过（机制已改：`listen(0)` 探空闲端口；多次启动端口各不相同，见 `TC-101-006`） |
| `TC-ARK-010` | 首启耗时 | L2/L3 | 102/103 | 冷启动到「服务就绪」≤ 预算；二次启动更快（解包幂等跳过） | `app.log` 的 `PI_WEB_READY …elapsedMs` | ✅ 通过（2026-10-20：compat **885–934 ms**、jit **926 ms**；二次启动 `payload ready (skip)`） |
| `TC-ARK-011` | 会话跨重启存活 | L2 | 102/103 | 强杀 → 重启 → 会话列表含该会话且末条消息一致 | 截图 + `pi-agent/sessions/**/*.jsonl` | ⬜ 未执行（需先有真实会话） |
| `TC-ARK-012` | AI 生成内容标识 | L2/L4 | 107 | 主界面两次截图均可辨认标识文本 | `snapshot_display` ×2 | ⬜ 未执行 |
| `TC-ARK-013` | 三语资源一致性 | L0/L4 | 107 | `base`/`zh_CN`/`en_US` 的 `string.json` 键集合一致 | 键集合 diff | ⚠️ 现状：`base` 9 键 vs `zh_CN`/`en_US` 8 键（`base` 多出 `module_desc`/`EntryAbility_*` 一类；已记录，未修） |
| `TC-ARK-014` | 回归四件套 | L0–L4 | 全部 | ① 产物 SHA-256 ② 首启耗时 ③ 包体+压缩方式 ④ JIT/WASM 档位：与上次基线逐项对照无恶化 | [`../logs/20261020-1/TEST_REPORT.md`](../logs/20261020-1/TEST_REPORT.md) | ⚠️ 三项已存档（①②③），第 ④ 项口径迁移中 |

### 2.2 `101` 运行时接入

| 用例族 ID | 名称 | 层 | 判据 | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-101-001` | HAR 依赖接线 | L0 | `oh_modules/@fellow99/node-bridge` 存在；构建不报 `00309001` | `assembleHap` | ✅ 通过 |
| `TC-101-002` | 探活判据与真实端点一致 | L1/L2 | 探活路径返回 200（现役探 `/api/web-auth`） | `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/api/web-auth` | ✅ 通过（`200 {"enabled":false,"authenticated":true}`） |
| `TC-101-003` | 载荷物化 | L1 | `<filesDir>/payload/<sha12>/` 存在且与 `pi-web.version` 一致 | `ls` + `cat payload/pi-web.version` | ✅ 通过（`39fa30368ef5…`） |
| `TC-101-004` | `start()` 幂等 | L1 | 二次 `launch()` 返回 `already running: …` | 代码路径 + `hilog` | ⬜ 未执行（需可注入调试入口） |
| `TC-101-005` | 环境装配生效 | L1 | 载荷日志出现 `[env]` 契约行且值与 `payload/env.js` 一致 | `app.log` / `node.log` | ✅ 通过 |
| `TC-101-006` | 随机端口 + 回传 | L2 | 连续多次启动端口不固定 | `pi-web.ready.json` ×N | ✅ 通过（实测 33727 / 35711 / 36743 / 36885 等） |
| `TC-101-007` | 单实例显式声明 | L1/L2 | `module.json5` 含 `launchType: "singleton"` | 配置断言 | ✅ 通过 |
| `TC-101-008` | 崩溃终态 UX | L2 | 注入崩溃后界面显示终态失败 + 「请重启应用」，不自动重启 | 截图 | ⬜ 未执行 |
| `TC-101-009` | 优雅关停 | L2 | 关窗触发 Node 侧 `shutdown` 钩子（日志可见） | `app.log` | ⬜ 未执行 |
| `TC-101-010` | 日志面板读回 | L2 | 点「日志」后界面出现非空日志文本 | 截图 | ⬜ 未执行 |
| `TC-101-011` | 载荷异常兜底 | L1 | 载荷内部异常后进程**仍存活**且 `app.log` 有记录 | 实例：compat 形态的 K1 rejection | ✅ 通过（K1 即实例：`unhandledRejection` 被捕获、进程继续、随后就绪 200；见 `108-jitless/spec.md` §8） |

### 2.3 `102` 载荷流水线

| 用例族 ID | 名称 | 层 | 判据 | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-102-001` | 只读直读投放 | L1/L2 | 载荷落 `resfile/` 且 Node 直读 | — | ⚠️ 未采用（产品路线是 ② 归档 + Node 自解包；路线 ① 仅诊断保留） |
| `TC-102-002` | 裁剪 1：`.nft.json` | L2 | 删除后离线仍能起服务 | 真机启动 | ✅ 通过（归档内 0 个 `.nft.json`，真机就绪 200） |
| `TC-102-003` | 裁剪 2：win32 SWC | L2 | 删 `@next/*win32*` 后离线起服务；不触发联网补装 | 真机 + `tmp/next-swc` 不存在 | ✅ 通过 |
| `TC-102-004` | 裁剪 3：`@img`（sharp） | L2 | 删后图片路径不报错（`images.unoptimized` 生效） | `app.log` 无 `sharp` 报错 | ✅ 通过 |
| `TC-102-005` | 裁剪 4：`node-pty` | L2 | 无代码路径触发 `require('node-pty')` | `app.log` | ✅ 通过（UI 如实显示「当前平台不支持」） |
| `TC-102-006` | 体积实测与预算 | L0 | 裁剪后 `du`/`tar.gz`/`$HAP` 实测值入账 | `stat` | ✅ 通过（裁剪 66 文件 / 154.4 MiB；归档 **84,849,630 B**；HAP **131,159,826 B**） |
| `TC-102-007` | 首启与阶段文本 | L2/L3 | 阶段文本随实际阶段变化 | 截图 + `app.log` 的 `[stage]` | ✅ 通过 |
| `TC-102-008` | 幂等（内容级） | L2 | 载荷未变 ⇒ 二次启动**跳过解包**；变 ⇒ 重新就位 | `node.log` 的 `payload ready (skip)` | ✅ 通过 |
| `TC-102-009` | 进程内 Next 托管 | L2 | `/` 200 且含 UI 标记；`/api/*` 至少一条 200 | `hdc fport` + `curl` | ✅ 通过（`/` = 200 `<title>Pi Desktop</title>`；`/api/web-auth`、`/api/sessions` = 200） |
| `TC-102-010` | `resfile` 读取边界 | L1 | 大文件读取成功；写安装目录失败且报错可读 | 真机 | ⬜ 未执行 |

### 2.4 `103` ArkWeb 壳与页面

| 用例族 ID | 名称 | 层 | 判据 | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-103-001` | 本地首屏可见 | L2 | 启动早期出现 `boot.html` 的阶段文本 | `uitest dumpLayout` / 截图 | ✅ 通过（dump 中出现 `resource:/RAWFILE/boot.html`） |
| `TC-103-002` | **ArkWeb 访问 `127.0.0.1`** | L2 | 界面出现 Pi Web UI；服务侧出现渲染进程请求 | dump + `curl` | ✅ 通过（dump 文本为 pi-web 真实界面：新建/搜索对话/会话/文件…） |
| `TC-103-003` | 渲染侧本地存储 | L2 | SPA 首屏不崩、无 `localStorage is null` | 控制台/截图 | ⬜ 未执行 |
| `TC-103-004` | `databaseAccess` 是否必需 | L2 | 对照两次启动 | 对照 | ⬜ 未执行 |
| `TC-103-005` | 清历史 + 返回键守卫 | L2 | 切到服务页后按返回键不回 boot 页 | `uitest uiInput keyEvent` | ⬜ 未执行 |
| `TC-103-006` | 外链围栏 | L2 | 主界面未被导航走 | 操作截图 | ⬜ 未执行 |
| `TC-103-007` | 新窗口拦截 | L2 | `window.open` 不产生空白窗口 | 截图 | ⬜ 未执行 |
| `TC-103-008` | SSE 长连接与前后台 | L2 | 流式不中断；前后台切换可续 | 计时 + 截图 | ⬜ 未执行（SSE 传输层已在 `TC-108-05` 与真实模型调用中验过） |
| `TC-103-009` | 渲染侧能力面 | L2 | SSE/Worker/wasm/`crypto.subtle` 逐项 | 渲染侧断言 | ⬜ 未执行 |
| `TC-103-010` | 渲染进程模型 | L2 | 能区分渲染进程边界 | `aa dump` | ⚠️ 已记录：渲染进程 uid/PPID 与主进程不同（见 `docs/ACL-无ACL评估.md` §5） |
| `TC-103-011` | 加载页/错误页 | L2 | 失败时出现 ArkTS 侧错误页 | 截图 | ⬜ 未执行 |
| `TC-103-012` | 重试语义正确 | L2 | 「重试」只重做可重做阶段 | 截图 + `app.log` | ⬜ 未执行 |

### 2.5 `104` 宿主能力

| 用例族 ID | 名称 | 层 | 判据 | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-104-001` | 权限预检 | L2 | 未授权时返回结构化「未授权」 | `perm.check` | ✅ 通过（REV-6 真机复验：`atm dump` 19 项、`grantStatus=0`） |
| `TC-104-002` | 去系统设置入口 | L2 | 点击后到达本应用设置页 | 截图 | ⬜ 未执行 |
| `TC-104-003` | 目录选择器 | L2 | 能选目录并用作工作目录 | 截图 + 工具输出 | ✅ 通过（REV-6：选择器 1 个 tab（沙箱）能列出 4 个目录） |
| `TC-104-004` | 外链能力（真正注册） | L2 | 系统浏览器打开；无 SIGSEGV | 截图 + `hilog` | ⬜ 未执行 |
| `TC-104-005` | 通知（可选） | L2 | 系统通知且不含凭据 | 截图 | ✅ 通过（REV-6 回归含通知项） |
| `TC-104-006` | 剪贴板粘贴 | L2 | 粘贴文本进输入框 | 截图 | ✅ 通过（REV-6：`Ctrl+A/C/DEL/V` → `textField text='ACL19'`） |
| `TC-104-007` | 窗口尺寸记忆 | L2 | 改尺寸→重启→保持 | 两次截图 | ⬜ 未执行 |
| `TC-104-008` | 未注册能力报错 | L1 | 返回 `{"ok":false,"error":"unregistered"}` | 载荷探针 | ✅ 通过（`app.log`：`宿主桥失败路径符合预期（未注册能力 → 结构化 unregistered）`） |

### 2.6 `105` 鉴权

| 用例族 ID | 名称 | 层 | 判据 | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-105-001` | 路线 ① 免密首屏 | L2 | 首屏无登录页 | 截图/`dumpLayout` | ✅ 通过 |
| `TC-105-002` | `/api/*` 免密可通 | L2 | 无 `Authorization` 也 200 | `curl` | ✅ 通过（`/api/web-auth`、`/api/sessions` 均 200） |
| `TC-105-003` | 路线 ② cookie 注入 | L2 | 注入 `pi_web_session` 后 200 | `curl` 带 cookie | ⬜ 未执行（路线 ① 已成立，不需回退） |
| `TC-105-004` | cookie 值形态 | L1 | `v1.<exp>.<nonce>.<HMAC-SHA256>` | `curl` | ⬜ 未执行 |
| `TC-105-005` | 失败节流 | L2 | 连续错误密码被节流 | `curl` 循环 | ⬜ 未执行（免密路线下不产生登录失败） |

### 2.7 `106` 工具扩展

| 用例族 ID | 名称 | 层 | 判据 | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-106-001` | `bash` 同名扩展 | L2 | 输出与退出码正确、常驻 shell 存活 | 会话内工具调用 | ⚠️ 部分通过：设备侧真实会话里模型调 `bash` 执行 `echo $((2 + 2))` → 返回 `4`（见 `logs/20261020-2` §7.4）；「常驻 shell 存活」仍需单独取证 |
| `TC-106-002` | `find`/`grep` 同名扩展 | L2 | 无 `fd`/`rg` 仍可用 | 截图 | ⬜ 未执行（同上） |
| `TC-106-003` | 工作区主目录清单 | L2 | `/roots` 如实输出 | 截图 + `app.log` | ✅ 通过（REV-6：`PI_HOS_ROOTS` 只剩 `sandbox`） |
| `TC-106-004` | 预置模板不覆盖 | L1 | 篡改后重启内容保持 | 文件读回 + `app.log` | ✅ 通过（`agent 资源已物化：复制 0 个、跳过 44 个`） |
| `TC-106-005` | 平台缺口如实提示 | L2 | 终端/git 入口给出「不可用 + 原因」 | 截图 | ✅ 通过（UI：「当前平台不支持」） |

### 2.8 `107` 合规

| 用例族 ID | 名称 | 层 | 判据 | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-107-001` | G1 ArkWeb 形态 | L4 | 渲染链使用 ArkWeb | 材料 + 截图 | ⬜ 未执行 |
| `TC-107-002` | G2 无浏览器语义 | L0 | `module.json5` 的 `skills` 不含 `entity.system.browsable` / `ohos.want.action.viewData` | 配置断言 | ✅ 通过（0 命中） |
| `TC-107-003` | G3 无第三方内核 | L0/L4 | `libs/` 只有自有运行时件（`libnode.so` / `libnode_bridge.so` / `libnode_host_client.so` / `libc++_shared.so`） | HAP 清单 | ✅ 通过（4 个，均自有） |
| `TC-107-004` | G4 许可清单随包 | L0 | 包内第三方许可含 Node/V8/OpenSSL + 上游 MIT | 产物检查 | ⬜ 未执行 |
| `TC-107-005` | G9 PoC 清理 | L0/L4 | release 内无 `probeFlags`/调试端点 | release 构建 | ⬜ 未执行（本轮为 debug 构建；debug 保留 `probeFlags` 属预期） |
| `TC-107-006` | G10 无「内测/测试」 | L4 | 截图与包内文案 0 命中 | 截图 + 检索 | ⬜ 未执行 |
| `TC-107-007` | G11 无绕行组件 | L0 | 无预签名模板/`mremap` 绕行 | 产物 + 分支记录 | ⬜ 未执行 |
| `TC-107-008` | G7 三一致 + 版本递增 | L0/L4 | 图标/名称/备案名一致；`versionCode` 递增 | `app.json5` + AGC | ⬜ 未执行 |
| `TC-107-009` | G6 AI 标识 | L4 | 同 `TC-ARK-012` | 截图 ×2 | ⬜ 未执行 |
| `TC-107-010` | G8 隐私声明可达 | L4 | 链接可打开 | 截图 | ⬜ 未执行 |

### 2.9 `108` 无 JIT 模式（**索引，细节见模块文档**）

| 引用 | 内容 | 本轮结果 |
|---|---|---|
| [`108-jitless/test-cases.md`](108-jitless/test-cases.md) §四 TC-108-01…14 | **设备侧**双形态（fetch 14 例 + photon 24 例，各自启动应用） | ✅ fetch 14/14（compat 415 ms / jit 437 ms）；photon 22 过 + 2 跳过（compat 31.2 s / jit 2.1 s） |
| 同 §二 TC-108-15/16 | 组装门禁（config 预编译 + 条件入口 + ESM 导出门禁） | ✅ 通过 |
| 同 §四 TC-108-17…22 | 真机 compat / jit / auto | ✅ 通过（compat 就绪 871–969 ms；jit 零回归且真实模型调用 2/2）；TC-108-19 真实对话 + SSE ✅、TC-108-20 图片附件 ⚠️（模型不支持图像输入）、TC-108-21 code-mode ✅ 如实降级 |
| [`108-jitless/spec.md`](108-jitless/spec.md) §8 K1 | compat 启动期一条无害 `unhandledRejection` | ⚠️ 已知问题（已定位根因，修法已试并回滚，留后续方案） |

### 2.10 `204` Git 插件（**索引，细节见模块文档**）

| 引用 | 内容 | 本轮结果 |
|---|---|---|
| [`204-plugin-git/test-cases.md`](204-plugin-git/test-cases.md) §1 TC-A01…A06 | ark 增量（同步幂等 / V2 头注 / v24 加载 / 仓库操作 / 入 tar / 编译） | ✅ A01…A06 通过（A06 = 131,167,056 B） |
| [`../../pi-desktop-hos/specs/204-plugin-git/test-cases.md`](../../pi-desktop-hos/specs/204-plugin-git/test-cases.md) §1 TC-H01…H09 | 主机层（凭据/围栏/方言/url/diff/status） | ✅ **设备侧 26 项通过 / 0 失败**（跑物化后的那份语例，两形态各一遍） |
| 同 §2 TC-L01…L08 | 加载冒烟与本地仓库链 | ✅ **设备侧本地链 17 步全通**（含围栏越界被结构化拒绝） |
| 同 §4 TC-D01…D10 | 真机回归 | ⚠️ D01 设备侧通过（扩展 + `tests/` 已物化）；**D02/D04 在设备上受网络限制**：探针实测 `github.com` 20 s 超时、内网域名 `getaddrinfo ENOTFOUND`、同主机 IP 不可达 ⇒ 结论为环境而非代码；D03/D06 设备侧通过 |

---

## 3. 真机取证通道 + 端到端证书

```bash
hdc list targets                       # 设备：HAD-W32 / 序列号见 §5
HAP=entry/build/default/outputs/default/entry-default-signed.hap
FILES=/data/app/el2/100/base/org.fellow99.pi.PiDesktopArk/haps/entry/files

# ① 「看」：截图
hdc shell snapshot_display -f /data/local/tmp/s.jpeg && hdc file recv /data/local/tmp/s.jpeg ./

# ② 「点 / 读 UI」：uitest（⚠️ 2026-10-20 实测 dumpLayout **可用**，见 §4 更正）
hdc shell "uitest dumpLayout -p /data/local/tmp/layout.json" && hdc file recv /data/local/tmp/layout.json ./

# ③ 「回传」：载荷日志双通道（库 node.log + 载荷 app.log）
hdc shell "tail -80 $FILES/payload/app.log"
hdc shell "tail -80 $FILES/payload/node.log"

# ④ 「HTTP」：把设备端口转发到本机后直接打端点
PORT=$(hdc shell "cat $FILES/payload/pi-web.ready.json" | grep -o '"port": *[0-9]*' | grep -o '[0-9]*')
hdc fport tcp:18080 tcp:$PORT
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/api/web-auth

# 装机/启动前置
hdc install -r $HAP
hdc shell "aa force-stop org.fellow99.pi.PiDesktopArk"
hdc shell "aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility --ps piNodeMode compat"   # 或 auto / jit
```

**取证纪律**：每轮必须同时留「原始输出」+「复现命令」；证据落 [`../logs/<YYYYMMDD>-N/`](../logs/)；
沙箱内文件 `hdc` 只读（debug 签名也不行）⇒ 涉及运行期写入的结论只能从应用域或 HTTP 端点取。

### 3.1 设备侧用例执行通道（**纯 JS 断言必须在设备上跑**，2026-10-20 第 2 轮起）

设备上没有可执行的 `node`（`libnode.so` 只能被应用进程 `dlopen`），所以「108 兼容层 / 204 工具链 / 真实模型调用」
这类纯 JS 用例，PC 上跑绿**不算**证据。做法是让应用**把自己的 Node 入口换成语例脚本**：

| 元件 | 位置 | 说明 |
|---|---|---|
| 调试参数 | `--ps piTestScript devtest/run.mjs` | 仅 debug 构建生效（`applicationInfo.debug=false` 时整条失效，合规 G9）；相对 `context.resourceDir` 或以 `/` 开头的绝对路径 |
| 调试参数 | `--ps piTestSuite 108-fetch` | 选套件：`108-fetch`/`108-photon`/`204-unit`/`204-e2e`/`204-remote`/`model`/`probe`/`all`。**单独给**是因为 108 的两支要自己安装兼容层并断言安装日志，执行器不能预装 |
| 调试参数 | `--ps piTestEnvFile <url|path>` | 测试态地址/账号/口令/API Key 的来源：电脑侧一次性 HTTP 端点（`hdc rport`），**不落设备存储** |
| 执行器 | `payload/devtest/run.mjs` + `suites/*.mjs` | 按套件分派、隔离 compat/jit、写结果文件与 `SUMMARY` 行 |
| 投放 | `node scripts/stage-devtests.mjs`（发布前 `--clean`） | 把 `payload/devtest/**` 与 `payload/jitless/**` 投进 `resfile/devtest/`（48 文件，秒级；**不入产品归档**） |
| 结果回传 | `<filesDir>/devtest-results/<suite>-<ts>.json` + `payload/node.log` | 一行 `[devtest] SUMMARY {…}` 可 grep |

```bash
# 完整一次（凭据只经环境变量与本机临时文件，跑完删除）
node scripts/stage-devtests.mjs
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
hdc install -r entry/build/default/outputs/default/entry-default-signed.hap
node <临时目录>/envsrv.mjs <临时环境文件> 19000 &
hdc rport tcp:19000 tcp:19000
hdc shell "aa force-stop org.fellow99.pi.PiDesktopArk"
hdc shell "aa start -b org.fellow99.pi.PiDesktopArk -a EntryAbility --ps piNodeMode compat   --ps piTestScript devtest/run.mjs --ps piTestSuite 108-fetch --ps piTestEnvFile http://127.0.0.1:19000/env.json"
hdc shell "tail -40 $FILES/payload/node.log"
```

**已知口径限制**（写进结果，不猜）：`node:test` 的事件里 `data` 是空对象、显式 `reporter:'tap'` 一条都不跑、
stream 从不发 `end`/`close` ⇒ 完成信号用 `beforeExit`、计数按事件累加，**区分不出 skip**（跳过的子用例同样发 `test:pass`）。

---

## 4. 禁止的判据（与宪法 A7 同源）

| 禁用 | 为什么 | 替代判据 |
|---|---|---|
| hilog「有没有那一行」 | 日志行不保证可观测（曾被告警噪声淹没） | 载荷 `app.log` 的结构化字段、HTTP 状态码、返回字段精确匹配 |
| 「日志出现 `(target MAGLEV)`」 | 该行**不可观测** | 同 `TC-ARK-005` 的 `WebAssembly` 存在性 |
| `VmSize` / 进程存在性判 V8 是否起来 | 与 V8 可用性无因果 | 载荷自报 + 真实 HTTP |
| 「点了一下看起来生效」 | 无因果 | 截图前后对比 + 状态字段 |
| 「目录存在」判载荷就位 | 会掩盖就地升级失效 | 内容级 marker（`pi-web.version` 的 SHA-256） |
| 「重试后成功」掩盖首次失败 | 掩盖真实失败面 | 首次失败必须单独取证 |
| 只跑 debug 而声称 release 行为 | 调试通道/日志级别不同 | release 构建单独跑 `TC-107-005` |
| **PC 上跑同一份语例**当设备证据 | PC 的 `--jitless` 只是近似：沙箱路径、DNS/网络、进程形态都不同 | 用 §3 的设备侧执行通道在**设备上的 Node**里跑（2026-10-20 第 2 轮起） |

> **2026-10-20 更正**：`uitest dumpLayout` 在本机**可用**（`-p <file>` + `hdc file recv`；此前"拿不到结果"是旧调用方式所致）。
> 它现在是**合法取证通道**；但 `dumpLayout` 只反映 ArkUI 树 —— Web 页内容以其中的文本节点为准，**不可**据此断言渲染细节（那仍需截图）。

---

## 5. 基线数值

> 设备：`HAD-W32` / `HAD-W24 7.0.0.111(SP7C00E100R13P5)` / API 26 / arm64-v8a / 序列号 `3QC0226526001227`；
> 运行时：Node **v24.2.0**（`modules=137`）/ `runtime.lock.json` SHA-256 `3019bf5f…51a1`。

| # | 项 | 基线值 | 取证方式 |
|---|---|---|---|
| B1 | Node | `v24.2.0` / `platform=openharmony` / `arch=arm64` / `modules=137` | `node.log` 的 `[bootstrap]` 行 |
| B2 | **JIT/WASM（ACL 生效）** | jit 形态：`WebAssembly=object`、`兼容层 active=false` | `app.log` |
| B3 | **compat 形态** | `--jitless`：`WebAssembly=undefined`、`兼容层 active=true`、惰性 getter 封印 5 项 | `app.log` |
| B4 | 就绪耗时 | compat **885–951 ms**、jit **871–926 ms**（`elapsedMs`，载荷入口→就绪；第 2 轮设备侧复验 compat 911/951 ms、jit 871 ms） | `app.log` 的 `PI_WEB_READY` |
| B5 | 崩溃 | `hilog` 中 `Cpp Crash` **0 命中** | `hilog` |
| B6 | 沙箱路径 | `filesDir=/data/storage/el2/base/haps/entry/files`；载荷 `<filesDir>/payload/<sha12>/` | `app.log` |
| B7 | 签名 HAP | **131,167,056 B**（含调试通道代码、**不含**语例脚本）；`libs/arm64-v8a/` 4 个 `.so` 均 `compress_type=8` | `ls -l` + HAP 清单 |
| B8 | 装机失败样例 | `code:9568289 / PermissionName: ohos.permission.READ_PASTEBOARD`（Profile 缺该 ACL 项时） | `hdc install -r`（历史） |
| B9 | 载荷归档 | `pi-web.tar.gz` **84,849,630 B** / 27,179 文件条目；sha256 见 `pi-web.version` | `stat` + `tar -tzf \| wc -l` |
| B10 | 端口 | 每次启动从 `listen(0)` 取空闲端口（实测 33727/35711/36743/36885） | `pi-web.ready.json` |
| B11 | 载荷幂等 | 载荷未变 ⇒ `payload ready (skip)`；变 ⇒ 新 `<sha12>/` 目录 | `node.log` |

---

## 6. 待验证清单（P0-* / O* / A*）

| 编号 | 问题 | 验证方式（可证伪） | 关联用例 | 现状 |
|---|---|---|---|---|
| **P0-3** | ArkWeb 能否访问 `127.0.0.1` | 界面出现 Pi Web UI；`/api/*` 200 | `TC-103-002` / `TC-105-001/002` | ✅ 已解决（2026-10-20 真机） |
| **P0-4** | 子进程语义（`spawn` 事件） | 真机短命令观测 `data`/`exit`/`close` | `TC-106-001` | ⚠️ 部分（`bash` 实跑成功拿到 `4`；`exit`/`close` 事件未逐项取证） |
| **P0-13** | `resfile` 只读直读可行性 | 见 `TC-102-001` | `TC-102-001/010` | ✅ 已决策：采用归档 + 自解包（路线 ②） |
| **O1** | `.nft.json` 能否删 | 删后离线起服务 | `TC-102-002` | ✅ 可删（真机就绪） |
| **O2** | 删 win32 SWC 后是否联网补装 | `tmp/next-swc` 不出现 | `TC-102-003` | ✅ 不补装 |
| **O6** | 首启耗时与 HAP 体积终值 | 计时 + 产物解析 | `TC-ARK-010` / `TC-102-006` | ✅ 见 B4/B7/B9 |
| **O8** | 目录选择器形态 | 选择器可用且被 agent 用作 cwd | `TC-104-003` | ✅ 选择器可用（cwd 使用见 `TC-106-*` 未执行） |
| **O9** | 渲染进程模型 | `aa dump`/`hilog` | `TC-103-010` | ⚠️ 部分（uid/PPID 已分） |
| **A5** | ArkWeb SSE 长连接 | ≥5 min 长连接 + 前后台切换 | `TC-103-008` | ⬜ 待真机（传输层已验） |
| **A6** | `resfile` 读取边界 | 大文件读 + 写失败报错 | `TC-102-010` | ⬜ 待执行 |

---

## 7. 用例编写规则（新增用例时必须遵守）

1. 每条用例**必须**有「层 + 覆盖模块 + 判据 + 命令/证据」四项，缺一不入索引；
2. 判据**必须**是可证伪的观测（截图 / HTTP 字段 / 载荷日志文本 / 产物清单），**不得**写「功能正常」「无异常」；
3. ID 分配：跨模块横切 `TC-ARK-xxx`；模块内 `TC-1NN-xxx`；插件增量 `TC-A0x`/`TC-AD0x`。编号**不复用**；
4. **用例归属优先落在模块文档**：某模块一旦建立 `specs/<module>/test-cases.md`，其用例细节与结果就写在那里，本索引只保留一行引用（见 §2.0/§2.9/§2.10）；
5. 执行后**必须**把状态从 ⬜ 改为结果，证据落 `logs/<YYYYMMDD>-N/`；**未执行的一律保持 ⬜**；
6. 与基线相关的用例（`TC-ARK-005/007/010/014`）在**换运行时版本**（`runtime.lock.json` 变更）后**必须**重跑；
7. **敏感信息零落盘**：仓库地址/账号/口令/API Key 一律由需求方线下提供，文档、日志、提交信息里只用占位符（`<host>`/`<user>`/`<pass>`/`<token>`）。

---

## 8. 执行记录

| 日期 | 范围 | 结果 | 证据 |
|---|---|---|---|
| 2026-10-16 | 基线首轮（HAD-W24） | 建立 B1–B12 | `docs/000-工程规划.md` §10 附录 |
| 2026-10-17 / 10-19 | 权限面收窄、压缩开关、零 ACL 评估 | 见 `docs/001-能力复刻评估.md` REV-5/6/7 + `docs/ACL-无ACL评估.md` | 同上 |
| **2026-10-20** | **全模块一轮**：L0 门禁 + 108 PC 双形态单测（38×2）+ 204 单测（25）+ 204 远端双仓端到端 + 真实模型调用（compat）+ 真机 compat/jit 验收 | 见 [`../logs/20261020-1/TEST_REPORT.md`](../logs/20261020-1/TEST_REPORT.md) | `logs/20261020-1/` |
| **2026-10-20 第 2 轮（续）** | 设备侧真实会话：配置 DeepSeek Key + 建工作区 + 对话（SSE 逐块，compat/jit 各一轮）+ 图片附件（3.4 MB PNG，附件入会话但模型不支持图像）+ code-mode 降级（compat `unavailable` 带结构化原因 / jit `available`） | 见 [`../logs/20261020-2/TEST_REPORT.md`](../logs/20261020-2/TEST_REPORT.md) §7 | `logs/20261020-2/` |
| **2026-10-20 第 2 轮** | **全部用例改在真机执行**：新增设备侧执行通道（`piTestScript`/`piTestSuite`/`piTestEnvFile` + `hdc rport`）；108 双形态 14/14×2、photon 22+2×2、204 单元 26/0×2、204 端到端 22/5（远端受设备网络限制）、真实模型调用 2/2×2 | 见 [`../logs/20261020-2/TEST_REPORT.md`](../logs/20261020-2/TEST_REPORT.md) | `logs/20261020-2/` |
| **2026-10-20（修复轮复验）** | 缺陷 D1–D3 修复后重装 `29ab4aca52e4` 载荷的 HAP：compat 就绪 **911 ms**、`/` `/api/web-auth` `/api/sessions` 均 **200**，设备侧扩展文件已含修复；jit 就绪 **871 ms**、`兼容层 active=false`、`WebAssembly=object` | [`../logs/20261020-1/TEST_REPORT.md`](../logs/20261020-1/TEST_REPORT.md) §康复验 | 同上 |
