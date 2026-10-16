# constitution.md —— `pi-desktop-ark` 项目宪法（应用宿主层原则）

> 本文件是 **Pi Desktop V2**（`org.fellow99.pi.PiDesktopArk`）的**最高约束**：任何 `spec.md` / `plan.md` / 实现 / 评审都必须先过这一关。
> 原则不是发明的，而是从**已落地的代码**、**本工程真机实测**与**旧壳的失败经验**中抽取的（依据列在每条末尾）。

| 项 | 值 |
|---|---|
| 权威规划 | [`../docs/000-工程规划.md`](../docs/000-工程规划.md)（v0.1，**本工程结论以它为准**） |
| 运行时契约 | [`../../ohos-node-bridge/docs/000-工程规划.md`](../../ohos-node-bridge/docs/000-工程规划.md) **§6**（库承诺什么 / 消费方必须自建什么） |
| 本工程实测 | [`../docs/ACL配置.md`](../docs/ACL配置.md) · [`../docs/evidence/2026-10-16-acl-jit-verified.md`](../docs/evidence/2026-10-16-acl-jit-verified.md) |
| 版本 / 状态 | v1.0 · 2026-10-16 · **生效** |
| 适用 | `entry/`（ArkTS 宿主与资源）· `scripts/`（host 侧流水线）· 载荷适配（Node 侧启动脚本）· `resfile/pi-web/` 载荷 · `specs/` |

> **与库宪法并列而不重叠**：库的 `specs/constitution.md` 管「**库只做进程内运行时**（C1–C7）」；
> 本文件管「**应用宿主只做壳**」。两边都碰的主题（`execArgv`、单例、日志、端口）以**库文档 §6.2 共享事实**为唯一口径。

---

## 一、十条不可协商的原则

### A1. 一切经 HTTP（Everything Over Same-Origin HTTP）

**前端与后端只通过「同源 HTTP + SSE」通信；不得加 preload 桥、不得引入 IPC 载体。**

- 主界面由**本地服务渲染**：`http://127.0.0.1:<port>/`（SPA）+ `/api/*` + SSE ⇒ **天然同源、零 CORS、零头改写**（✅ 上游源码：`pi-web/lib/request-security.ts:90-102` 对 loopback 主机名/IP 字面量直接放行，见 §6.1）。
- **业务数据不得走桥**：宿主能力桥（`perm.check` / `fs.pickFolder` / `shell.openExternal` / `notify`）只允许承载**宿主能力调用**，禁止把会话、消息、进度等业务数据塞进桥（那是 Electron 时代 `callArkTSFunction` 的老路）。
- 反面教材（不得复现）：`Electron` 式 `preload` + `executeJavaScript`、把 UI 状态镜像进宿主、用桥做流式传输。

依据：规划 §3.2、§4、§6.1、§6.2；库规划 §5.10 第 6 条（先例证据：ArkWeb 加载 `127.0.0.1` 页面 ⇒ 同源）。

---

### A2. 壳薄、契约硬（Thin Shell, Hard Contract）

**ArkTS 只做「启动 / 观测 / 宿主能力 / 渲染」四件事；业务一律在 Node 侧。**

| 壳只做 | 壳不做（一律在 Node 侧或上游） |
|---|---|
| Ability 与窗口、ArkWeb 组件与围栏 | 会话/消息/模型/工具语义 |
| 状态机、阶段文案、加载页/错误页/诊断面板 | 端口分配与就绪判定（Node 侧随机取端口） |
| 载荷投放与「只读直读」路径拼装 | Next 服务端进程内托管 |
| 宿主能力实现（权限/选择器/外链/通知/剪贴板） | 鉴权令牌派生（密码派生在 Node 侧，壳只注入） |

- 判定口径：**「这一条是不是业务语义？」—— 是，则一票否决**（照搬库宪法 C1 的判定方式）。
- 壳的每一处「自己实现」都要能指出规划 §5 的条目编号（16 项能力表）。

依据：规划 §1.3 责任分界、§3.2「壳薄、契约硬」、§5、§8.2。

---

### A3. 运行时结论以库文档为准（No Re-Derivation）

**本工程不复述、不重新论证运行时结论；只引用 + 验收。**

