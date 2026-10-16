# plan.md —— `106-tools-extensions-same-name-overrides` 工具扩展（实现特定）

> 本文件写「**怎么做**」：技术上下文、宪法逐条合规、决策与替代方案、扩展/模板/常量的真实字段、接口契约、实现策略、测试与文件清单、Phase 待实现项。
> 需求侧在 [`spec.md`](spec.md)（`FR-106-*` / `AC-106-*` / `NFR-106-*`）；本文件**只引用不复制**。
> 依据：规划 [`../../docs/000-工程规划.md`](../../docs/000-工程规划.md) **§5 第 5 条**、**§8.1 / §8.3 / §8.4**、**§9 补丁策略**、**§11 Phase 1**、**§7.4**；
> 旧壳资产：`pi-desktop-hos/extensions/*.js`、`pi-desktop-hos/config/*`、`pi-desktop-hos/patches/v0.12.1/*`。
> **现状口径**：⬜ 本模块**未在设备侧落地** —— 四个扩展与两份模板已由并行工作**拷贝到本工程载荷暂存目录** `payload/extensions/`（511 / 580 / 133 / 162 行）与 `payload/config/`（5 / 3 行），并加了「V2 差异」头注；但 ① 两处正文适配**仍待做**（`payload/extensions/harmony-runtime.js:79`、`harmony-workspace-roots.js:40,141`）② 物化到 `<filesDir>/pi-agent/` 的脚本 ⬜ 未落地 ③ 载荷目录 `resfile/pi-web/` 只有 `README.md`（19 行 / 944 B）。

---

## 1. 技术上下文

| 项 | 值 |
|---|---|
| 运行位置 | **Node 侧**（助手进程内）；扩展由上游扩展机制自动发现并装载（根级单文件） |
| 搬入源（逐文件） | `pi-desktop-hos/extensions/harmony-exec.js`（503 行）、`harmony-search.js`（574）、`harmony-runtime.js`（126）、`harmony-workspace-roots.js`（154） |
| 模板源 | `pi-desktop-hos/config/settings.json`（5 行）、`config/mcp.json`（3 行） |
| 目标落点 | 扩展：`<filesDir>/pi-agent/extensions/`（= `PI_CODING_AGENT_DIR/extensions`）；模板：`<filesDir>/pi-agent/{settings.json,mcp.json}` |
| 载荷侧落点 | `entry/src/main/resources/resfile/pi-web/` 内的 `resources/pi-agent/{extensions,config}`（投放时机与目录结构由 `102` 定稿） |
| 解释器 | `/system/bin/sh`（mksh R59；🔶 旧壳能力清单 §A.1）—— 必须与 `settings.json` 的 `shellPath` 一致 |
| 上游机制 | 工具注册（同名顶替 `bash`/`find`/`grep`）、命令注册（自检类）、会话钩子（启动/结束） |
| 关键未知 | ① 扩展在**本工程进程内 Node**（v24.2.0）下的装载路径是否与旧壳一致（⬜ 真机验证）② 宿主桥传输 Phase 2 ⇒ `/roots` 的授权行只能「不可判定」③ `spawn` 两份互斥证据下仍按保守设计 |

---

## 2. 宪法合规检查（逐条）

