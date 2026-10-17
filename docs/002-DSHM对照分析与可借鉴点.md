# 002 — DSHM 对照分析与可借鉴点（应用侧：载荷 · 就绪 · 门禁 · 观测）

> **对象**：`D:\GitHub\ohos\dshm`（DeepSeek Harness 的 HarmonyOS 移植），工作树 HEAD `1cb0db6`（2026-10-08）。
> **本文件的边界**：**只讲本应用（`pi-desktop-ark`）相关的部分** —— 载荷分发与解包、就绪判据、默认工作区、入口脚本生命周期、激活事务、打包期补丁、门禁纪律、观测性、jitless 的应用侧代价。
> **库侧**（libnode 加载链、原生符号闭包、NAPI 注册、Node↔ArkTS 传输协议）见
> [`../../ohos-node-bridge/docs/002-DSHM对照分析与可借鉴点.md`](../../ohos-node-bridge/docs/002-DSHM对照分析与可借鉴点.md)。
> **性质**：只读分析 + 应用侧落地结论。未修改 dshm 任何文件。
> **日期**：2026-10-17（REV-2 增补 E18 落地结果）。

---

## 0. 结论摘要（应用侧八条）

| # | 结论 | 证据 |
|---|---|---|
| 1 | **就绪判据用 TCP connect，不要用 HTTP 栈** —— dshm 实测 `@ohos.net.http` 打 `127.0.0.1` 15 s 全超时（系统代理）；我们读 `pi-web.ready.json` 绕开了这个问题，但**该文件的 pid 校验**仍值得核 | 🔶 沿用（`NodeRuntime.portAnswers`） |
| 2 | **默认工作区由 ArkTS 侧「认领」并经 env 注入**，Node 侧只 `lstat` + 探写、**绝不自己 mkdir**（应用进程直拼公共路径建目录必 EPERM） | 🔶 沿用（`claimPublicDownloadFolder` + `buildHostEnv`） |
| 3 | **入口脚本与载荷生命周期必须分离**（换载荷不该换 launch 脚本，回滚载荷不该把入口脚本一起回滚） | 🔶 沿用（`RuntimePort.ets:112-118`） |
| 4 | **激活事务**：staging → verify（三哨兵）→ health（未运行时真起一次）→ activate（写 `state.json`）→ 失败可回滚；`evict` 永不删 current/previous | 🔶 沿用（`CoreStore` / `Types.decideActivation`） |
| 5 | **打包期注入补丁**要四条：幂等标记、锚点缺失即 `die`、注入后语法自检、门禁**正向 + 反向 + 精确次数** | 🔶 沿用（dshm `pack-core` + `check-core-openharmony-patches.mjs`） |
| 6 | **门禁归真纪律**：必须在已知坏版本上红过；"没跑成"必须是第三种状态（`exit 3`）；**"CI 绿" ≠ "全绿"** | 🔶 沿用（`AGENTS.md`） |
| 7 | **观测面只有「文件 + hiLog + dumpLayout + /proc」**：stdout 不进 hiLog、`process.exit()` 会变 SIGABRT、hiLog 缓冲小且丢日志 ⇒ 时序类判据只信文件 | 🔶 沿用（`docs/70`） |
| 8 | **本工程的 WASM 路线与它不同**（我们自带 `wasm_bg.wasm` 30,393,446 B，E5 已证）⇒ **不要照抄它的 fetch/undici 垫片**，但"升级上游后重跑垫片/证据链"这条纪律同样适用 | ✅ 实测（E5） |

---

## 1. 证据口径

| 标记 | 含义 |
|---|---|
| ✅实测 | 本机或真机跑命令读出来的读数 |
| 🔶沿用 | 读 dshm 源码/文档并采信，**未在设备上复验** |
| ⬜待验证 | 本文提出但未跑过 |
| ⚠️受限 | 想验但验不了 |

---

## 2. 两个工程的形状对照（应用视角）

