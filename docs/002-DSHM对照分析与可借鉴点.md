# 002 — DSHM 对照分析与可借鉴点（只读分析）

> **对象**：`D:\GitHub\ohos\dshm`（DeepSeek Harness 的 HarmonyOS 移植），工作树 HEAD `1cb0db6`（2026-10-08）。
> **规模**：ArkTS 172 个文件 / 57,743 行；`tools/` 脚本 71 个（其中 `check*`/`assert*` 门禁 51 个）；`docs/` 44 篇。
> **本文件的性质**：**只读分析**。未修改 dshm 任何文件、未在其上构建或装机。
> **写作日期**：2026-10-17。
> **目的**：回答两个问题 —— ① 它在 **libnode 的使用**上有什么我们没做对的；② **整体实现思路**上有哪些可搬到 `pi-desktop-ark` 的做法。

---

## 0. 结论摘要（先看这十条）

| # | 结论 | 证据 |
|---|---|---|
| 1 | **我们 E18「方案 A 失败」的归因是错的。** `libnode.so` **导出 145 个 `napi_*`**（含 `napi_create_function`）。我们的 addon 解不出符号，是因为它的 `DT_NEEDED` **只有 `libc.so`**、6 个 `napi_*` 全为未定义 —— 这正是 DSHM 记录的 **E43/E41 号坑**，修法是**把 libnode 写进 addon 的链接行** | ✅实测（`llvm-nm`/`llvm-readelf`，见 §4.1） |
| 2 | **DSHM 有同一形态的活样本**：`libpython_runner.so` = `NAPI_MODULE(...)` + 只链 `libnode.so.137` + 运行期 `dlopen(libpython)`，由 Node 侧 `process.dlopen` 加载，真机跑通（内嵌 CPython 3.12.14） | 🔶沿用（源码 + 文档） |
| 3 | **原生库文件名必须等于它的 SONAME**。我们的 `libnode.so` 的 SONAME 是 **`libnode.so.137`** ⇒ 一旦写进 `DT_NEEDED`，加载器会按 `libnode.so.137` 找。DSHM 的文件名就叫 `libnode.so.137`，并有 `patch-native-needed.mjs` + `check-native-closure.mjs` 把这条钉住 | ✅实测（SONAME 读数）+ 🔶沿用（工具） |
| 4 | **DSHM 根本不做 Node→ArkTS 的 RPC。** 它连「停核心」都不做进程内停止，而是让 Node 写一个文件、自己收工 | 🔶沿用（`RuntimePort.ets` 注释 + `stopHost` 实现） |
| 5 | **但它有一个「只有 ArkTS 能做」的能力桥，用的正是文件信箱**（HMS 语音识别）：Node 写 `<id>.req`、ArkTS 每 500 ms 轮询并写 `<id>.done`/`.fail`。这就是我先前提出的 E18 传输方案，**已在真机上线**，还带 5 个硬获细节 | 🔶沿用（`HmsSpeechBridge.ets` 771 行） |
| 6 | ⇒ **E18 应改抄这条路，而不是继续修原生桥**：零 C++、有先例、100 ms 轮询延迟不可感知 | 建议（§4.3） |
| 7 | **`UV_USE_IO_URING=0`** 是它治 `io_uring_setup` SIGSYS 的方法（一行环境变量），比我们手写 SIGSYS shim 的仿真相简单得多 | 🔶沿用（`buildHostEnv`）；⬜待验证（我们的 libuv 版本是否认这个变量） |
| 8 | **就绪判据用 TCP connect，不用 HTTP 栈** —— 因为它实测 `@ohos.net.http` 打 `127.0.0.1` 15 s 全超时（系统代理），而 TCP connect 是"在不在监听"的原始事实 | 🔶沿用（`NodeRuntime.portAnswers`） |
| 9 | **契约纯函数化 + 门禁必须做注入式负测试**：`buildHostArgv`/`buildHostEnv` 是可单测纯函数；51 个门禁脚本里 8 个带 `--self-test` 变异体 | 🔶沿用（`RuntimePort.ets` / `AGENTS.md`） |
| 10 | **不要照抄**：自建 Node 交叉编译链（四份上游源码补丁 + 30~90 分钟构建）、~300 MiB 单包、固定端口 3120、WebView 内注入 `client.js` 覆盖官方前端 | §7 |

---

## 1. 证据口径（先声明我凭什么下判断）

| 标记 | 含义 | 本文用法 |
|---|---|---|
| ✅实测 | 我在**本机**跑命令读出来的字节/符号表读数 | `llvm-nm`、`llvm-readelf`、`ls` |
| 🔶沿用 | 我读了 DSHM 的源码/文档并采信其结论，**未在设备上复验** | 大多数架构判断 |
| ⬜待验证 | 我提出的做法，尚未在本仓跑过 | E18 修法、`UV_USE_IO_URING` |
| ⚠️受限 | 想验但验不了 | dshm 的 `libnode.so.137` 不在库里（`.gitignore`），无法与我们的逐字节比对 |

> **纪律**：本文不出现"已验证"字样，除非它出现在 ✅ 行里。

---

## 2. 两个工程的形状对照