| 原则 | 判定 | 理由 |
|---|---|---|
| **A1 一切经 HTTP** | ✅ | 扩展是**助手进程内**的工具实现（Node 侧），不引入任何 IPC 载体；工作区清单走**环境变量**（与旧壳同形） |
| **A2 壳薄、契约硬** | ✅ | 工具语义全在 Node 侧；壳（ArkTS）不参与命令执行/搜索 |
| **A3 运行时结论以库文档为准** | ✅ | `spawn`/子进程结论只引用库 §D.8 与规划 §8.4；本模块不重新论证 |
| **A4 不改上游** | ✅ | 四个扩展**自包含**（只 `import node:` 内建模块，不引上游路径，✅ 四个文件头注释已声明）；补丁预计 **0–2 条**且优先不补 |
| **A5 失败可见** | ⚠️ | 工具失败以「可读文本 + 非零退出码/失败原因」回给模型与界面；但**当前无实现** |
| **A6 不隐藏平台真相** | ✅ | 差异说明（忽略规则更宽、512 KiB 上限、无 PTY、无 `git`）必须写进输出（`FR-106-011/023`） |
| **A7 判据可证伪** | ✅ | `AC-106-*` 用工具输出文本（可截图）+ 退出码 + 自检命令输出；未使用被禁判据 |
| **A8 单实例与随机端口** | ✅（不越界） | 本模块不涉及端口 |
| **A9 异常兜底** | ✅（分工） | 扩展内部不抛穿（工厂内零长驻资源、事件回调做身份判断）；进程级兜底属 `101` |
| **A10 声明面 ≠ 授权面** | ✅ | 本模块不改权限面；工作目录授权状态只**读**（`permission` 预检） |
| **T4 大载荷不入库** | ⚠️ | 扩展与模板体积小（可入库）；但**载荷**（`pi-web` 产物）不入库（`.gitignore`）—— 本模块不得把大文件塞进 git |
| **T5 路径一律绝对** | ✅ | 扩展内所有路径来自会话 `cwd` 或环境变量（绝对）；不依赖 `process.cwd()`（真机 `/`）与 `process.execPath`（`/appspawn`） |
| **T6 常量集中** | ⚠️ | 扩展内的上限常量（512 KiB/2000 文件/深度 8/120 s/256 KiB）**保持在各扩展文件顶部**（自包含优先，见 `D-106-4`），壳侧常量不得与此重复定义 |
| **T8 日志谁写谁读** | ✅ | 扩展只 `console.log/error` + 结构化输出；读回由 `101` 的日志通道负责 |
| **T9 阶段分级标注** | ✅ | 全部实现项标 `⬜ 规划未实现（Phase 1/2）` |
| **红线 G11** | ✅ | 无关（不涉及绕行组件） |

---

## 3. 研究结论（决策 / 替代方案 / 为何否掉）

| 编号 | 决策 | 替代方案 | 为何否掉 |
|---|---|---|---|
| `D-106-1` | **搬（copy + adapt）而不是重写**四个扩展 | 按本工程口径重写 | 旧壳扩展已在真机跑通（🔶 能力清单 REV-1），重写等于把踩过的坑再踩一遍；宪法 A4 精神是「用现成机制」 |
| `D-106-2` | 结束判定**只用输出哨兵行** | 等 `exit`/`close` 事件；或按退出码轮询 `/proc` | 两份一手材料互斥（本机三事件齐全 vs 旧壳事件不送达）；**保守设计**在两侧都成立（规划 §12 R10/R14） |
| `D-106-3` | 命令用**子 shell 括号组** `( … )` 执行 | 花括号组 `{ …; }` | 花括号组下命令里的顶层 `exit` 会打断**常驻** shell（同型实现的老问题）；括号组让 `exit 3` 如实返回 rc=3 且 shell 存活 |
| `D-106-4` | 上限常量**留在扩展文件内**，不进壳常量表 | 统一收进 `common/Constants.ets` | 扩展是**Node 侧自包含文件**（升级上游时零耦合）；跨侧共享常量会把 Node 侧与 ArkTS 侧绑在一起（宪法 T6 管的是**壳**的常量） |
| `D-106-5` | 工作区清单**沿用 `PI_HOS_ROOTS`**（环境变量 JSON） | 自建配置文件 / 让扩展自己扫用户目录 | 旧壳补丁链与自检命令已按该形状消费；自扫会猜（违反 A6） |
| `D-106-6` | 授权状态经**宿主能力**取（`perm.check`），取不到就「不可判定」 | 直接 `stat`/`readdir` 当授权；或写死「已授权」 | 🔶 旧壳实测 `checkPermission` 有**假阴性**；写死等于撒谎（A6/FR-106-016） |
| `D-106-7` | 扩展装载后**覆盖同名**（代码以包内为准）；模板/技能**不覆盖**用户版本 | 一律覆盖 / 一律不覆盖 | 代码漂移比覆盖更危险（旧壳已决策：`main.js:413`）；用户改写技能是有意行为 |
| `D-106-8` | 模板**只在缺失时写** | 每次启动都写 | 会吞掉用户配置（违反 `FR-ARK-024`） |
| `D-106-9` | 工作目录消费点**沿用旧壳补丁**（`patches/v0.12.1/0001-workspace-picker-roots.patch`，🔶 1294 行） | 新造一条补丁 | 旧壳该补丁已验证（幂等、可反向）；新造补丁会让补丁列表与上游漂移风险翻倍（规划 §9） |
| `D-106-10` | `session_shutdown` 钩子**必须**释放常驻 shell（幂等） | 不做释放 | 不释放会在会话切换后留下孤儿 shell 与其进程组 |