| 维度 | `pi-desktop-ark` | DSHM |
|---|---|---|
| 被搬的东西 | `pi-web`（Next.js agent 前端 + 服务端） | dsh core（DeepSeek Harness 核心树） |
| 代码/资源分发 | `resfile` + 单 `tar.gz` + `.version` sha 锚 | `resfile` + 单 **zip** + `.dshm-bundled-stamp`（字节数指纹） |
| 版本并存 | `payload/<sha12>/pi-web`（目录名即指纹） | `dsh/cores/<version>/` + `state.json{current,previous,history}` |
| 上层怎么说话 | HTTP（`pi-web.ready.json` 给端口） | HTTP/WS 回环 + `host-ready.json`（token + **pid 校验**） |
| 前端渲染 | WebView 打开本地 `pi-web` | WebView 打开本地 dsh web，ArkTS 壳另做原生顶栏/设置/托盘 |
| 首启代价 | 解 81 MiB 归档（27,181 文件条目） | 解 ~56 MB zip（2.5 万文件），几十秒 |
| 权限面 | 11 项（见 `ACL配置.md`） | 11 项 = 6 普通 + 5 ACL |

---

## 3. 就绪判据与「旧进程」防护

### 3.1 不要用 HTTP 栈判活

dshm `NodeRuntime.portAnswers()` 用 `socket.constructTCPSocketInstance().connect({address:'127.0.0.1', port})`，理由（原文）：

> 设备外经 `hdc fport` 能拿到 401，但**应用进程内** `http.createHttp()` 的 GET 在 15 s 预算里**全部** connect/read 超时。HTTP 栈受系统代理影响（"代理不回传 127.0.0.1 是标准行为"）；而 TCP connect 是"在不在监听"的最原始事实。

本工程的做法等价且更强：载荷自己写 `pi-web.ready.json`（端口权威），ArkTS 只读它。

### 3.2 ⭐ `ready.json` 必须校验 pid

dshm 的 `host-ready.json` 读法带一票否决：

```ts
const pidInFile = `${parsed.pid}`;
if (pidInFile !== `${process.pid}`) { /* 属于旧进程 ⇒ 等本次写入 */ }
```

理由：**应用重启的窗口里可能读到上一次进程留下的文件**，其 token 对本次无效（dshm 每次启动换 token）。

**本工程待办（D1）**：核 `pi-web.ready.json` 是否带 pid 校验。我们已用「作废 marker + 只认本轮日志」解决端口问题（`invalidateReadyMarker`），但 pid 是更直接的一条判据。

### 3.3 短重试跨过「端口通 → 写文件」的窗口

dshm `AUTH_URL_RETRY = 5 × 500 ms`。我们 `READY_MARKER_TIMEOUT_MS` 已是轮询形态，等价。

---

## 4. 默认工作区：ArkTS 认领、env 注入、Node 只验证

### 4.1 三条纪律（dshm `buildHostEnv` 的注释）

1. **在 spawn 之前 `await` 认领**（`DocumentPickerMode.DOWNLOAD` 的 `save()`，无 UI，实测 ~106 ms）。理由：**env 是 spawn 时定死的，天然无竞态**；若改成"启动后写状态文件给 Host 读"，Host 早已用旧值算完默认工作区。
2. **Node 侧只 `lstat` 判目录 + 真探写，不再自己 mkdir** —— 应用进程直拼公共路径建目录**必 EPERM**。
3. **空串时不写这一项**：Host 靠"这一项不存在"判回退（绝不允许 cwd 变成 `/` 或空串）。

### 4.2 与我们的关系

- 我们的 `P1a 沙箱根派生`（`sandboxRoot(filesDir)` + 启动断言）是同一族问题。
- **待办（D4 的一部分）**：核 `env.js#buildEnv` 在值为空时是否**不写**该键（目前 `PI_HOS_ROOTS` 有兜底逻辑，需确认回退路径不会注入空路径）。

---

## 5. 入口脚本与载荷的生命周期分离

dshm `RuntimePort.ets:112-118` 原文：

> `entryScript` … **不属于任何一版核心树**：核心树是可切换/回滚的，而入口脚本随应用发版，两者生命周期不同，混在一起会导致"回滚核心版本把入口脚本也换掉了"。