- 「为什么必须 `dlopen` + detached 线程」「JIT ↔ ACL ↔ WASM 链条」「`--jitless` 的量化代价」「`spawn` 可用性」「`dlopen` 只认裸名」等**全部引库文档 §4.7 / §5.10 / §D.8 / §D.10**，本工程规格只写「我们依赖了哪一条 + 怎么验」。
- 反向纪律：本工程发现的**应用层**结论（ACL 授权面、端口冲突 ⇒ 进程 abort、`dup2` 日志混流）**先写进** `docs/000-工程规划.md` / `docs/ACL配置.md`，`specs/` 只引用 §号，不复制粘贴。
- 运行时的任何改动（`runtime.lock.json` 换版本）⇒ 必须重跑 `/facts` 与四条真机取证通道（见 `overall-test-cases.md`）。

依据：规划 §0.1 边界纪律、§2.4、§15；库规划 §6.2 共享事实。

---

### A4. 不改上游（Zero Upstream Patch by Default）

**`pi` / `pi-web` 原样复用；只允许幂等、可反向的补丁，预计 0–2 条。**

- 优先用**现成机制**：同名工具扩展顶替（`bash`/`find`/`grep`）、环境变量开关、`node_modules` 落点。
- 补丁纪律：幂等、可反向（SHA-256 可往返还原）、不落在既有补丁的上下文区间、追加到列表末尾（沿用旧壳纪律）。
- 当前登记候选只有两条（**P-ark-1** 会话 cookie 认证、**P-ark-2** 工作区目录/权限桥消费点），且两条都**优先不补**（✅ 源码已证实 cookie 对 `/api/*` 生效；工作区补丁可直接沿用旧壳已验证的那条）。

依据：规划 §0.3 非目标、§3.2「不改上游」、§9。

---

### A5. 失败可见（Failures Must Be Screenshottable）

**任何一步失败都必须在界面上留下可截图的文字；崩溃是终态，明确提示重启应用。**

- 三件套：**状态机 + 阶段文本 + 日志尾**（规划 §5 第 12 条；启动时序见 §4）。
- **禁止**：白屏、静默重试、`catch` 后继续、把错误只写进日志。
- **崩溃不可假装恢复**：进程内 Node **没有重启路径**（库硬约束 ⑥）⇒ 失败态 UX 只允许「读日志 / 读崩溃记录 / 请重启应用」三种动作（库宪法 C5 同口径）。
- 「重试」的语义必须写清：重试 = **重做可重做的阶段**（重新探活 / 重新投放资源），**不是**重启 Node。

依据：规划 §3.1 第 7 条、§3.2「失败可见」、§4 启动时序、§7.3；库规划 §5.2、§6.1 生命周期。

---

### A6. 不隐藏平台真相（No Silent Degradation）

**平台缺口如实降级并在界面上说出来；不得静默降级。**

| 缺口（本工程视角，规划 §8.4） | 允许的降级 | 禁止的做法 |
|---|---|---|
| 无 PTY | 不做终端面板 | 做一个「看起来能用」的假终端 |
| 无 `git` / worktree | 相关功能不可用并提示 | 用 `bash` 悄悄顶替成「看起来能用」 |
| 用户目录直写需 OS 授权 + 重启 | 如实显示「未授权」 | 失败后重试成「保存成功」 |
| 后台常驻 / 开机自启不可用 | 不做 | 声明已支持 |
| 无 `rg` / `fd` | 同名扩展（纯 JS 近似规则）**并写明差异**（忽略规则更宽、单文件上限 512 KiB） | 声称与内建行为完全一致 |

依据：规划 §3.2「不隐藏平台真相」、§8.1、§8.4；旧壳扩展头注释（`pi-desktop-hos/extensions/harmony-search.js` 的「差异（必须知道）」小节）；库宪法 C2。

---

### A7. 判据可证伪（Falsifiable Acceptance Criteria）

**每条验收都写成「能观测到 X」或「X 消失」，禁止「看起来好了」。**