---

## 4. 数据模型（真实字段 / 常量 / 模板 / 覆盖规则）

### 4.1 扩展清单与**适配点**（copy + adapt 的逐文件差异）

| 源文件（旧壳） | 源行数 | 本工程落点（**已落地**，并行工作） | 落地行数 | **仍待做的适配点** |
|---|---|---|---|---|
| `extensions/harmony-exec.js` | 503 | `payload/extensions/harmony-exec.js` | 511 | **正文零改动**（头部加了 V2 说明 `:1-8`）；仅需校核 `SHELL_PATH='/system/bin/sh'` 与 `settings.json` 的 `shellPath` 一致 |
| `extensions/harmony-search.js` | 574 | `payload/extensions/harmony-search.js` | 580 | **正文零改动**（头部 V2 说明 `:1-8`）；差异说明文案保持（忽略规则更宽、512 KiB、深度 8） |
| `extensions/harmony-runtime.js` | 126 | `payload/extensions/harmony-runtime.js` | 133 | ⚠️ 头部已声明「本工程是库的进程内 Node」，但**正文 `:79` 仍打印「Electron 主进程内（无子进程）」**（自相矛盾）；另需把 `:100` 的文档/技能指引指向本工程（现指旧壳 `docs/工程规划.md §9.3`） |
| `extensions/harmony-workspace-roots.js` | 154 | `payload/extensions/harmony-workspace-roots.js` | 162 | ⚠️ 头部已声明「旧壳的 `__PI_HOS_PERMISSION__` 在 V2 不存在」，但**正文 `:40` 仍定义旧壳全局桥名、`:141` 仍写「沙箱根 = `<userData>/workspace`」**；授权来源改为宿主能力（`perm.check`）或如实「不可判定」（Phase 2） |
| `config/settings.json` | 5 | `payload/config/settings.json` | 5 | 内容原样（`shellPath` + `defaultTools` + `defaultProjectTrust`） |
| `config/mcp.json` | 3 | `payload/config/mcp.json` | 3 | 内容原样（`mcpServers: {}`） |

> 投放目标仍是 `<filesDir>/pi-agent/{settings.json,mcp.json,extensions/}`：`payload/README.md:21-24` 明确「`config/` 与 `extensions/` 由 `pi-web-launch.js`（或 Phase 2 的宿主桥）**copy 到** `PI_CODING_AGENT_DIR` 下才会被 pi 拾取」，且**一律 copy、绝不建软链**（设备侧 symlink = EACCES）。

### 4.2 工具契约（回给模型的形状）