配套：`DSH_HOME`（用户数据）与核心树分离 —— 会话/设置/凭据/工作区跨版本共享，"升级核心不得动用户数据"。

**本工程待办（D4）**：核 `pi-web-launch.js` 是否落在 `payload/<sha12>/` 内。若是，则"换载荷 = 换 launch"，与这条正好相反。（注：`bootstrap.js` 在 `resfile/pi-web/` 顶层、与归档同层，这一条**已符合**。）

---

## 6. 激活事务（状态机 + 快照指纹 + 回滚）

```
install   → 解压到 <v>.staging（不动 state）
verify    → 顶层目录 + 元数据文件 + 三哨兵（刻意**不做**全树计数：2.5 万文件数一遍太贵）
health    → 未运行时**真起一次**，端口应答即 PASS；
            正在运行时**不启候选**（同进程二次 node::Start ⇒ SIGABRT），改"安排激活 + 重启应用生效"
activate  → 写 state.json{current,previous,history}；候选空/health≠PASS/已是 current 各有明确处置
rollback  → previous 空/相同/目录不存在 ⇒ REFUSE
清理      → evict 永不删 current/previous；.staging/.tmp 不参与枚举
```

- 失败姿态：`dropStaging()` / 保持原版本 / 拒绝覆盖"正在使用中"的版本 / `状态写入失败，保持原版本：…`。
- 指纹：dshm 用 `.dshm-bundled-stamp = zip 字节数`（⚠️ 它自己登记了弱点：**新旧 zip 恰好同尺寸会被跳过**）。

**与本工程的关系**：我们的 `<sha12>` 目录名本身就防"同尺寸"问题（更强）。但"**在跑时不启候选**"这条对我们是**硬约束** —— 若将来想让 payload 热切，必须先确认这一点。

---

## 7. 打包期注入补丁与门禁纪律

### 7.1 注入补丁的四条要求（dshm `pack-core`）

1. `includes(MARK)` **幂等跳过**；
2. 锚点不在 ⇒ `die("…拒绝静默跳过")`；
3. 注入后 `node --check` **全文语法自检**；
4. 门禁**正向**（标记在、出现次数精确）+ **反向**（上游原文反例不得残留）。

**本工程对照**：`patches/v0.12.1/*.patch` + `PI_WEB_PATCH_MARKERS` 已有正向断言；**缺反向断言与精确次数**（待办 D5：防"补丁打两遍 / 打丢一半"）。

### 7.2 门禁归真（四条判据 + 一条状态机）

1. **归真**：门禁必须先在**已知坏版本**上红过（"红必须绑定提交 id"—— HEAD 已含修复时会 0 命中）。
2. **假阳性比漏报更糟**（案例：180 条 → 2 条 → 0 条）。
3. **只 print 不校验 = 假门禁**（案例：图标 3577 B → 59441 B 仍打"未改动"）。
4. **断言方向要自洽**（`includes`/`!includes` 靠化石巧合长期通过）。
5. **"没跑成"必须是第三种状态**（`exit 3`），不能与"通过"共用 exit 0；**"CI 绿" ≠ "全绿"**（需要产物/设备的门禁不进 CI，会以 exit 2/3 结束）。

**本工程对照**：`assemble-payload.mjs` 的补丁失败已 `exit 2`；建议把"跳过了"也归非零（待办 D5）。

---

## 8. 观测性：可用面只有「文件 + hiLog + dumpLayout + /proc」

| 事实 | 后果 |
|---|---|
| **stdout 不进 hiLog** | 载荷日志必须自己落文件（我们已有 `app.log` / `node.log` 双通道） |
| **`process.exit(1)` 在鸿蒙上变 SIGABRT**（`Unexpected call: exit(1)`） | dshm 诊断期**拦截 `process.exit` 并拒绝退出**，先把调用栈落盘（待办 D7） |
| **hiLog 缓冲小、有丢日志前科** | 时序类判据只信文件标记；BOOT 标记"命名有序但**时间无序**" |
| **两个日志文件分工必须都拉** | 只拉一个曾导致"宿主从未就绪"的误判 |
| **`hdc shell` 对 `<base>/payload` 可读**（我们实测 `app.log` 0666 / `node.log` 0644 / `host-mailbox/heartbeat.log` 可 cat） | 这是本工程与 dshm 的**已知差异**：dshm 记的是"沙箱内日志不能用 hdc 直接读"，我们这边可读 ⇒ 取证更省事 |
| **`uitest dumpLayout` 在本设备有效** | UI 判据可用（dshm 记的是"拿不到结果"） |
| **心跳三用法** | ① 区分"进程被冻"与"JS 主线程被同步调用挡住"；② 桥的每次结果都要写（否则无法区分"成功"与"没处理"）；③ `ready.json` 是 ArkTS↔Node 的唯一事实通道 |