| 维度 | `pi-desktop-ark` | DSHM |
|---|---|---|
| 被搬的东西 | `pi-web`（Next.js agent 前端 + 服务端） | dsh core（DeepSeek Harness 核心树） |
| 运行时 | `libnode.so`（同进程）+ 自建引导 `libnode_bridge.so` | `libnode.so.137`（**自建**，OpenHarmony 交叉编译）+ 自建引导 `libdshhost.so` |
| 谁加载引导层 | ArkTS `import ... from 'libnode_bridge.so'`（NAPI 模块） | ArkTS `import dshhost from 'libdshhost.so'`（NAPI 模块） |
| 谁加载运行时 | 引导层构造函数 `dlopen(libnode, RTLD_GLOBAL)` + `dlsym(node::Start)` | **同一手法**（`dshhost.cc:487-527`） |
| 上层怎么说话 | HTTP（随包 `pi-web.ready.json` 给端口） | HTTP/WS 回环 + `host-ready.json`（带 token + **pid 校验**） |
| 代码/资源分发 | `resfile` + 单 `tar.gz` + `.version` sha 锚 | `resfile` + 单 **zip** + `.dshm-bundled-stamp`（字节数指纹） |
| 前端渲染 | WebView 打开本地 `pi-web` | WebView 打开本地 dsh web，**ArkTS 壳另做原生顶栏/设置/托盘** |
| 能力回传（ArkTS→Node 侧） | **设计中有 RPC**（E18，未通） | **不做 RPC**；单向文件信号 + 一个文件信箱桥 |

**一句话**：两者在「libnode 怎么进进程」上**撞到了同一套结论**（连注释里的理由都几乎一样），差别在**上层通信**：我们想做 RPC，它选择不做。

---

## 3. libnode：完整链条与九个可借鉴点

### 3.1 加载链（三条命令就能复述）

```
ArkTS  import dshhost from 'libdshhost.so'
  └─ 构造器（__attribute__((constructor))）：
       dladdr(自己) → 取本 .so 所在目录 → dlopen("<dir>/libnode.so.137", RTLD_NOW|RTLD_GLOBAL)
       dlsym(handle, "_ZN4node5StartEiPPc")            // node::Start(int, char**)
       napi_module_register(&g_dshHostModule) ×4        // 四种名字口径
  └─ ArkTS 调 startHost(argv, envPairs)
       → setenv(每条 KEY=VALUE)                        // ArkTS 无法设原生环境变量
       → std::thread{ node::Start(argc, argv) }        // 阻塞，detach
```

### 3.2 为什么 `libnode` **不能**进 `DT_NEEDED`（`dshhost.cc:82-86` 原文要点）

> 一旦带了，动态加载器会以**局部作用域**先载入 libnode；之后再 `dlopen(RTLD_GLOBAL)` 提升在 musl 上**无效**（实测：返回 ok 但符号依然解析不到）。

代价写得很清楚：**链接期不再校验 libnode**（有意的取舍）。CMake 里那段注释也是同一句话（`CMakeLists.txt` 的 `libnode.so.127` 段）。

**与我们对照**：我们的 `node_bridge.c:1011` 已经是 `RTLD_NOW|RTLD_GLOBAL`，且**没有**把 libnode 写进 `node_bridge` 的 `DT_NEEDED`（`target_link_libraries(node_bridge PUBLIC libace_napi.z.so libhilog_ndk.z.so)`）—— **这一段我们是对的**。

### 3.3 头文件最小化：只 `#include <node_version.h>`

`dshhost.cc:26-32` 记了一条实测：

> `node.h` 会拉进 v8 全套头文件；Node 26.x 的 `v8.h` 依赖 C++20 的 `<source_location>`，而 OHOS SDK 的 libc++ 不提供它 ⇒ `fatal error: 'source_location' file not found`。

所以它**只**用 dlsym 取 mangled 名，不引用任何 `node::`/`v8::` 类型。

**可借鉴**：我们若只需要 `node::Start` 一个入口，**不需要拉全套 Node 头文件**，也就不会被 SDK 的 libc++ 版本卡住。

### 3.4 编译口径必须与 libnode 一致

`-fno-emulated-tls -D__MUSL__`（`CMakeLists.txt`）。原文：「TLS 模型不一致时，与 libnode 的交互会出现**难以定位**的问题」。

**我们要照抄的**：addon 的编译选项要与 libnode 同口径（我们目前没有显式设置）。

### 3.5 NAPI 注册要"四种名字全注册"

`dshhost.cc:386-448`：`dshhost` / `libdshhost.so` / `libdshhost` / `dshhost.so` 各注册一次。理由是真机症状 —— **`.so` 加载成功、`import` 不报错、导出全是 `undefined`**，而"查错名字不会报错，只会返回一个别的模块"（实测拿到的是 ArkUI 的节点模块）。

配套两条：
- `nm_filename` **必须非空**（传 `__FILE__`；传 `nullptr` 时构造器跑了、`napi_module_register` 返回了，但 `Init` 从未被调用）；
- 构造器里打 hiLog —— 用一个二分把"没加载"和"没映射"分开。

**可借鉴**：这是**成本几十字节、省掉一轮 3 分钟装机**的防御。我们的 `node_bridge.c` 是否四种名字都注册，值得核一遍。

### 3.6 ⭐ addon 的符号闭包：必须 `DT_NEEDED libnode`（E43）

`CMakeLists.txt` 原文：