| 工具 | 参数（名称 / 类型 / 默认） | 结果字段 | 失败语义 |
|---|---|---|---|
| `bash` | `command:string`（必填）、`timeout:number`（秒，默认 120） | `exitCode:number\|null`、`elapsedMs`、`truncated:boolean`、可选 `failure: 'timeout'\|'aborted'\|'shell-died'\|'unknown'` | 非零退出码 ⇒ 结果标记为错误（正文仍给全输出）；`exitCode===null` ⇒ 正文说明「退出码未知」 |
| `grep` | `pattern:string`（必填）、`path`、`glob`、`ignoreCase:boolean`、`literal:boolean`、`context:number`、`limit:number`（默认 100） | `matches:number`、`limit:number` + 正文含 `N files read` 与全部上限说明 | 非法正则/非法 glob/路径不存在 ⇒ **抛可读错误**（不得静默） |
| `find` | `pattern:string`（必填）、`path`、`limit:number`（默认 1000） | `matches:number`、`limit:number` + 正文含 `N files scanned` 与上限说明 | 非法 glob/非目录 ⇒ 可读错误 |

### 4.3 常量表（扩展文件顶部，`D-106-4`）

| 项 | 值 | 出处 |
|---|---|---|
| 开始/结束标记 | `__PI_BEGIN__` / `__PI_END__` + 每条命令**随机 token**（`randomBytes(8).toString('hex')`） | 🔶 `harmony-exec.js:68-69/268` |
| 默认超时 / 收尾窗口 / 上限 | `120_000 ms` / `2_000 ms` / `2_147_483_647 ms` | 🔶 `:72-76` |
| 输出上限 | `256 KiB` | 🔶 `:78` |
| 进度节流 | `500 ms` | 🔶 `:80` |
| 搜索上限 | 文件数 `2000`、单文件 `512 KiB`、深度 `8`、单行 `300` 字符、grep `100`/find `1000` | 🔶 `harmony-search.js:50-59` |

### 4.4 模板内容（逐字节沿用旧壳）

```json
// settings.json
{ "shellPath": "/system/bin/sh",
  "defaultTools": ["read", "write", "edit", "ls", "find", "grep", "bash"],
  "defaultProjectTrust": "ask" }

// mcp.json
{ "mcpServers": {} }
```

### 4.5 投放与覆盖规则（幂等）

| 类别 | 规则 | 依据 |
|---|---|---|
| 扩展（代码） | 包内为准：**覆盖**同名文件（幂等：按内容比对，内容相同则跳过） | 🔶 旧壳 `main.js:413` |
| 模板 / 用户可改类 | 用户为准：**目标存在即跳过**（只在缺失时写） | `FR-ARK-024`；`FR-106-018` |
| 原子性 | 写入走「临时文件 + `rename`」（🔶 沙箱 `hmfs` 支持原子写） | `overall-data-model.md` §4.4 |
| 谁写谁读 | 由 **Node 侧**启动脚本物化（不用 OHOS 侧解压器写业务文件） | 库宪法 C3 |

### 4.6 差异表（必须出现在输出/文档里，`FR-106-011/023`）

| 维度 | 内建工具 | 本模块扩展 | 必须写出来的话 |
|---|---|---|---|
| `bash` 结束判定 | 等子进程事件（本平台不可靠） | 输出哨兵行 | 「本平台以输出记号判定结束；默认超时 120 s」 |
| `bash` 的 shell 状态 | 每条命令一个子进程 | 常驻 shell + 子 shell | 「`cd`/变量**不跨调用**保留」 |
| `grep`/`find` 忽略规则 | 解析忽略文件（且默认含隐藏项） | 近似：跳点目录 + 依赖目录 + 版本控制目录 | 「**不解析**忽略文件；排除规则**更宽**」 |
| 单文件读取 | 由外部二进制处理二进制/超大文件 | 512 KiB 上限，超限跳过并计数 | 「超过 512 KiB 的文件被跳过」 |
| 结果完备性 | 由外部二进制决定 | 结果数/文件数/深度/单行四级上限 | 「已达上限，可能还有更多结果」 |
| 文件围栏 | 无（子进程以应用身份运行） | 无 | 「命令不受文件审批流保护」 |

---

## 5. 接口契约

### 5.1 提供（本模块对外）