> 后两条（hdc 可读、dumpLayout 可用）是**本工程对 dshm 结论的实测反例**，已同步到库侧能力矩阵。

---

## 9. jitless 的应用侧代价（与我们不同的一条）

dshm 的连锁（不申请 JIT ⇒ `--jitless` ⇒ `WebAssembly === undefined`）：

1. 任何 `import('undici')` 必失败（`web_fetch` 坏、`web_search` 好）；
2. **必须两层垫片**：全局 `fetch` + `undici` **模块名解析钩子**；
3. 垫片缺 `Request`/`Response` 签名 ⇒ 一律表现成"空体 400"；
4. 升级上游后必须**重搜 undici 直接依赖**（当成验收项）。

**本工程**：走 **WASM 自带**路线（`next/wasm/@next/swc-wasm-nodejs/wasm_bg.wasm` = 30,393,446 B，E5 四段证据链）⇒ 处境不同，**不要照抄垫片**。
但第 4 条同样成立：**升级 `pi-web` 后要重跑 E5 的四段证据链**（TS 配置在位 / `@next` 下零原生包 / `.node` 计数 0 / `wasm_bg.wasm` 字节数）。

---

## 10. 宿主能力的实现顺序（与本工程 E 编号的映射）

传输层已由库侧文件信箱解决（真机 2 ms，见库侧 `002` §5）。应用侧只剩**能力实现**：

| 我们的项 | 内容 | 依据 | 状态 |
|---|---|---|---|
| **E14** | 选择器交互契约（Tab / 面包屑根围栏 / `truncated` / 新建文件夹默认名与去重 / 主目录记忆） | §H.4 的 8 条 · D8 | ✅ 补丁 0005（服务端读数真机验证） |
| **E17** | 对话框内主动弹授权窗（`abilityAccessCtrl.requestPermissionsFromUser` + active context） | §H.4 `FR-203-017` | ✅ 真机弹窗 + `authResult:0` |
| **E19** | 权限归因 + 「去系统设置」（SDK 无该 API ⇒ want `action=ohos.settings.application.details` + 归因话术） | `FR-203-015/016` · D7 | ✅ 真机跳设置页 |
| **E20** | 通知 `notify.show`（`notificationManager`） | D6 | ⚠️ 已实现；本机被系统拒绝 `1600004 Notification disabled` |
| **E21** | 系统文件选择器 `fs.pickFolder` / `fs.pickFiles`（`@ohos.file.picker`） | D5 | ✅ 选择器打开 + 取消路径真机通过 |

**实现纪律（来自 dshm 的三条）**：
1. **能力实现属消费方**（库只做寄存器 + 传输）—— 我们的 `HostCapabilities.install()` 正是这一层；
2. **每个能力返回结构化 JSON，永不抛**（`dispatch()` 的契约）；
3. **未注册 / 未实现必须显式**（`not-implemented` + `hint`），不能给一个点了没反应的入口。

**超时纪律**：`fs.pickFolder` 由用户决定耗时 ⇒ 调用方必须放宽 `timeoutMs`（库侧默认 15 s 会"必然超时"，这正是 dshm 那句"必然发生的，不是概率问题"）。

---

## 11. 不建议照抄（应用视角）