> `koffi` 的 `napi_*`/`uv_*` 必须靠 `DT_NEEDED` 放进它自己的依赖闭包（**E43：libnode 即便 RTLD_GLOBAL 首载也不进它的可见集**）。

而 `libkoffi.so` 的现象是：

```
Error relocating …/libs/arm64/libkoffi.so: napi_fatal_error: symbol not found
```

> `libkoffi.so` 需要 84 个 `napi_*`，**只有这一个**解析不到 ⇒ 加载器只报**序号最小**的那个失败者。

⇒ **这一条就是我们的 E18 真因**，详见 §4。

### 3.7 ⭐ SONAME == 文件名（`check-native-closure.mjs` 的两条不变式）

> 1. **SONAME 必须等于文件名。** 加载器用 `DT_NEEDED` 条目去匹配候选的 SONAME，不是文件名。改名而不改 SONAME ⇒ 设备上 `cannot open shared object`。
> 2. **每个 `DT_NEEDED` 都必须解析**到「同目录我们发的」或「系统提供」的库；漏一个，表现是一条无信息的 dlopen 失败。

两条都不能被"构建成功"发现 ⇒ 做成**构建期静态门禁**（`node tools/check-native-closure.mjs`，带显式 `SYSTEM_LIBS` 白名单；"unknown ⇒ ok" 会让检查失去意义）。

⚠️ 它另外提到 hvigor **只打 `libs/<abi>/*.so` 扁平目录**，所以版本化文件名（`libglib-2.0.so.0.8800.2`）必须改名 + 配套 SONAME 修补（`tools/patch-native-needed.mjs` 就是做这个的）。

**可借鉴**：我们没有这条门禁 ⇒ **应当补**。它能一次性防住 E18 这类"只在设备上炸"的错。

### 3.8 手工拷预编译 `.so` 进 `libs/` **不会**建立 ArkTS↔原生绑定

`CMakeLists.txt` 头部的并列对照（E30）：

```
DSHM-PROBE  cmake 构建的原生模块可绑定，返回值=dshm-probe-ok   ← 走 hvigor CMake
DSHM-RUNTIME runtimeVersion is undefined                       ← 手工拷进 entry/libs/
```

> 运行时会 dlopen 它、构造器会执行，但 `napi_module_register` 注册的模块**永远不会被实例化**（`Init` 不被调用）。

⇒ `libdshhost.so` **必须由 hvigor 自己编译链接**。我们已经是 CMake 路径（`library/src/main/cpp/CMakeLists.txt`），符合。

### 3.9 诊断三件套（都很便宜，都该抄）

1. **`napi_fatal_error` 自备定义 + `dladdr` 探针**（`dshhost.cc:44-68, 540-579`）：自己提供一个 `napi_fatal_error` 的实现，并打三条读数 —— `dlsym(RTLD_DEFAULT,"napi_fatal_error")` 的提供者 / `napi_get_undefined` 的提供者 / 自己 `dlopen(libkoffi.so)` 的结果。**一条日志把"符号从哪来"钉死**。
2. **stdout 抓文件 + tail 线程转 hiLog**（`TailNodeOutput`，300 ms 轮询，逐行打）：应用进程 stdout 在设备上**看不见**，而 `node::Start` 返回时的失败原因全在 stdout/stderr 上。它把 `freopen(logPath,"w",stdout)` + `dup2` 到 2，再开一个 tail 线程把增量转 hiLog。
3. **`g_started` 必须在 Node 线程退出时复位**（E119）：否则"核心版本切换/重启"全部被"运行时已经启动过"永久拒掉 —— 因为守卫置真后从未复位。

### 3.10 停止：如实返回"做不到"，然后走协作式停止

`stopHost()` 恒返回 `ok:false` + 一句人话（"需在 Node 线程内用 uv_async + node::Stop"）。**不假装成功**（"那比报错更糟"）。

真正的停止路径（`NodeRuntime.stop()`，E90）：
```
ArkTS 写 $DSH_HOME/host-stop-request
  → Node 入口脚本每 1.5 s 巡检，看到就 shutdown → 事件循环排空 → 自己退出
  → node::Start 返回 → g_running=false
  → ArkTS 轮询 isHostRunning() 变假 ⇒ 停止完成
本机实测：请求后 +1536 ms 端口静默、退出码 0
```

**可借鉴**：我们的 C5 决策「没有进程内重启」与此同源；但**它多给了一条"怎么真的停下来"的路径**，只用一个文件。

---

## 4. ⚠️ 对我们 E18 的决定性结论

这一节是本文最重要的部分：**E18 原生路线不是"两条都不通"，而是"第二条从未被真正测过"。**

### 4.1 实测读数（✅本次在本机跑出来的）

```
# 1) libnode 到底导不导出 napi_*
$ llvm-nm -D --defined-only entry/libs/arm64-v8a/libnode.so | grep -c " napi_"
145
$ llvm-nm -D --defined-only … | grep -E " napi_(create_function|get_undefined|fatal_error|set_named_property)$"
000000000487d1dc T napi_create_function
000000000489f20c T napi_fatal_error
000000000488222c T napi_get_undefined
000000000487ee7c T napi_set_named_property

# 2) 我们的 addon 的依赖闭包与未定义符号
$ llvm-readelf -d …/libnode_host_client.so | grep -E "SONAME|NEEDED"
  (NEEDED)  Shared library: [libc.so]          ← 只有 libc，没有 libnode
  (SONAME)  Library soname: [libnode_host_client.so]
$ llvm-nm -D --undefined-only …/libnode_host_client.so | grep -c " napi_"
6                                              ← 6 个 napi_* 全靠运行期解析

# 3) libnode 的 SONAME 与文件名不一致
$ llvm-readelf -d entry/libs/arm64-v8a/libnode.so | grep SONAME
  (SONAME) Library soname: [libnode.so.137]    ← 文件名是 libnode.so
$ ls -l entry/libs/arm64-v8a/libnode.so
126809264
```