| 符号 | 落点 | 说明 |
|---|---|---|
| 工具 `bash` / `find` / `grep`（同名） | `<filesDir>/pi-agent/extensions/*.js` | 对模型透明；参数与内建兼容 |
| 命令（运行时事实 / 工作区主目录自检） | 同上 | 输出为纯文本；自检命令按 §4.1 的适配点取授权状态 |
| `PI_OFFLINE=1`（离线旗标） | Node 侧启动脚本的环境装配（唯一落点） | 与 `101`/`102` 的装配函数同处；幂等（仅在未设置时设，🔶 旧壳 `main.js:263`） |
| `PI_CODING_AGENT_DIR`（agent 数据根） | 同上 | 唯一落点；扩展与模板的落点都相对它 |
| 工作区清单的**消费方** | 自检命令 | 只读 `PI_HOS_ROOTS`（由 `104` 供给），未设置/非法 ⇒ 报错并列出期望项 |

### 5.2 消费（依赖面）

| 依赖 | 用途 | 现状 |
|---|---|---|
| `104` 的 `PI_HOS_ROOTS` 供数 | 自检命令的四项主目录 | ⬜ 未实现（清单供数在 Phase 2） |
| `104` 的 `perm.check` 能力 | 授权状态（假阴性口径） | ⬜ 未实现；通道不可用时如实「不可判定」 |
| 上游扩展机制 | 工具/命令注册、会话钩子 | ✅ 上游存在（旧壳已用） |
| 进程内 Node 的 `child_process` | 常驻 shell | ✅（`spawn` 可用性见假设 1） |
| `settings.json` 的 `shellPath` | 与扩展内的 `SHELL_PATH` 一致 | ⬜ 模板待投放 |
| 旧壳补丁（工作目录消费点） | 让对话框消费 `PI_HOS_ROOTS` | 🔶 可用（`patches/v0.12.1/0001`，1294 行） |

### 5.3 事件协议（帧与钩子）

```
[帧协议] 每条命令下发（token 不写进命令体）：
  printf '\n__PI_BEGIN__ <tok>\n'
  ( cd '<cwd>' || { printf 'cd failed: %s\n' '<cwd>' >&2; exit 1; }
  <command>
  ) </dev/null 2>&1
  __pi_rc=$?
  printf '\n__PI_END__ <tok> %s\n' "$__pi_rc"
[结算] 只在缓冲里找到「行首的 __PI_END__ <tok> <十进制 rc>」且该行**完整**时结算；否则等超时。
[串行] 全局串行链：同一时刻只有一条命令在常驻 shell 上执行。
[钩子] 会话结束 ⇒ 幂等杀常驻 shell（含**进程组**）并摘掉监听器。
[事件] 旧 shell 的迟到输出**必须**按「每条命令一个状态对象 + 身份判断」丢弃。
```

---

## 6. 实现策略

### 6.1 架构模式

- 四个扩展是**根级单文件**扩展（无依赖、无构建），逐个 copy 后按 §4.1 的适配点小改；
- 扩展与模板的**投放**由 Node 侧启动脚本在起服务前完成（幂等 + 覆盖规则见 §4.5）；
- 工作区清单**单源**（环境变量），本模块不产出第二份。

### 6.2 关键算法

1. **常驻 shell 生命周期**：首次调用惰性 `spawn('/system/bin/sh', [], {stdio:['pipe','pipe','pipe'], detached:true})`；`stdout.end` / `stdin.error` / `proc.error` 任一 ⇒ 标记该 shell 死亡（**不信** `exit`/`close`）；重置 = 摘监听器 → 杀进程组（`process.kill(-pid)`，失败退化为单进程 kill）。
2. **帧构造与结算**：§5.3；token 每条命令新生成（`randomBytes(8)`）；`</dev/null` 防止读 stdin 的命令吃掉哨兵。
3. **输出整形**：合并 stderr；UTF-8 字节上限截断（切点落在字符中间时**回退**，最多回退 3 字节）；截断时追加显式标注。
4. **搜索遍历**：迭代式 BFS（非递归，避免深目录爆栈）；跳过点开头目录 + 依赖目录 + 版本控制目录（**根目录永远遍历**）；不跟随符号链接目录；`stat`/`readdir` 抛错 ⇒ 跳过并计数。
5. **glob → 正则**：`*`/`?` 单段、`**` 跨段、`{a,b}` 枚举、`[0-9]`/`[!a-z]` 字符类；`find` 智能大小写；非法模式 ⇒ 抛错（不静默）。