- 合法判据举例：`/facts` 的 `wasm.validate === true`（✅ 已达成，`docs/evidence/2026-10-16-acl-jit-verified.md`）；`hilog` 中 `Cpp Crash` **0 命中**；`hdc install -r` 返回 `install bundle successfully.`；返回值/字段名精确匹配。
- **禁止的判据**（本机实测过它们不可靠或用错）：用 `uitest dumpLayout` 拿结果（本机拿不到结果，库 §D.8）；用 hilog「有没有那一行」判执行；用 `VmSize` 判 V8 是否起来；用「点一下看起来生效了」判 UI；用「日志里出现了 `(target MAGLEV)`」判 JIT（该行不可观测，已被替代判据取代）。
- 每条判据必须写清**在哪里看**（截图 / HTTP 端点 / hilog / 回传日志）。

依据：规划 §3.2「判据可证伪」、§10.4（判据替代的先例）、附录 A；库规划 §5.7「禁止的判据」。

---

### A8. 单实例与随机端口（⑰，硬约束）

**监听端口必须随机（或先探测空闲）；应用必须单实例。**

- ✅ **实测链路**：指定端口被别的应用占用 ⇒ 载荷 `server.listen()` 抛 `EADDRINUSE` ⇒ **进程内 Node 的未捕获异常把整个 App 进程 abort**（`Cpp Crash`，崩溃栈含 `libnode_bridge.so`）；腾出端口后同一构建完全正常（`docs/ACL配置.md` §3.1、库 §D.10 ⑰）。
- 现状 ⚠️：骨架期仍是**固定端口 15577**（`entry/src/main/ets/common/Constants.ets:7` `DEFAULT_PORT`）⇒ **Phase 1 必须改为随机/先探测空闲**，并同时改探活与 `selfcheck`/`pi-web` 的取端口方式。
- 单实例：规划 §5 第 16 条要求 `launchType: singleton`；现状 ⬜ `entry/src/main/module.json5:15-39` 的 `EntryAbility` **未显式声明** `launchType`（默认行为未在本机复核）⇒ Phase 1–2 显式声明并真机验证「二次启动不产生第二个实例」。

依据：规划 §5 第 3/16 条、§6.3；`docs/ACL配置.md` §3.1；库规划 §D.10 ⑰、§6.2 共享事实 1。

---

### A9. 异常兜底（⑱，载荷自装）

**载荷必须自装 `uncaughtException` / `unhandledRejection` 兜底，并把错误写进自己的日志通道。**

- 理由同上：进程内 Node **没有优雅退出路径**，任何未捕获异常都是**应用级事故**（整个 App 消失）。
- **日志通道必须独立**：库原生层用 `dup2` 写 `node.log`，会**混入 ArkWeb/Chromium 的原生输出**（✅ 本工程实测：`/log` 返回的 16 KB 里大部分是 `arkweb/chromium_ext/...`）⇒ 载荷另写结构化日志（如 `payload/app.log`），**不靠 stdout 单通道**。
- 现状 ⬜：`entry/src/main/resources/rawfile/selfcheck.js` **未安装**这两个 handler，`server.listen` 也无 `error` 处理 ⇒ Phase 1 必补（同一处顺手把「端口被占用」变成可读错误而不是 abort）。

依据：规划 §6.3、§7.4 备注；`docs/ACL配置.md` §3.2；库规划 §D.10 ⑱、§6.2 共享事实 2。

---

### A10. 声明面 ≠ 授权面（Manifest Is Not A Grant）

**权限声明只代表「清单里有」；ACL 必须进 Profile，否则装都装不上。**

- ✅ 实测：Profile 不含权限项时 `hdc install -r` 直接失败 `code:9568289 / PermissionName: ohos.permission.READ_PASTEBOARD`；含 6 项授权的 Profile 生成后 `install bundle successfully.`（`docs/ACL配置.md` §2.1/§2.2）。
- 因此：**任何权限相关改动（增删项、改包名、改签名主体）都必须重走「申请 → 重新生成 Profile → 装机验证」**，装机成功本身即是「授权面就位」的判据。
- 三项 ACL（`kernel.ALLOW_WRITABLE_CODE_MEMORY`、`READ_PASTEBOARD`、`READ_WRITE_DESKTOP_DIRECTORY`）是**刚性前置**，不得用开放权限替代（✅ 探针实测：声明开放权限仍 SIGTRAP）。