### 4.2 归因更正（把之前的两条结论改掉）

| 之前的结论 | 更正后 | 依据 |
|---|---|---|
| 「解包 HAP 的 `libnode.so` 核对：`napi_*` 字符串在文件里但**不在动态符号表**」 | **错**。它在动态符号表里，共 145 个（`T`，全局已定义） | ✅`-D --defined-only` 计数 145 |
| 「方案 A 失败：`napi_create_function: symbol not found`」 | 现象成立，但**归因是闭包缺失**，不是库缺符号：addon 的 `DT_NEEDED` 只有 `libc.so`，而 `-Wl,-z,undefs` 让 6 个 `napi_*` 留在未定义态 ⇒ 加载时无人可解 | ✅NEEDED/undefined 读数；🔶同 DSHM E43（koffi 84 个 `napi_*` / 只报第一个） |
| 「路线① 进程静默消失 ⇒ 两套 NAPI 实现 ABI 不兼容」 | **这条仍然成立**，但只对**路线①**：主桥 `libnode_bridge.so` 的 `DT_NEEDED` 含 `libace_napi.z.so`，Node 调进来时 `napi_create_function` 绑定到 **libace_napi 的实现**，而收到的是 **Node 的 env** ⇒ 崩。**注意这正是"不能混链"的独立证据**，与 §3.6 不矛盾 | ✅链接行读数 + 推理 |

> 换句话说：**路线①该失败（混链），路线②不该失败（纯链 libnode，只是我们没链）。**

### 4.3 修法清单（⬜待验证，成本≈一次构建 + 一次装机）

1. **addon 只链 libnode，不链 `libace_napi`**（`libnode_host_client` 已满足）。
2. **把 libnode 写进链接行**，去掉 `-Wl,-z,undefs`：
   ```cmake
   target_link_libraries(node_host_client PRIVATE ${LIBNODE})   # 文件：entry/libs/arm64-v8a/libnode.so(.137)
   target_compile_options(node_host_client PRIVATE -fno-emulated-tls -D__MUSL__)
   ```
   链接后 `readelf -d` 必须出现 `NEEDED [libnode.so.137]`，`nm -D --undefined-only` 的 `napi_*` 计数必须变成 **0**。
3. **处理 SONAME 与文件名的错位**（二选一，都要在设备上确认 HAP 里那份叫什么）：
   - **A**：把随包文件命名为 **`libnode.so.137`**（= SONAME）。DSHM 就是这么做的；但 hvigor 是否打非 `*.so` 结尾的文件**必须实测**（它的门禁注释说只会打 `*.so`，两者有张力）。
   - **B**：把 addon 的 `DT_NEEDED` 字符串改成 `libnode.so`（DSHM 有现成工具 `tools/patch-native-needed.mjs` 干这类改写）。次选：`patchelf --set-soname libnode.so` 改 libnode 副本（⚠️ 会动到那份被 Node 自身加载的二进制，风险高于 B）。
4. **加载方式**：Node 侧 `process.dlopen(module, path)`（与 `libpython_runner.so` 完全一致），**不要**指望 `require('libnode_bridge.so')`。
5. **桥接**：addon 内的 `callHost()` 用 `dlopen("libnode_bridge.so")`（该 .so 已被 ArkTS 加载，返回既有句柄）+ `dlsym("pi_host_call")` 取到我们**已经加了 `visibility("default")`** 的那个 C 函数 —— DSHM 的 `python_runner` 就是「NAPI addon + `dlopen` 第三方 .so + `dlsym` 它的 API」这个形态。
6. **补一条门禁**：照抄 `check-native-closure.mjs` 的两条不变式（SONAME==文件名、`DT_NEEDED` 全部可解析），再加一条我们特有的断言：**`libnode_host_client.so` 的 `DT_NEEDED` 必须含 `libnode`，且不得含 `libace_napi`**。

### 4.4 但是——更该抄的是"不做 RPC"

即使上面全部修好，我们仍然要维护：一个 addon、一个 slot 表、一组条件变量、15 s 超时、64 KB 结果上限、一套"Node 线程崩了怎么办"。

DSHM 在同一个问题上选了另一条路，并且**它有一个"只有 ArkTS 能做"的能力桥作为先例**（§5）。两者对比：

| | 原生 RPC（§4.3） | 文件信箱（§5） |
|---|---|---|
| 新增 C/C++ | ~200 行 + 链接/闭包/SONAME 三处坑 | **0 行** |
| 延迟 | µs 级 | 轮询间隔（Node 100 ms / ArkTS 500 ms） |
| 失败可见性 | 崩了就什么都没了 | 每个中间态都是**文件**，`hdc` 可 cat |
| 先例 | 我们没跑通过 | 真机上线（停核心 / 冷启动 / 语音 / 装插件队列） |
| 我们的场景 | `notify.show` / `fs.pickFolder` 都是**用户显式动作** | 延迟不可感知 |