| 项 | 为什么 |
|---|---|
| **单包 ~300 MiB**（libnode 120.93 MiB + libvips + 工具链 + 语音模型） | 我们 HAP 131 MB（载荷 81 MiB），已经更小 |
| **固定端口 3120** | 我们随机端口 + `ready.json` 更抗冲突（`EADDRINUSE` 曾让整个 App abort） |
| **WebView 内注入 `client.js` 覆盖官方前端**（改麦克风采集、改主题） | 维护成本高、每次上游改版都可能失效；我们只做品牌化替换（E13） |
| **`coreVersion` 的 `+dshm.<n>` 人工递增** | 我们的 `sha12` 目录名是内容指纹，更强 |
| **`resfile` 里放 zip 再解包**（而不是 tar.gz） | dshm 用 zip 是因为只有 `@ohos.zlib.decompressFile`；我们由 **Node 自己解**，所以能直接用 tar.gz 且不需要 OHOS 解压器 |

---

## 12. 未验证 / 风险

1. ⬜ **`pi-web.ready.json` 是否带 pid**（D1）。
2. ⬜ **`pi-web-launch.js` 是否在 `payload/<sha12>/` 内**（D4）。
3. ⬜ **补丁的反向断言与精确次数**未加（D5）。
4. ⬜ **`process.exit` 拦截**未做（D7）。
5. 🔶 本文件所有"dshm 已验证"均引自其文档/注释，**不是**我在本设备复验的；两处实测反例（hdc 可读、dumpLayout 可用）已在 §8 标注。

---

## 13. 行动项（应用侧）

| # | 行动 | 成本 | 状态 |
|---|---|---|---|
| **D1** | 核并补 `ready.json` 的 **pid 校验**（§3.2） | 小 | ⬜ |
| **D4** | 核 `pi-web-launch.js` 是否落在 `payload/<sha12>/`（§5） | 小 | ⬜ |
| **D5** | 补丁门禁加"反向断言 + 精确次数"（§7.1） | 小 | ⬜ |
| **D7** | 观测性两条：`process.exit` 拦截落盘；BOOT 标记"命名有序/时间无序"显式说明 | 小 | ⬜ |
| **D3** | ~~E18 改走文件信箱~~ | — | ✅ **已完成**（真机 2 ms，见库侧 `002` §5） |
| **D6** | 原生 addon 闭包修复 | 大 | 移交库侧（`ohos-node-bridge/docs/002` §4.3），优先级低 |

---

## 附录 A：本文引用的 dshm 文件（应用侧）

| 文件 | 行数 | 作用 |
|---|---|---|
| `entry/src/main/ets/runtime/NodeRuntime.ets` | 379 | 载体实现（TCP 就绪、pid 校验、协作停止） |
| `hostruntime/src/main/ets/core/CoreStore.ets` | — | 版本仓库 / 解包 / 哨兵 / 激活 / 回滚 |
| `hostruntime/src/main/ets/core/Types.ets` | — | 纯判据 `decideActivation` / `decideRollback` / `evictionCandidates` |
| `hostruntime/src/main/ets/runtime/RuntimePort.ets` | 265 | 入口脚本独立性 + env 契约纯函数 |
| `tools/pack-core.mjs` | — | 注入式补丁 + 打包 + 校验 |
| `hostcore/app/main.js` | 5,338 | Node 入口脚本（BOOT 标记、stop 巡检、诊断引导） |
| `AGENTS.md` | 30,276 B | 回归纪律 / 门禁清单 / 出包三坑 |

## 附录 B：修订记录

| REV | 日期 | 内容 |
|---|---|---|
| 1 | 2026-10-17 | 初版：§0–§9 + 附录。含 §4 对 E18 归因的更正（基于本机 `llvm-nm`/`llvm-readelf` 实测） |
| 2 | 2026-10-17 | **拆库/应用边界**：libnode 链条、addon 闭包、文件信箱协议**迁入** [`ohos-node-bridge/docs/002`](../../ohos-node-bridge/docs/002-DSHM对照分析与可借鉴点.md)；本文件收敛为应用侧（载荷/就绪/工作区/激活/门禁/观测/jitless），并新增 §3.2 pid 校验、§10 能力实现顺序（E14/E17/E19/E20/E21）、§8 两条实测反例（hdc 可读、dumpLayout 可用） |