### 6.3 错误处理

| 面 | 处理 |
|---|---|
| shell 写失败（管道已坏） | 标记死亡 → 返回 `died` 失败 → 下次调用自动重启 |
| 超时 | 进入收尾窗口（2 s）→ 仍无哨兵 ⇒ **先取正文**再重置 shell ⇒ 返回 `timedOut` + 已产出输出 |
| 中止（用户取消） | 无法只中断一条命令 ⇒ 重置整个常驻 shell（含进程组），返回 `aborted` + 已产出文本 |
| 搜索不可读条目 | 跳过 + 计数，**不**让整次失败 |
| 清单缺失/非法 | 报错并列出期望项；**不**回退到别的根 |

### 6.4 性能

| 面 | 纪律 |
|---|---|
| 命令 | 常驻复用（9 条命令 1 次 spawn）；轮询间隔 20 ms；进度回报 500 ms 节流 |
| 搜索 | 纯同步 IO，但有界（§4.3）；不使用 `async` 递归（避免深目录 + 事件循环抖动） |
| 内存 | 单文件 ≤ 512 KiB 读入；输出 ≤ 256 KiB 交给模型 |

---

## 7. 测试考虑

| 用例族（`overall-test-cases.md` §2.7） | 覆盖的 FR | 本模块补充 |
|---|---|---|
| `TC-106-001` `bash` 同名扩展可用 | `FR-106-002..009` | 追加 `exit 3` 后**再执行一条命令**（证明 shell 存活，`AC-106-02`） |
| `TC-106-002` `find`/`grep` 同名扩展 | `FR-106-010..013` | 断言输出**含**「跳过规则」与「512 KiB」（文本可截图） |
| `TC-106-003` 工作区主目录清单 | `FR-106-014..017` | 断言四项齐全；桥不可用时显示「不可判定」而不是猜 |
| `TC-106-004` 预置模板不覆盖 | `FR-106-018` | 篡改模板 → 重启 → 内容保持（读回比对） |
| `TC-106-005` 平台缺口如实提示 | `FR-106-023` | 断言无「假终端/假 git」入口 |

**新增候选用例（Phase 1 补进索引）**：`TC-106-006` 超时命令保留已产出输出且会话未卡死；`TC-106-007` 输出截断按 UTF-8 边界（中文不被切碎）且标注含字节数；`TC-106-008` 两条命令并发发起 ⇒ 串行执行（输出不串流）；`TC-106-009` 非法 glob/正则 ⇒ 可读错误（不静默退化为不过滤）；`TC-106-010` 命令数 > 3 时 shell 只 spawn 一次（常驻复用，可用日志/计数观察）。

---

## 8. 文件清单