⇒ **建议 E18 主路走文件信箱，原生 RPC 降级为"如果将来出现高频调用再做"的优化项。** 这与我们已有的 ArkTS 侧泵（`HostBridge.startTransport(100)` + 槽位表）不冲突：**槽位表可以原样保留给 ArkTS 内部用，文件夹替的只是"Node 那一端"**。

---

## 5. Node ↔ ArkTS：文件信箱（参考实现逐条拆）

### 5.1 三处先例（都在跑）

| 用途 | 方向 | 文件 | 轮询方 |
|---|---|---|---|
| 停核心 | ArkTS → Node | `$DSH_HOME/host-stop-request` | Node，1.5 s |
| 整机冷启动 | Node → ArkTS | `$DSH_HOME/host-exit-mode = app-restart` | ArkTS `EntryAbility`，`setInterval` |
| 插件安装/卸载 | 双向 | `$DSH_HOME/install-queue/*.{req,rem}` → `*.{done,fail}` | 双方 |
| **能力桥（关键）** | **双向** | `$DSH_HOME/speech-to-text/hms-bridge/<id>.{req,wip,done,fail}` | ArkTS，**500 ms** |

后者的存在理由（`HmsSpeechBridge.ets:4-9` 原文）：

> 原生层（`dshhost.cc`）只暴露 `startHost/isHostRunning/stopHost`，**没有消息通道**。所以用**文件队列**当桥 —— 与项目既成的 `host-stop-request`、`host-exit-mode` 同一手法：**可观察、失败留痕、无需改原生层**。

> 两侧同 UID、同文件系统视图，所以文件队列是可靠且可诊断的。

### 5.2 协议（可直接照搬）

```
Host(Node) 写 <id>.tmp → renameSync → <id>.req      // 先写临时名再改名，读方要么看不到、要么看到完整的
ArkTS 每 500 ms：listFileSync
  ├─ 挑 .req 里字典序最小者
  ├─ 内容判完整：length===0 或 !endsWith('}') ⇒ 等下一轮（防读到半截 JSON）
  ├─ renameSync(.req → .wip)                        // 「取走即改名」：防重复处理 + 处理中可观察
  ├─ 串行处理（busy 标志，一次一单）
  └─ 写 <id>.tmp → renameSync → <id>.done | <id>.fail
Host 每 100 ms 轮询 done/fail → 读字段 → cleanup 五件套(.req/.tmp/.wip/.done/.fail)
```

### 5.3 五个"已经付过学费"的细节（这是我们自己想不到的）

1. **`.req` 也必须进陈旧回收**（原作者标为"审核时发现的一个真缺陷"）。只清 `.wip/.done/.fail` 时，一个半截 `.req` 会让 `sort()[0]` 永远返回它 ⇒ **整条队列永久堵死**，直到应用重启，用户表现是"按钮再也不动"。阈值 10 分钟（必须 > 一次合法操作的最长耗时）。
2. **心跳文件要与"有没有请求"分开**。心跳回答的是"桥是否真的在轮询"；而且**成功也要写一行**（最初成功不写 ⇒ 事后无法区分"成功"与"没被处理"，只能靠恰好抓到 `.wip`——"那是运气，不是可复现的观测"）。
3. **超时必须随业务时长伸缩**。原实现固定 25 s，而 ArkTS 侧按实时节奏送音频（`≈ 音频时长`）⇒ 录 25 s 以上**必然**先超时。改成 `max(基础值, 业务时长 + 余量)`。**"这是必然发生的，不是概率问题"** —— 这句话可以作为我们审 E18 超时设置的模板。
4. **结果文件的原子写**（`.tmp` + rename），理由同上。
5. **失败要如实回 `.fail` 并让调用方抛**，不能回空结果（"后者会让人以为识别真的返回了空结果"）。

### 5.4 映射到我们的 E 编号

| 我们的项 | 原方案 | 改为 |
|---|---|---|
| **E18** 宿主能力回传 | 原生 slot 表 + 条件变量 + Node 侧 addon | Node 写 `<id>.req` / ArkTS 泵读目录 → 写 `<id>.done|.fail`；**原生槽位表保留给 ArkTS 内部** |
| **E20** `notify.show` | 同 E18 | 同上，一个 `<id>.req` 的 `name:"notify.show"` |
| **E21** `fs.pickFolder` | 同 E18 | 同上；**注意**：DSHM 的做法更进一步 —— picker **在 ArkTS 侧、在启动前**做，结果经**环境变量**交给 Node（`DSHM_PUBLIC_DOWNLOAD`）。若 picker 是"用户随时可能点"的动作，才需要走信箱 |
| **E14/E17/E19** | 等 E18 | 不再被 E18 阻塞（信箱不依赖原生传输） |

---

## 6. 整体实现思路上可借鉴的（非 libnode）

### 6.1 运行时用接口抽象 + **诚实的"未接线"实现**

`hostruntime/src/main/ets/runtime/RuntimePort.ets`：`RuntimeKind` 枚举（`NONE`/`ELECTRON_OHOS`/`LIBNODE`）、`probe()` 必须如实报告"没探测到"（**不允许用默认值伪装成已探测**）、`available===false` 必须给 `note` 与下一步。