依据：规划 §10；`docs/ACL配置.md` §1–§3；库规划 §D.8 轮次 ①/①′、§9.5。

---

## 二、代码规约（从现有代码抽取，实现必须一致）

| # | 规约 | 现状依据 |
|---|---|---|
| T1 | **ArkTS 严格模式**：不出现 `any` / `unknown` 逃生；取 context 走 `this.getUIContext().getHostContext()`，**不用**已弃用的全局 `getContext(this)` | `entry/src/main/ets/pages/Index.ets:32-38` |
| T2 | **资源字符串三语一致**：`base` / `zh_CN` / `en_US` 的 `string.json` 键集合必须一致（权限 `reason` 文案三语齐全） | `entry/src/main/resources/{base,zh_CN,en_US}/element/string.json`（8 条 reason 三语齐全 ✅）；⚠️ `module_desc`/`EntryAbility_desc`/`EntryAbility_label` 目前**仅 base**，Phase 3 前补齐 |
| T3 | **签名材料不入库**：`build-profile.json5` 的 `signingConfigs` 属**本地未提交改动**（DevEco 自动写入），`hvigorfile.ts` **不覆盖**它，只补 `products[].signingConfig` 指针 | `hvigorfile.ts:95-147`；`git status` 显示 `M build-profile.json5` ✅ |
| T4 | **二进制与大载荷不入库**：`entry/libs/`、`libs/**/*.har`、`resfile/pi-web/*`（保留 README） | 根 `.gitignore:17-24` ✅ |
| T5 | **路径一律绝对**：不依赖 `process.cwd()`（真机 = `/`）、不依赖 `process.execPath`（真机 = `/system/bin/appspawn`） | 库 §D.8 偏差表；`resfile/pi-web/README.md:17-19` |
| T6 | **端口、路径、阶段文案集中在 `common/Constants.ets`**，页面与编排层不写字面量 | `et/app/PiDesktopRuntime.ets:4`、`et/common/Constants.ets` |
| T7 | **原生库只经 HAR 消费**：跨工程源码相对导入被 `00309001` 拒（`useNormalizedOHMUrl: true` 下），必须走 `file:./libs/@fellow99/node-bridge.har` | `oh-package.json5:5-12`、`scripts/build-bridge-har.sh:4-11` |
| T8 | **日志谁写谁读**：载荷写自己的日志文件；宿主读回（`Logger.tail` / `/log` 端点 / 诊断面板）；不把「写成功」当归宿 | `library/src/main/ets/log/Logger.ets:26-52`；规划 §6.3 |
| T9 | **阶段分级标注**：文档与代码注释中，未实现的规划项必须写 `⬜ 规划未实现（Phase N）`，不得写成既成事实 | 本目录全部文档 |

---

## 三、证据纪律（Evidence Discipline）

全文使用四种标记，**不要把推断当实测**：

| 标记 | 含义 |
|---|---|
| ✅ **实测** | 本工程内可复核的一手证据（源码 `path:line` / 本机产物 / 真机日志） |
| 🔶 **沿用** | 沿用外部/旧壳/同型工程的一手记录（本工程**未复现**） |
| ⬜ **待验证** | 本工程必须自行实测或实测后才能定稿 |
| ⚠️ **冲突/风险** | 两份一手材料互斥，或存在已知硬阻塞 |

两条纪律（逐字继承库与旧壳）：

1. `🔶 沿用` 的结论**不得**作为对外承诺依据 —— 鸿蒙生态里「声明存在」≠「设备可用」，**必须真机调一次**；
2. **凡涉及运行时可见性的结论，观测点必须是应用域**：沙箱内的日志文件连 debug 签名也不让 `hdc` 读
   ⇒ 一律改走 HTTP 端点（`hdc fport` + `curl /facts`、`/log`）或 `hilog`。

---

## 四、合规红线（Release Gate）

