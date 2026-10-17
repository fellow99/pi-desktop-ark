# overall-test-cases.md —— `pi-desktop-ark` 全模块测试用例索引

> 本文件是**索引目录**：分层规则、用例族 ID 分配、真机取证通道、禁止的判据、已有基线数值、以及**待验证清单**。
> 每个用例族的详细步骤与原始证据落在 `docs/evidence/YYYY-MM-DD-*.md`（本索引只引用；`specs/1NN-*/test-cases.md` 可细化到单步）。
> 依据：规划 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) **§10.4 判据 / §11 阶段出口 / §12 风险与开放问题 / 附录 A 命令**；库文档 `../../ohos-node-bridge/docs/000-工程规划.md` **§5.7 禁止的判据 / §D.8 / §D.10**。
> 状态值域：`✅ 通过` · `⚠️ 现状不通过（→ 修复项）` · `⬜ 待执行（Phase N）`。**未跑过的用例一律 ⬜，不得写「预期通过」**。

---

## 1. 测试分层

| 层 | 名称 | 运行位置 | 目的 | 通过判据 | 不通过意味着 |
|---|---|---|---|---|---|
| **L0** | host 构建门禁 | 开发机（Git-Bash） | 构建链不断、产物可信 | `provision-runtime.sh --check` 退出码 0 + `assembleHap` 成功 + 产物存在且大小在预算内 | 依赖接线断裂 / 运行时被篡改 / 签名材料缺失 |
| **L1** | 真机装机 | 开发机 + 真机（hdc） | 授权面就位（宪法 A10） | `hdc install -r` → `install bundle successfully.` | Profile 缺权限项（样例见 §5） |
| **L2** | 真机功能 | 真机 + 四条取证通道 | 用户能力可用（`overall-spec.md` §3） | 截图序列 / HTTP 端点返回 / 回传日志**三者互证** | 功能未实现或实现漂移 |
| **L3** | 真机性能 | 真机（`/facts` + 计时） | 档位未回退 | `wasm.validate=true`、热循环与基线同量级、首启耗时在预算内 | ACL 失效 / 载荷变大 / 首启退化 |
| **L4** | 合规回归 | 产物 + 真机 | 上架红线不破（规划 §13） | HAP 内容清单 + 命名/版本一致性 + AI 标识可见 | 上架被驳回 |

---

## 2. 用例族索引（按模块 101–107 分组）

> 命令列给出**最小可复现命令**；`$HAP` = `entry/build/default/outputs/default/entry-default-signed.hap`；`$DEV` = 设备序列号（本机 `3QC0226526001227`）。

### 2.1 项目级横切（`TC-ARK-*`）