还有 `NotWiredRuntime` —— **它不是占位，而是让"当前真实状态"在类型系统里成立**，从而界面可以照常渲染"未接线 + 原因 + 下一步"，而不是靠 `if` 判空。

**可借鉴**：我们的 `NodeRuntimeOptions`/`NodeState` 已在做类似的事；但"未接线实现"这个思路能直接用在 E14/E17/E19 这些"还没做"的能力上 —— 让界面**如实**显示"未实现 + 为什么"，而不是给一个点了没反应的入口（这正是我们 §K 里"需拍板关闭"那几张表的界面化表达）。

### 6.2 跨语言契约做成**可单测纯函数**

`buildHostArgv(entryScript)` / `buildHostEnv(...)` / `isWellFormedEnvPair(pair)` 三个纯函数 + 单测钉住。理由（原文）：

> 键名拼错 → Host 用上默认目录，表面上起来了、实际指向错的 `$DSH_HOME`。

以及一条硬纪律：**`--jitless` 必须排在脚本路径之前**（Node 把第一个非选项参数当脚本）；**任何 Node 不认识的开关都会让进程死在 CLI 解析上**（E68 的实例：多传一个 `--trusted-host` ⇒ `node: bad option` ⇒ 端口从未应答，而"上一版是能起来的"）。

**可借鉴**：我们的 `env` 是 `KEY=VALUE` 字符串数组（第 6 个 `envPairs` 参数）—— **同款设计**，但缺"格式不合法必须回报条数"这条（它有 `envApplied` + `envBad` 计数，并且把"跳过并计数"写进返回值）。

### 6.3 就绪判据：TCP connect，不用 HTTP 栈

```ts
// NodeRuntime.portAnswers(): socket.constructTCPSocketInstance().connect({address:'127.0.0.1', port})
```
理由（原文）：设备外经 `hdc fport` 能拿到 401，**应用进程内** `http.createHttp()` 的 GET 在 15 s 预算里**全部** connect/read 超时 —— HTTP 栈受系统代理影响（"代理不回传 127.0.0.1 是标准行为"）。

配套：`host-ready.json` 读 token **必须校验 pid**（`process.pid` 与文件里的 `pid` 相等），否则会拿到**上一个进程**的 token（"应用重启的窗口里可能读到上一次进程留下的文件"）。还要有短重试（端口通 → 写文件，毫秒级窗口）。

**可借鉴**：我们的 `pi-web.ready.json` 是否带 pid 校验？若只按"文件存在 + 端口匹配"判，**重启竞态**下可能拿到旧 token。这是**低成本高价值**的一条。

### 6.4 默认工作区：ArkTS 侧认领、经 env 注入、Node 侧**只验证不创建**

`claimPublicDownloadFolder()` 在 `spawn` 之前 `await` 完成（`DocumentPickerMode.DOWNLOAD` 的 `save()`，无 UI，实测 ~106 ms），结果放进 `DSHM_PUBLIC_DOWNLOAD`。理由：

> env 是 spawn 时定死的，**天然无竞态**；若改成"启动后再写状态文件给 Host 读"，Host 早已用旧值算完默认工作区。

还有一条我们踩过同样的坑：**应用进程直拼公共路径 `mkdir` 必 EPERM** ⇒ Node 侧只做 `lstat` + 探写，不建目录。空串时**不写这一项**（Host 靠"这一项不存在"判回退）。

**可借鉴**：这条正是我们 `P1a 沙箱根派生` 的同族问题。我们已有 `sandboxRoot(filesDir)` + 启动断言；**"空值不写该 env"** 这个约定值得核对（否则会注入一个空路径）。

### 6.5 核心树与入口脚本**生命周期分离**

> `entryScript` … **不属于任何一版核心树**：核心树是可切换/回滚的，而入口脚本随应用发版，两者生命周期不同，混在一起会导致"回滚核心版本把入口脚本也换掉了"。

`DSH_HOME` 与核心树分离：会话/设置/凭据/工作区跨版本共享；"升级核心不得动用户数据"。

**可借鉴**：我们有 `payload/<sha12>/pi-web` + `pi-web-launch.js`。**launch 脚本是否也在 sha12 目录里**？若是，则"换载荷 = 换 launch"，与它这条正好相反。值得核。

### 6.6 激活事务（状态机 + 快照指纹 + 回滚）

```
installBundled → 解压到 cores/<v>.staging → verify（顶层目录 + dshm-core.json + 三哨兵）
  → health（未运行时真起一次，端口应答 = PASS；在跑时不启候选，因同进程二次 node::Start 会 SIGABRT）
  → activate（写 state.json：current/previous/history）
  → 失败：dropStaging / 保持原版本 / 拒绝覆盖"正在使用中"的版本
`evict` 永不删 current/previous
```
哨兵刻意只取三个，**不做全树计数**（2.5 万文件数一遍代价太大）。指纹用 `.dshm-bundled-stamp = zip 字节数`（⚠️ 它自己的报告也登记了这条的弱点：**新旧 zip 恰好同尺寸会被跳过**）。

**可借鉴**：我们的载荷是 `<sha12>` 命名 ⇒ 本身防"同尺寸"问题，比它强。但"**在跑时不启候选**（同进程二次 `node::Start` SIGABRT）"这条对我们是**硬约束**——我们的"切载荷"若也想热切，必须先确认这一点。