| # | 红线 | 本工程的处置 | 现状 |
|---|---|---|---|
| **G1** | 渲染必须使用 **ArkWeb** | 形态正面对上：主界面由 ArkWeb 加载本机服务渲染（规划 §1.1）；审核质疑时材料口径：「主界面是应用自带的本地界面，由 ArkWeb 组件加载本机服务，非浏览器上网」 | ✅ 形态成立（渲染链已落） |
| **G2** | 不得有浏览器语义 | `EntryAbility.skills` **只**声明 `entity.system.home` + `action.system.home`，**不**声明 `entity.system.browsable` / `ohos.want.action.viewData` | ✅ `entry/src/main/module.json5:29-38` |
| **G3** | 包内**不得**含第三方浏览器内核 | 唯一原生件是 Node 运行时 + 库引导件（无 Chromium/Electron） | ✅ 形态成立（⬜ Phase 3 出产物核对证据） |
| **G4** | **第三方许可清单**必须随包 | Node.js（MIT）+ V8/OpenSSL 等 + 上游 `pi`/`pi-web`（MIT）；附 `libnode.so` 来源与 SHA-256（`runtime.lock.json`） | ⬜ Phase 3 |
| **G9** | **PoC 资产清理** | 上架前移除样例 Ability、`--inspect`、诊断开关、`selfcheck` 载荷的调试端点（`/facts`、`/log`） | ⬜ Phase 3 |
| **G11** | **不得包含绕过平台代码签名 / 可执行内存控制的组件** | 发布物**禁止**打包路线 J′ 的绕行实现（库 `R23`）；相关 PoC 与发布分支**物理隔离** | ✅ 无此类组件（⬜ Phase 3 出核对记录） |

> 其余合规项（G5 ELF 合规、G6 AI 生成内容标识、G7 图标/命名/备案三一致 + `versionCode` 递增、G8 隐私声明链接可达、G10 首启不得出现「内测/测试/预览版」字样）见规划 §13，Phase 3 逐条落实。

---

## 五、评审清单（Reviewer Checklist）

评审任何 `spec.md` / `plan.md` / PR 时逐条问：

- [ ] 是否把业务数据塞进了宿主能力桥？（A1）
- [ ] 这条逻辑属于壳还是属于 Node 侧？（A2）
- [ ] 是否在本工程里**重新论证**了运行时结论，而不是引用库文档 §号？（A3）
- [ ] 是否需要对上游打补丁？能用现成机制替代吗？补丁幂等可反向吗？（A4）
- [ ] 失败时用户能在界面上看到什么？崩溃态是否暗示了「可以自动恢复」？（A5）
- [ ] 平台缺口的降级是否**在界面上说出来**了？（A6）
- [ ] 每条验收是否写成「能观测到 X」？是否误用了禁止的判据？（A7）
- [ ] 端口是否随机/先探测空闲？是否单实例？（A8）
- [ ] 载荷是否装了异常兜底？日志是否与 `node.log` 分离？（A9）
- [ ] 是否改了权限声明面？Profile 是否需要重新生成？（A10）
- [ ] 是否触碰 G1/G2/G3/G4/G9/G11 红线？（§四）
- [ ] 每条结论是否带证据标记？未实现项是否标了 `⬜ 规划未实现（Phase N）`？（§三、T9）

---

## 六、变更流程

1. **改权限声明面 / 包名 / 签名主体** ⇒ 必须重新申请并**重新生成 Profile**，按 `docs/ACL配置.md` §2.3 复验（装机成功 + `/facts`）；
2. **改载荷形态或裁剪项** ⇒ 必须更新 `overall-data-model.md` §6 的体积表与 `overall-test-cases.md` 的对应用例，并重跑 Phase 1 出口判据；
3. **改运行时时长/端口/环境契约** ⇒ 先改 `docs/000-工程规划.md`（唯一权威）与库文档 §6.2 共享事实，再改 `specs/`；
4. **换运行时版本**（`runtime.lock.json` 变更）⇒ 重跑 `scripts/provision-runtime.sh --check` + 真机 `/facts` + 四条取证通道，把结果写进 `docs/evidence/YYYY-MM-DD-*.md`；
5. **新增模块** ⇒ 在规划 §14.2 的编号表（`101`–`107`）里取号，`specs/1NN-<name>/{spec.md,plan.md[,tasks.md,test-cases.md]}`，并回引本文件与规划 §号。