| 用例族 ID | 名称 | 层 | 覆盖模块 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|---|
| `TC-ARK-001` | 运行时投放门禁 | L0 | 101 | `provision-runtime.sh --check` 退出码 0；`entry/libs/arm64-v8a/libnode.so` 的 SHA-256 == `runtime.lock.json` 值（`3019bf5f…51a1`） | `./scripts/provision-runtime.sh --check` | ✅ 通过 |
| `TC-ARK-002` | HAP 构建成功 | L0 | 101/102 | `assembleHap` 退出码 0 且产物存在：`$HAP` 129,347,874 B（当前值） | `hvigorw assembleHap …`（`overall-plan.md` §6） | ✅ 通过 |
| `TC-ARK-003` | 装机（授权面就位） | L1 | 107 | 输出含 `install bundle successfully.` | `hdc install -r $HAP` | ✅ 通过 |
| `TC-ARK-004` | 启动无崩溃 | L1/L2 | 101 | `hilog` 中 `Cpp Crash` **0 命中**；应用与渲染子进程存活 | `hdc shell hilog -x \| grep -E "Cpp Crash\|org.fellow99.pi"` | ✅ 通过 |
| `TC-ARK-005` | JIT/WASM 档位 | L3 | 101 | `/facts`：`wasm.available=true` 且 `wasm.validate=true`；热循环 **6–9 ms/2e6**；`execArgv=['--no-verify-heap']` | `hdc fport tcp:15577 tcp:15577 && curl -s http://127.0.0.1:15577/facts` | ✅ 通过 |
| `TC-ARK-006` | 日志读回通道 | L2 | 101 | `curl /log` 返回非空文本且含库/载荷输出行（⚠️ 同时会混入 `arkweb/chromium_ext/…` 噪声，属已知） | 同上的 `/log` | ⚠️ 通过（噪声待库侧修复：⑱） |
| `TC-ARK-007` | 包体与压缩方式 | L0/L4 | 102/107 | HAP 内**原生库** `compress_type` == 8（DEFLATE）；包体与本文件 §5 的预算一致 | `python -c "import zipfile;…"`（见 §5 实测脚本） | ⚠️ **部分通过（2026-10-17 实测）**：三个 `.so` 全部 `compress_type=8` ✅（签名 HAP **46,031,244 B**，此前 129,535,202 B / 全 0）；`resources/rawfile`、`resources/resfile` 仍为 `0（STORED）`（不随 `compressNativeLibs` 压缩）⇒ 规划附录 A 的「全部为 8」需按实测修订或说明 |
| `TC-ARK-008` | 单实例 | L2 | 101 | 二次启动后 `aa dump -l` 只出现一个该包名实例；第二个 `aa start` 不产生新窗口 | `hdc shell "aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk"` ×2 + `aa dump -l` | ⬜ 待执行（Phase 1；现状 `launchType` 未显式声明） |
| `TC-ARK-009` | 端口冲突下的可见失败 | L2 | 101 | 占用候选端口后启动：界面出现**可截图的失败态**，且 `hilog` 之外**没有**应用进程静默消失 | 先起占端口的进程 → `aa start` → 截图 | ⚠️ **现状不通过**（✅ 已实测会整进程 abort）⇒ Phase 1 随机端口 + 载荷兜底 |
| `TC-ARK-010` | 首启耗时 | L3 | 102/103 | 冷启动到「可输入消息」≤ 15 s；首启与二次启动耗时差可测（幂等跳过生效） | 真机计时 + `hilog` 阶段时间戳 | ⬜ 待执行（Phase 1，O6） |
| `TC-ARK-011` | 会话跨重启存活 | L2 | 102/103 | 强杀应用 → 重启 → 会话列表含该会话且末条消息文本一致 | 截图（前/后）+ `pi-agent/sessions/**/*.jsonl` 落盘 | ⬜ 待执行（Phase 1） |
| `TC-ARK-012` | AI 生成内容标识 | L2/L4 | 107 | 主界面在两次不同时刻的截图中均可辨认标识文本 | `hdc shell snapshot_display -f …` ×2 | ⬜ 待执行（Phase 3，G6） |
| `TC-ARK-013` | 三语资源一致性 | L0/L4 | 107 | `base`/`zh_CN`/`en_US` 的 `string.json` 键集合一致（当前 8 条 reason 三语齐全；`module_desc`/`EntryAbility_*` 仅 base） | 键集合 diff 脚本 | ⬜ 待执行（Phase 3） |
| `TC-ARK-014` | 回归四件套 | L0–L4 | 全部 | ① 产物 SHA-256 ② 首启耗时 ③ 包体+压缩方式 ④ `/facts` 四字段：与上次基线逐项对照无恶化 | `overall-data-model.md` §6.4 | ⬜ 待执行（Phase 4） |

### 2.2 `101-runtime-integration`（运行时接入）