### 6.7 打包期"注入式补丁"

不 fork 上游，但允许**受控的文本注入**（16+ 个标记），每条要求：
1. `includes(MARK)` 幂等跳过；
2. 锚点不在 ⇒ `die("…拒绝静默跳过")`；
3. 注入后 `node --check` 全文语法自检；
4. 门禁**正向**（标记在、出现次数精确）+ **反向**（上游原文反例不得残留）。

**可借鉴**：与我们的 `patches/v0.12.1/*.patch` + `PI_WEB_PATCH_MARKERS` 同源，但它多两条我们**没有**的：
- **反向断言**（"被替换掉的原文不得复活"）；
- **精确次数**（`DSHM_MAP_COMPAT 恰好 2 处`） —— 防止"补丁打了两遍/打丢一半"。

### 6.8 门禁纪律（这条最值得抄，也最容易抄错）

它的四条判据（`AGENTS.md`）：
1. **归真**：门禁必须先在**已知坏版本**上红过，否则不算门禁（"红必须绑定提交 id"—— HEAD 已含修复时会 0 命中）。
2. **假阳性比漏报更糟**（案例：180 条 → 2 条 → 0 条）。
3. **只 print 不校验 = 假门禁**（案例：图标 3577 B → 59441 B 仍打"未改动"）。
4. **断言方向要自洽**（`includes`/`!includes` 靠化石巧合长期通过）。

还有一条工程化细节：**"没跑成"必须是第三种状态**（`exit 3`），不能与"通过"共用 exit 0；并且 **"CI 绿" ≠ "全绿"**（需要核心树/设备的门禁不进 CI，会以 exit 2/3 结束）。

**可借鉴**：我们的 `PI_WEB_PATCH_MARKERS` 已有正向断言；建议补 §6.7 的反向 + 次数，并把 `exit 2`（补丁应用失败）之外的"跳过了"也归到非零。

### 6.9 观测性：可用面只有"文件 + hiLog + dumpLayout + /proc"

- **stdout 不进 hiLog**（这条害得它把"看不到日志"误读成"代码没跑"）。
- **`process.exit(1)` 在鸿蒙上变 SIGABRT**（`Unexpected call: exit(1)`）⇒ 诊断期它**拦截 `process.exit` 并拒绝退出**，先把调用栈落盘。
- **hiLog 缓冲小、有丢日志前科** ⇒ 时序类判据只信文件标记。
- **两个日志文件分工必须都拉**：`BOOT_*`/`DSHM_READY` → `node-output.log`（stdout）；`diag()` → `dshm-host.log`（stderr）。只拉一个曾导致"宿主从未就绪"的误判。
- **本机同参复现**是最高性价比观测面：`node --jitless --no-experimental-fetch hostcore/app/main.js`（但"本机复现不出" ≠ "设备不是这个原因"）。

**可借鉴**：我们已有 `app.log` + `node.log` 双通道（同款结论）。可补两条：① `process.exit` 拦截 + 调用栈落盘；② 把"BOOT 阶段标记"做成**命名有序但时间无序**的显式说明（它踩过"按名字顺序读时间"的坑）。

### 6.10 jitless 的连锁代价清单（我们部分重合）

它不是性能选择，而是**上架前提**（不申请 JIT/可写可执行内存）。连锁：
1. `WebAssembly === undefined` ⇒ 任何 `import('undici')` 必失败（`web_fetch` 坏、`web_search` 好）；
2. **必须两层垫片**：全局 `fetch`（不做则调模型不通）+ `undici` **模块名解析钩子**（不做则 web_fetch 打不开网页）；
3. 垫片缺 `Request`/`Response` 签名/`Response.json` ⇒ 一律表现成"空体 400"；
4. 升级上游后必须**重搜 undici 直接依赖**（当成验收项）。

**可借鉴**：我们走的是 **WASM 自带路线**（`wasm_bg.wasm` 30,393,446 B，E5 已证）⇒ 与它的处境**不同**，不要照抄它的垫片。但第 4 条对我们同样成立：**升级 `pi-web` 后要重跑 E5 的四段证据链**。

---

## 7. 不建议照抄

| 项 | 为什么 | 我们的现状更好 |
|---|---|---|
| **自建 Node 交叉编译**（`tools/node-runtime/` 20+ 脚本、4 份上游源码补丁、30~90 分钟、WSL2） | 我们用的是既有 `libnode.so`（126,809,264 B），且已验证可跑；自建只在"要换 Node 版本/加编译选项"时才值得 | — |
| **单包 ~300 MiB**（`libnode` 120.93 MiB 不可裁 + libvips + 工具链 + 语音模型） | 我们 HAP 130.9 MB（载荷 84.9 MB），已经更小 | ✅ |
| **固定端口 3120** | 它靠"同进程只有一个 Host"来保证；我们随机端口 + `ready.json` 更抗冲突 | ✅ |
| **WebView 内注入 `client.js` 覆盖官方前端**（改麦克风采集、改主题） | 维护成本高、每次上游改版都可能失效 | 我们只做品牌化替换（E13） |
| **`coreVersion` 里的 `+dshm.<n>` build metadata 人工递增** | 它的指纹弱（字节数），我们的 `sha12` 目录名更强 | ✅ |
| **把 `.so` 文件名改成 `*.so.137`** 除非先确认 hvigor 打包规则 | ⚠️ 它的门禁注释说 hvigor 只打 `*.so`，与它实际发的 `libnode.so.137` **有张力**（未验证） | §4.3 给 A/B 两条 |