| 文件 | 作用 | 行数 |
|---|---|---|
| `payload/extensions/harmony-exec.js`（已落地） | `bash` 同名顶替（常驻 shell + 哨兵行） | 511（现状 ✅）；投放目标 `<filesDir>/pi-agent/extensions/` ⬜ 待物化 |
| `payload/extensions/harmony-search.js`（已落地） | `find`/`grep` 同名顶替（纯 JS） | 580（现状 ✅）；⬜ 待物化 |
| `payload/extensions/harmony-runtime.js`（已落地） | 运行时事实命令（**正文 `:79` 待改**） | 133（现状 ✅）；⬜ 待适配 |
| `payload/extensions/harmony-workspace-roots.js`（已落地） | 工作区主目录自检（**`:40/:141` 待改**） | 162（现状 ✅）；⬜ 待适配 |
| `payload/config/settings.json`（已落地） | shell 路径 + 默认工具集模板 | 5（现状 ✅） |
| `payload/config/mcp.json`（已落地） | MCP 空表模板 | 3（现状 ✅） |
| `payload/README.md`（已落地） | 载荷布局与「copy 到 `PI_CODING_AGENT_DIR` 才生效」规则 | 69（现状 ✅） |
| `payload/pi-web-launch.js`（已落地，属 `101`/`102`） | Node 侧入口：物化扩展/模板 + 环境装配 + 起服务 | 536（现状 ✅） |
| 物化脚本（物化扩展/模板到 `pi-agent/`；由 `101`/`102` 承载） | 覆盖规则 + 原子写 + 幂等 | ⬜ 待创建（`payload/README.md:21-24` 已定规则） |
| `entry/src/main/resources/resfile/pi-web/README.md` | 载荷落点说明（现有） | 19（现状 ✅） |
| `../../pi-desktop-hos/src-main/main.js` | 投放与覆盖规则参考：`:410-450`（extensions 覆盖 / skills 保留）、`:263`（`PI_OFFLINE`） | 1314（外部工程） |
| `../../pi-desktop-hos/patches/v0.12.1/0001-workspace-picker-roots.patch` | 工作目录消费点（沿用，不新造） | 1294（外部工程） |
| `../../pi-desktop-hos/patches/v0.12.1/0002-session-export-in-process-fallback.patch` | 会话导出回退（**本工程需重评**：`process.execPath` 在真机 = `/system/bin/appspawn`） | 28（外部工程） |
| `../../pi-desktop-hos/docs/鸿蒙环境能力清单-v0.11.1.md` | 真机基线（#15/#18/#19、REV-1） | 523（外部工程） |

---

## 9. Phase 待实现清单（逐条 + 验收判据 + 依据）

| # | Phase | 工作项 | 验收判据 | 依据 |
|---|---|---|---|---|
| 1 | 1 | 四个扩展 copy 入载荷并完成 §4.1 的适配 | 扩展被装载；`bash` 返回退出码；`exit 3` 后 shell 仍可用 | `FR-106-001..004`；`AC-106-01/02`；规划 §8.3 —— ⚠️ **拷贝已存在**（`payload/extensions/`），本项收窄为「两处正文适配 + 物化 + 真机装载」 |
| 2 | 1 | 模板投放（仅缺失时写） | `TC-106-004`：篡改后重启内容保持 | `FR-106-018`；宪法 A5/`FR-ARK-024` |
| 3 | 1 | 离线旗标与 agent 数据目录的唯一落点 | `/facts` 类端点回显 `PI_OFFLINE=1`；无联网补下载 | `FR-106-019`；规划 §8.4 |
| 4 | 1 | 搜索/查找真机验证 | `AC-106-05/06/11`：结果可用 + 输出含跳过规则与 512 KiB + 截断标注 | `FR-106-010..013`；`TC-106-002` |
| 5 | 1–2 | 工作区主目录供数联调（依赖 `104`） | `AC-106-07/08`：四项齐全；桥不可用 ⇒ 「不可判定」 | `FR-106-014..017`；`TC-106-003` |
| 6 | 2 | 平台缺口文案落地（终端/`git`/围栏） | `TC-106-005`：无「看起来能用」的入口 | `FR-106-023`；宪法 A6 |
| 7 | 2 | `spawn` 语义在**本工程载荷内**重测（P0-4/O5） | 三事件是否齐全的结论写回文档；扩展设计**不变** | 规划 §12 P0-4/O5；库 §D.8 |
| 8 | 2 | 超时/中止路径与 UTF-8 截断专项 | `TC-106-006/007` | `FR-106-003/007/009` |
| 9 | 3 | 补丁清单登记（`P-ark-2` 沿用 / `P-ark-1` 不补）与本模块无关的兜底 | 补丁列表与规划 §9 一致；无新补丁 | `FR-106-021/022`；宪法 A4 |