| 用例族 ID | 名称 | 层 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-101-001` | HAR 依赖接线 | L0 | `ohpm install` 后 `oh_modules/@fellow99/node-bridge` 存在；构建不报 `00309001` | `./scripts/build-bridge-har.sh` + `assembleHap` | ✅ 通过 |
| `TC-101-002` | 探活判据与真实端点一致 | L1/L2 | 探活成功时目标端点返回 200（**当前探 `/`，骨架载荷只答 `/facts`/`/log` ⇒ 404，`READY` 不可达） | `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:15577/` vs `/facts` | ⚠️ **现状不通过**（代码级事实，`ARCHITECTURE.md` §3.4）⇒ Phase 1 收口 |
| `TC-101-003` | 载荷物化 | L1 | 启动后 `<filesDir>/payload/selfcheck.js` 存在且内容 == rawfile 原文；`hilog` 出现 `载荷已物化：…` | `hilog` + `curl /log` | ✅ 通过 |
| `TC-101-004` | `start()` 幂等 | L1 | 二次 `launch()` 返回 `already running: …`；库侧二次 `start()` 返回 `ok=false`（`message` 含「只能启动一次」） | 代码路径 + `hilog` | ⬜ 待执行（Phase 1，需可注入的调试入口） |
| `TC-101-005` | 环境装配生效 | L1 | 载荷内读 `process.env`：`PI_CODING_AGENT_DIR`/`PI_OFFLINE` 为期望值；`HOME`/`TMPDIR` 落在 `<filesDir>` | ⬜ 需扩展 `/facts` 或诊断端点输出 env 子集 | ⬜ 待执行（Phase 1） |
| `TC-101-006` | 随机端口 + 回传 | L2 | 连续 3 次启动端口不固定；占用任一候选端口仍能起；`payload/port` 与 `/facts` 监听端口一致 | 3× 启动 + 截图/`curl` | ⬜ 待执行（Phase 1，硬约束 ⑰） |
| `TC-101-007` | 单实例显式声明 | L1/L2 | `module.json5` 含 `launchType: "singleton"`；二次启动不产生第二实例（同 `TC-ARK-008`） | 配置断言 + `aa dump -l` | ⬜ 待执行（Phase 1） |
| `TC-101-008` | 崩溃终态 UX | L2 | 注入一次载荷崩溃后：界面显示终态失败 + 「请重启应用」；**不出现**自动重启 | 截图 + `hilog` | ⬜ 待执行（Phase 1） |
| `TC-101-009` | 优雅关停 | L2 | 关闭窗口触发 Node 侧关停钩子（日志可见）；超时才强退；再启动能就绪 | `hilog` + 重启截图 | ⬜ 待执行（Phase 2；库侧 `shutdown()` 亦未实现） |
| `TC-101-010` | 日志面板读回 | L2 | 点「日志」后界面出现非空日志文本（含服务侧行） | 截图 | ⬜ 待执行（Phase 1；`Index.ets:70` 现有占位文案） |
| `TC-101-011` | 载荷异常兜底 | L1 | 载荷触发内部异常后进程**仍存活**，`payload/app.log` 有记录 | `curl /log` 或第二端点 + 截图 | ⬜ 待执行（Phase 1，⑱） |

### 2.3 `102-payload-pipeline`（载荷流水线）

| 用例族 ID | 名称 | 层 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-102-001` | 只读直读投放 | L1/L2 | 载荷落在 `resfile/pi-web/`；Node 从安装目录直读，`require` 全链成功；首启无可观测解压等待 | 真机启动 + `/log`（P0-13） | ⬜ 待执行（Phase 1） |
| `TC-102-002` | 裁剪 1：`.nft.json` | L2 | 删除 76 个 `.nft.json` 后离线真机仍能起服务（无 `Cannot find module`） | 真机启动 + `/log`（O1） | ⬜ 待执行（Phase 1） |
| `TC-102-003` | 裁剪 2：win32 SWC | L2 | 删除 `node_modules/@next`（win32 `.node`）后离线起服务；`tmp/next-swc` **不出现**（无联网补下载） | 真机 + 目录检查（O2） | ⬜ 待执行（Phase 1） |
| `TC-102-004` | 裁剪 3：`@img`（sharp） | L2 | 删除后图片相关路径不报错（`images.unoptimized` 生效） | 真机 + `/log` 无 `sharp` 报错 | ⬜ 待执行（Phase 1） |
| `TC-102-005` | 裁剪 4：`node-pty` | L2 | 删除后无代码路径触发 `require('node-pty')`（终端面板不做） | 真机 + `/log` | ⬜ 待执行（Phase 1） |
| `TC-102-006` | 体积实测与预算更新 | L0 | 裁剪后 `du -sb` 与 `tar.gz` 实测值写入 `overall-data-model.md` §6.3；签名 HAP 重新量 | `du -sb` / `stat` / `ls -l $HAP`（O6） | ⬜ 待执行（Phase 1） |
| `TC-102-007` | 首启与阶段文本 | L2/L3 | 若走解包路线：解包耗时与阶段文本可见、失败可重试；若直读：无可观测解压阶段 | 截图序列 + 计时 | ⬜ 待执行（Phase 1） |
| `TC-102-008` | 幂等（内容级） | L2 | 二次启动幂等跳过（marker 摘要一致）；改动载荷后 marker 变化并重新就位 | 两轮启动 + marker 文件 | ⬜ 待执行（Phase 1） |
| `TC-102-009` | 进程内 Next 托管 | L2 | `/` 返回 200 且含 UI 标记；`/api/*` 至少一条返回 200 | `hdc fport` + `curl -sI` | ⬜ 待执行（Phase 1） |
| `TC-102-010` | `resfile` 读取边界 | L1 | 真机读取一个大文件成功；`require` 全链成功；写入安装目录失败且报错可读 | 真机 + `/log`（A6） | ⬜ 待执行（Phase 1） |