---

## 8. 未验证 / 风险

1. ⚠️ **无法逐字节比对 `libnode`**：DSHM 的 `entry/libs/**` 与 `libnode.so.137` 均被 `.gitignore`，本机不存在。我只能说"它记 120.93 MiB、我们 126,809,264 B（=120.94 MiB），量级一致"，**不能断言同一份二进制**。
2. ⬜ **`libnode.so.137` vs `libnode.so` 的打包行为**未实测（hvigor 是否打非 `*.so` 结尾文件）。
3. ⬜ **`UV_USE_IO_URING=0` 对我们的 libuv 是否生效**未实测。我们已用 SIGSYS shim 绕过，切换前需 A/B（shim 与 env 同时存在时的行为未定义）。
4. ⬜ **文件信箱的 ArkTS 侧轮询成本**未在我们工程测过（它在 ArkTS 侧用 500 ms、Node 侧 100 ms；我们的 `startTransport(100)` 已是 100 ms）。
5. 🔶 本文所有"真机已验证"均引自 DSHM 自己的文档/注释，**不是**我在本设备复验的。
6. ⚠️ DSHM 自己的报告登记了四处**文档与实物不一致**（如 `libnode.so.137` 实为 Node 24.2.0 而注释写 26.7.0、体积表过期、`docs/50 D-2` 的 tar.gz 已被 zip 推翻）⇒ 引用它的结论时"代码 > 注释 > 文档"。

---

## 9. 行动项（建议顺序）

| # | 行动 | 成本 | 依赖 |
|---|---|---|---|
| **D1** | 核对 `pi-web.ready.json` 是否有 **pid 校验**（§6.3）；没有就补 | 小 | — |
| **D2** | 补"原生库闭包"门禁：`SONAME==文件名` + `DT_NEEDED` 全可解析 + 我们特有的一条（addon 必须 NEEDED libnode、不得 NEEDED libace_napi） | 中 | — |
| **D3** | **E18 改走文件信箱**（§5），原生槽位表保留给 ArkTS 内部；同时把 §4.3 的原生修法登记为"可选优化" | 中 | — |
| **D4** | 核 `pi-web-launch.js` 是否落在 `payload/<sha12>/` 内（§6.5：入口脚本应与载荷生命周期分离） | 小 | — |
| **D5** | 补丁门禁加"反向断言 + 精确次数"（§6.7） | 小 | — |
| **D6** | 若将来确实需要原生 RPC：按 §4.3 六步做，**先做 `readelf`/`nm` 两条读数**再装机（成本≈一次构建） | 大 | 需要 D2 |
| **D7** | 观测性补两条：`process.exit` 拦截落盘；BOOT 标记"命名有序/时间无序"的显式说明 | 小 | — |

> **不建议**做的：自建 Node 交叉编译链、改固定端口、WebView 注入覆盖前端。

---

## 附录 A：本文引用的 dshm 关键文件

| 文件 | 行数 | 作用 |
|---|---|---|
| `hostruntime/src/main/cpp/dshhost.cc` | 587 | libnode 引导（dlopen/dlsym/四名字/诊断块） |
| `entry/src/main/cpp/CMakeLists.txt` | 15,809 B | 全部链接口径与"为什么"注释 |
| `hostruntime/src/main/ets/runtime/RuntimePort.ets` | 265 | 契约纯函数 + 未接线实现 |
| `entry/src/main/ets/runtime/NodeRuntime.ets` | 379 | 载体实现（TCP 就绪、pid 校验、协作停止） |
| `entry/src/main/ets/speech/HmsSpeechBridge.ets` | 771 | ⭐ 文件信箱参考实现 |
| `hostcore/speech-provider/index.js` | 534 | ⭐ 文件信箱的 Node 侧 |
| `hostcore/app/main.js` | 5,338 | Node 入口脚本（stop 巡检、exit-mode、诊断引导） |
| `tools/check-native-closure.mjs` | — | ⭐ 原生闭包静态门禁 |
| `docs/70-鸿蒙移植踩坑与修复总览.md` | — | 按主题的坑库（E 编号可查） |
| `AGENTS.md` | 30,276 B | 回归纪律 / 门禁清单 / 出包三坑 |

## 附录 B：修订记录

| REV | 日期 | 内容 |
|---|---|---|
| 1 | 2026-10-17 | 初版：§0–§9 + 附录。含 §4 对 E18 归因的更正（基于本机 `llvm-nm`/`llvm-readelf` 实测） |
| 2 | 2026-10-17 | **D3 已执行并真机跑通**：E18 传输层改为文件信箱（`HostBridge.startMailbox` + `host.js#useFileMailbox`），§5 的协议与五条硬获细节**全部落地**（含 `.req` 陈旧回收、在飞 `.wip` 豁免、成功也写心跳、原子写、失败如实回 `.fail`）。真机：`runtime.facts` 往返 **2 ms**、未注册能力走 `.fail` 返回 `unregistered` **1 ms**、零残留、二次冷启复现。顺带修掉 `HostCapabilities.runtimeFacts()` 缺包裹引号的真缺陷（非法 JSON，position 282）。**D1/D2/D4/D5/D6/D7 仍未做** |