### 2.4 `103-arkweb-shell`（渲染壳）

| 用例族 ID | 名称 | 层 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-103-001` | 本地首屏可见 | L2 | 启动早期截图出现 `boot.html` 的标题与阶段文本（非空白） | `snapshot_display` | ⬜ 待执行（截图未归档；配置已在位） |
| `TC-103-002` | **ArkWeb 访问 `127.0.0.1`** | L2 | 截图出现 Pi Web UI 首屏；服务侧访问日志/`/log` 出现来自渲染进程的请求 | 截图 + `/log`（**P0-3**） | ⬜ 待执行（Phase 1，最高优先级） |
| `TC-103-003` | 渲染侧本地存储可用 | L2 | SPA 首屏不崩且可用会话级 UI 状态（无 `localStorage is null` 报错） | 截图 + 渲染侧控制台证据 | ⬜ 待执行（Phase 1） |
| `TC-103-004` | `databaseAccess` 是否必需 | L2 | 关闭该开关时 SPA 功能是否报错；结论写回 `TECH.md` §6 | 对照两次启动 | ⬜ 待执行（Phase 1） |
| `TC-103-005` | 清历史 + 返回键守卫 | L2 | 切到本地服务页后按返回键：**不回到** boot 页 | `uitest uiInput keyEvent` + 截图 | ⬜ 待执行（Phase 1） |
| `TC-103-006` | 外链围栏（主框架） | L2 | 点击外部链接后主界面未被导航走；出系统浏览器/应用内承载页；子 frame 请求放行 | 操作截图 + 录像 | ⬜ 待执行（Phase 1–2） |
| `TC-103-007` | 新窗口拦截 | L2 | `window.open` 不产生空白/不可操作新窗口，按分流处理 | 截图 | ⬜ 待执行（Phase 1–2） |
| `TC-103-008` | SSE 长连接与前后台 | L2 | 流式回复期间连接不中断；前后台切换后流式能继续或可续 | 计时 + 截图（**A5**） | ⬜ 待执行（Phase 1） |
| `TC-103-009` | 渲染侧能力面 | L2 | 逐项测 SSE / Worker / wasm / `crypto.subtle`（缺失项记录并给注入兜底方案） | 渲染侧断言 + 截图（R4） | ⬜ 待执行（Phase 1） |
| `TC-103-010` | 渲染进程模型 | L2 | `aa dump`/`hilog` 能区分渲染进程边界，结论写回文档 | `aa dump` + `hilog`（O9） | ⬜ 待执行（Phase 1） |
| `TC-103-011` | ArkTS 加载页/错误页 | L2 | 失败时界面出现 **ArkTS 侧**（非 Web 页）错误页；阶段文本随实际阶段变化（≥2 种） | 截图序列 | ⬜ 待执行（Phase 1） |
| `TC-103-012` | 重试语义正确 | L2 | 「重试」只重做可重做阶段（重新探活/重新投放），**不**声称重启 Node；但 Node 已可用时不得产生第二实例 | 截图 + `hilog` | ⬜ 待执行（Phase 1） |

### 2.5 `104-host-capabilities`（宿主能力）

| 用例族 ID | 名称 | 层 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-104-001` | 权限预检 | L2 | 未授权时返回「未授权」结构化结果（非空值/假成功） | 截图 + `/log` | ⬜ 待执行（Phase 2） |
| `TC-104-002` | 去系统设置入口 | L2 | 点击后能到达本应用设置页 | 截图 | ⬜ 待执行（Phase 2） |
| `TC-104-003` | 目录选择器 | L2 | 两方案各一次：能选目录，返回值能被用作工作目录（工具在其中读写成功） | 截图 + 工具输出（**O8**） | ⬜ 待执行（Phase 2） |
| `TC-104-004` | 外链能力（真正注册） | L2 | 调用后系统浏览器打开；**不得**复现旧壳 `ExternalWeb.Open` 的空指针崩溃 | 截图 + `hilog` 无 SIGSEGV | ⬜ 待执行（Phase 2） |
| `TC-104-005` | 通知（可选） | L2 | 出现系统通知且内容不含凭据 | 截图 | ⬜ 待执行（Phase 2，按需） |
| `TC-104-006` | 剪贴板粘贴 | L2 | 授权后粘贴文本/图片进入输入框；未授权时提示可读 | 截图 | ⬜ 待执行（Phase 2） |
| `TC-104-007` | 窗口尺寸记忆 | L2 | 改尺寸→重启→尺寸保持（`preferences` 生效） | 两次截图对比 | ⬜ 待执行（Phase 2） |
| `TC-104-008` | 未注册能力报错 | L1 | `HostBridge.dispatch('nope', '{}')` 返回 `{"ok":false,"error":"unregistered",…}` | 单元/调试通道 | ⬜ 待执行（Phase 2；库侧已有该行为） |

### 2.6 `105-auth`（鉴权）

| 用例族 ID | 名称 | 层 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-105-001` | 路线 ① 免密首屏 | L2 | 首屏**不出现登录页**，直接是主界面 | 截图 | ⬜ 待执行（Phase 1） |
| `TC-105-002` | `/api/*` 免密可通 | L2 | 无 `Authorization` 头即返回 200 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/api/…` | ⬜ 待执行（Phase 1） |
| `TC-105-003` | 路线 ② cookie 注入可通 | L2 | 注入 `pi_web_session` 后首屏无登录页且 `/api/*` 200 | 截图 + `curl` 带 cookie | ⬜ 待执行（Phase 1，仅路线 ① 被证伪时） |
| `TC-105-004` | cookie 值形态正确 | L1 | 值为 `v1.<exp>.<nonce>.<HMAC-SHA256>` 且被上游接受（非 401/重定向登录） | `curl` 带 cookie | ⬜ 待执行（Phase 1） |
| `TC-105-005` | 失败节流生效 | L2 | 连续错误密码被拒绝并节流（上游行为），不因壳侧注入绕过 | `curl` 循环 | ⬜ 待执行（Phase 1） |

### 2.7 `106-tools-extensions`（工具扩展）

| 用例族 ID | 名称 | 层 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-106-001` | `bash` 同名扩展可用 | L2 | 命令输出正确 + 退出码正确（如 `exit 3` → rc=3）+ 常驻 shell **仍存活**（可继续执行） | 会话内工具调用 + 截图 | ⬜ 待执行（Phase 1） |
| `TC-106-002` | `find`/`grep` 同名扩展 | L2 | 无外部 `fd`/`rg` 仍可用；输出写明跳过规则与单文件上限（512 KiB） | 截图（输出文本） | ⬜ 待执行（Phase 1） |
| `TC-106-003` | 工作区主目录清单 | L2 | `/roots` 类自检输出四个主目录解析结果与授权状态；不可判定时显示「不可判定」而不猜 | 截图 + `/log` | ⬜ 待执行（Phase 1–2） |
| `TC-106-004` | 预置模板不覆盖 | L1 | 篡改 `settings.json` 后重启，内容保持（只在缺失时写） | 真机文件读回 + `/log` | ⬜ 待执行（Phase 1） |
| `TC-106-005` | 平台缺口如实提示 | L2 | 终端/`git` 相关入口给出「不可用 + 原因」文案（宪法 A6） | 截图 | ⬜ 待执行（Phase 2） |

### 2.8 `107-compliance`（合规）

| 用例族 ID | 名称 | 层 | 判据（可证伪） | 命令/证据 | 状态 |
|---|---|---|---|---|---|
| `TC-107-001` | G1 ArkWeb 形态 | L4 | 渲染链使用 ArkWeb；材料口径可复述（`ARCHITECTURE.md` §9） | 材料 + 截图 | ⬜ 待执行（Phase 3） |
| `TC-107-002` | G2 无浏览器语义 | L0 | `module.json5` 的 `skills` **不含** `entity.system.browsable` / `ohos.want.action.viewData` | 配置断言（`module.json5:29-38`） | ✅ 通过 |
| `TC-107-003` | G3 无第三方浏览器内核 | L0/L4 | HAP 内 `libs/` 只有 `libnode.so`/`libnode_bridge.so`/`libc++_shared.so`；**无** Chromium/Electron 件 | HAP 清单（§5 脚本） | ⬜ 待执行（Phase 3；形态已成立） |
| `TC-107-004` | G4 许可清单随包 | L0 | 包内存在第三方许可清单，含 Node/V8/OpenSSL 与上游 MIT，附 `libnode.so` 来源与 SHA-256 | 产物检查 | ⬜ 待执行（Phase 3） |
| `TC-107-005` | G9 PoC 清理 | L0/L4 | 发布构建内**不存在** `--inspect`、诊断开关、`/facts`、`/log` 调试端点 | 产物 + 运行期探测 | ⬜ 待执行（Phase 3） |
| `TC-107-006` | G10 无「内测/测试/预览版」 | L4 | 首启截图与包内文案检索均为 0 命中 | 截图 + 文本检索 | ⬜ 待执行（Phase 3） |
| `TC-107-007` | G11 无绕行组件 | L0 | 发布物内不存在预签名模板/`mremap` 类绕行实现 | 产物 + 分支隔离记录 | ⬜ 待执行（Phase 3；架构上已成立） |
| `TC-107-008` | G7 三一致 + 版本递增 | L0/L4 | 图标/名称/备案名一致；`versionCode` 大于上一发布版 | `AppScope/app.json5` + AGC 材料 | ⬜ 待执行（Phase 3） |
| `TC-107-009` | G6 AI 标识 | L4 | 同 `TC-ARK-012` | 截图 ×2 | ⬜ 待执行（Phase 3） |
| `TC-107-010` | G8 隐私声明可达 | L4 | 链接可打开（系统浏览器或应用内承载页） | 截图 | ⬜ 待执行（Phase 3） |

---

## 3. 四条真机取证通道 + 端到端证书

```bash
HDC='D:\oh-workspace\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
HAP=entry/build/default/outputs/default/entry-default-signed.hap

# ── 通道 ①「看」：截图（唯一能对「界面文案」取证的通道）──
hdc shell snapshot_display -f /data/local/tmp/s.jpeg && hdc file recv /data/local/tmp/s.jpeg ./

# ── 通道 ②「点」：模拟输入（坐标取自截图）──
hdc shell uitest uiInput click <x> <y>
# ⚠️ `uitest dumpLayout` 在本机拿不到结果 ⇒ 不用于取证（库 §D.8）

# ── 通道 ③「回传」：端上日志 POST 到开发机 ──
hdc rport tcp:19999

# ── 通道 ④ hilog ──
hdc shell hilog -x | grep -E "Cpp Crash|node-bridge|org.fellow99.pi"

# ── 端到端证书（最有价值的一条）：不经 UI 直接读回运行时事实 ──
hdc fport tcp:15577 tcp:15577 && curl -s http://127.0.0.1:15577/facts   # JIT/WASM/热循环/路径
hdc fport tcp:15577 tcp:15577 && curl -s http://127.0.0.1:15577/log     # 载荷与库日志尾

# ── 装机/启动前置（顺序不能错）──
hdc install -r $HAP
hdc shell "aa force-stop org.fellow99.test.NodeProbe"    # ⚠️ 探针占 15577，先腾出
hdc shell "aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk --ps probeFlags '--no-verify-heap'"
hdc shell "aa dump -l"                                   # 前台确认（截图/uitest 只作用前台）
```

**取证纪律**：每轮必须同时留「原始输出」（JSON 文本 / hilog 片段 / 截图文件）+「复现命令」；证据落 `docs/evidence/YYYY-MM-DD-*.md`；
沙箱内文件 `hdc` 读不到（debug 签名也不行）⇒ 涉及运行时可见性的结论**只能**从应用域或 HTTP 端点取。

---

## 4. 禁止的判据（与宪法 A7 同源）

| 禁用 | 为什么 | 替代判据 |
|---|---|---|
| `uitest dumpLayout` 的返回内容 | 本机拿不到结果（✅ 库 §D.8） | 截图 / `/facts` / `/log` |
| hilog「有没有那一行」 | 日志行不保证可观测（曾被 ArkWeb 原生输出淹没） | `wasm.validate`、热循环数值、返回字段精确匹配 |
| 「日志出现 `(target MAGLEV)`」 | 该行**不可观测**（已被官方替代判据取代） | `/facts` 的 `wasm.*` + 热循环 |
| `VmSize` / 进程存在性判 V8 是否起来 | 与 V8 是否可用无因果关系 | `/facts` 的 `node`/`versions` |
| 「点了一下看起来生效」 | 无因果 | 截图前后对比 + 状态字段 |
| 「目录存在」判载荷就位 | 会掩盖就地升级失效 | 内容级 marker（SHA-256） |
| 「重试后成功」掩盖首次失败 | 掩盖真实失败面 | 首次失败必须单独取证 |
| 只跑 debug 而声称 release 行为 | 调试通道/日志级别不同 | release 构建单独跑 `TC-107-005` |

---

## 5. 已有基线数值（✅ 2026-10-16，HAD-W24 / 7.0.0.107(SP7C00E100R13P5) / API 26 / OpenHarmony-7.0.0.105 / arm64-v8a）

| # | 项 | 基线值 | 取证方式 |
|---|---|---|---|
| B1 | Node | `v24.2.0` / `platform=openharmony` / `arch=arm64` / `versions.modules=137` / `v8 13.6.233.10-node.17` / `uv 1.51.0` / `undici 7.10.0` / `openssl 3.0.16` | `curl /facts` |
| B2 | **JIT/WASM（ACL 生效）** | `wasm.available=true`、`wasm.validate=true` | `curl /facts` |
| B3 | `execArgv` | `['--no-verify-heap']`（**不带** `--jitless`） | `curl /facts` |
| B4 | 热循环 | **6–9 ms / 2e6 次**（解释器基线约 59 ms/2e6 ⇒ 约 7–10×） | `curl /facts` 的 `hotloop_ms_2e6` |
| B5 | 崩溃 | `hilog` 中 `Cpp Crash` **0 命中**；应用 + 渲染子进程存活 | `hilog` |
| B6 | 沙箱路径 | `homedir=/data/storage/el2/base/haps/entry/files`、`tmpdir=…/files/tmp`、`cpus=0`、`netifaces=[lo,wlan0,ancowlan0]` | `curl /facts` |
| B7 | 签名 HAP | `entry-default-signed.hap` **46,031,244 B**（压缩开关落地后实测，2026-10-17）；`libs/arm64-v8a/libnode.so` 126,809,264 B（HAP 内为 DEFLATE 存储） | `ls -l` + HAP 清单 |
| B8 | **装机失败样例** | `error: failed to install bundle. code:9568289 / error: install failed due to grant request permissions failed. PermissionName: ohos.permission.READ_PASTEBOARD` | `hdc install -r`（Profile 无 ACL 时） |
| B9 | ✅ **已修（2026-10-17，B4/R2）** HAP 内压缩 | `libs/*.so` 三个全部 **`compress_type=8`（DEFLATE）**：`libc++_shared.so` 1,262,504 / `libnode.so` 126,809,264 / `libnode_bridge.so` 28,040；`resources/rawfile/*`、`resources/resfile/*` 仍为 `0`（STORED） | `python -c "import zipfile;…"`（见下行脚本；命令与输出见 `overall-data-model.md` §6.2） |
| B10 | 端口冲突后果 | 15577 被占 ⇒ 载荷 `EADDRINUSE` ⇒ **整个 App 进程 abort**（`Cpp Crash`，栈含 `libnode_bridge.so`） | `hilog` + 截图 |
| B11 | `/log` 噪声 | 16 KB 返回里大部分是 `arkweb/chromium_ext/…` 原生输出 | `curl /log` |
| B12 | `spawn` 可用性 | `data`/`exit`/`close` 三事件齐全、无僵尸（🔶 库 §D.8 与本机探针） | 探针 `/facts` |

> **核对脚本（B7/B9 通用）**：
> ```bash
> python -c "import zipfile;z=zipfile.ZipFile('entry/build/default/outputs/default/entry-default-signed.hap');
> print([(i.filename,i.file_size,i.compress_type) for i in z.infolist() if i.filename.endswith('.so') or 'resfile' in i.filename])"
> ```

---

## 6. 待验证清单（P0-* / O* / A*）与验证方式

| 编号 | 问题 | 验证方式（可证伪） | 关联用例 | 时限 |
|---|---|---|---|---|
| **P0-3** | ArkWeb 能否访问 `127.0.0.1`（含 Cookie 注入 API 是否可用） | 启动后截图出现 Pi Web UI 首屏；`/log` 出现来自渲染进程的请求；若失败则切鉴权路线 ②（cookie 注入可通即路线 ② 成立） | `TC-103-002`、`TC-105-001/003` | Phase 1（**最高优先级**） |
| **P0-4** | 子进程语义是否够用（`spawn` 事件） | 真机起一个短命令，观测 `data`/`exit`/`close` 是否齐全；设计仍不依赖（`bash` 用哨兵行） | `TC-106-001` | Phase 1（本机已 ✅，需在载荷内复现） |
| **P0-13** | `resfile` 只读直读是否可行（数万小文件 + `require` 全链） | 投放真实载荷后：`/` 200、`/api/*` 200、`require` 全链无 `MODULE_NOT_FOUND`；否则退 `tar.gz` + Node 自解包 | `TC-102-001`、`TC-102-010` | Phase 1（决定载荷形态） |
| **O1** | `.next/**/*.nft.json`（348 MB）能否删 | 删除后离线真机起服务成功（无 `Cannot find module` / 无网络回退） | `TC-102-002` | Phase 1 |
| **O2** | 删 `@next/swc-win32-*`（106 MB）后是否仍走 WASM SWC、是否触发联网下载 | 离线真机起服务；`tmp/next-swc` **不出现**；对照网络开关两种状态 | `TC-102-003` | Phase 1 |
| **O5** | MCP stdio 是否真不可用 | 真机起一个 stdio 服务器：`data`/`exit`/`close` 是否齐全、是否留僵尸 | `TC-106-001`（同族观测） | Phase 2 |
| **O6** | 首启耗时与 HAP 体积最终值 | 真机计时（冷启动→可输入）+ 产物解析；写入 `overall-data-model.md` §6 | `TC-ARK-010`、`TC-102-006` | Phase 1 |
| **O8** | 目录选择器最优形态（ArkTS picker + 授权 vs 宿主侧 browse） | 两方案各一次真机：能选到目录且被 agent 用作 cwd（工具读写成功） | `TC-104-003`、`TC-106-003` | Phase 2 |
| **O9** | ArkWeb 渲染进程模型（是否独立进程） | `aa dump`/`hilog` 观测 `:render`/`:gpu` 行为；结论写回 `ARCHITECTURE.md` §1 | `TC-103-010` | Phase 1 |
| **A5** | ArkWeb 是否支持 SSE 长连接 + 前后台/息屏行为 | 真机长连接计时（≥5 min）+ 前后台切换后流式是否继续/可续 | `TC-103-008` | Phase 1 |
| **A6** | `resfile` 下文件读取权限边界（只读？可否 `mmap`？） | 真机读取一个大文件 + `require` 全链；尝试写该目录应失败且报错可读 | `TC-102-010` | Phase 1 |

---

## 7. 用例编写规则（新增用例时必须遵守）

1. 每条用例**必须**有「层 + 覆盖模块 + 判据 + 命令/证据」四项，缺一不入索引；
2. 判据**必须**是可证伪的观测（截图 / HTTP 字段 / 日志文本 / 产物清单），**不得**写「功能正常」「无异常」；
3. ID 分配：跨模块横切用 `TC-ARK-xxx`；模块内用 `TC-1NN-xxx`（`1NN` = 规划 §14.2 的编号），编号**不复用**；
4. 执行后**必须**把状态从 ⬜ 改为结果，并把原始证据落 `docs/evidence/`；**未执行的一律保持 ⬜**；
5. 与基线相关的用例（`TC-ARK-005/007/010/014`）在**换运行时版本**（`runtime.lock.json` 变更）后**必须**重跑。
