# STRUCTURE.md —— `pi-desktop-ark` 目录与文件结构（as-built）

> 口径：**已落地**（✅ 见 `git ls-files` 与工作区）与**规划落点**（⬜）分开标注；未实现项一律写 `⬜ 规划未实现（Phase N）`。
> 依据：规划 [`../docs/000-工程规划.md`](../docs/000-工程规划.md) **§14.1/§14.2**；代码事实取自本仓库工作区（2026-10-16）。
> 相关：[`constitution.md`](constitution.md)（原则）· [`ARCHITECTURE.md`](ARCHITECTURE.md)（分层与数据流）· [`TECH.md`](TECH.md)（选型）。

---

## 1. 目录树（含逐文件用途）

```
pi-desktop-ark/
├── LICENSE                                     # MIT（上游 pi / pi-web 同为 MIT；许可清单见 §5）
├── README.md                                   # ✅ 工程导读：构建/装机两步、JIT 的 ACL 前提、已知限制
├── .gitignore                                  # ✅ 不入库清单的**唯一执行者**（见 §5）
├── AppScope/                                   # ✅ 应用级（非模块级）配置与资源
│   ├── app.json5                               # ✅ 包名/版本/图标/API 版本（见 §2.1）
│   └── resources/base/
│       ├── element/string.json                 # ✅ app_name = "Pi Desktop Ark"
│       └── media/app_icon.png                  # ✅ 应用图标（G7 三一致的图标来源）
├── build-profile.json5                         # ✅ 产品/签名指针（**签名材料不入库**，见 §2.2）
├── hvigorfile.ts                               # ✅ 签名注入（不覆盖 DevEco 写入的配置，只补指针）
├── hvigor/hvigor-config.json5                  # ✅ hvigor 模型版本 6.1.1（与 oh-package modelVersion 对齐）
├── oh-package.json5                            # ✅ 顶层依赖：@fellow99/node-bridge 走 `file:./libs/*.har`
├── oh-package-lock.json5                       # ✅ 锁文件（local registryType，版本 0.1.0）
├── signing.debug.local.json.sample             # ✅ 签名材料模板（真实材料 gitignored）
├── libs/
│   └── @fellow99/node-bridge.har               # ⬜ 不入库：`scripts/build-bridge-har.sh` 产物（当前 441,353 B）
├── scripts/
│   ├── build-bridge-har.sh                     # ✅ 构建库 HAR 并拷到 libs/@fellow99/
│   └── provision-runtime.sh                    # ✅ 投放 libnode.so + libc++_shared.so（委托库 provision.mjs）
├── entry/                                      # 主模块（唯一模块，HAP）
│   ├── build-profile.json5                     # ✅ 模块构建选项（不编译 C++、nativeLib.collectAllLibs）
│   ├── hvigorfile.ts                           # ✅ hapTasks（模块侧无自定义逻辑）
│   ├── oh-package.json5                        # ✅ 模块名 entry / version 1.0.0（模块版本，与应用版本无关）
│   ├── libs/arm64-v8a/                         # ⬜ 不入库：libnode.so（126,809,264 B）+ libc++_shared.so（1,262,504 B）
│   ├── build/                                  # ⬜ 构建产物（含 entry-default-signed.hap）
│   └── src/main/
│       ├── module.json5                        # ✅ 模块声明：deviceTypes/页面/Ability/权限声明面（见 §2.3）
│       ├── ets/
│       │   ├── entryability/EntryAbility.ets    # ✅ 颜色模式、probeFlags → AppStorage['nodeFlags']、loadContent
│       │   ├── pages/Index.ets                  # ✅ 状态条 + ArkWeb（boot 页 → 本地服务页）+ 重试/日志按钮
│       │   ├── app/PiDesktopRuntime.ets         # ✅ UIState 状态机、载荷物化、start()、探活、失败态
│       │   ├── common/Constants.ets             # ✅ 端口/路径/探活参数/阶段文案 + hilog 包装
│       │   ├── host/                            # ⬜ Phase 2：宿主能力实现（perm.check / fs.pickFolder / openExternal / notify）
│       │   ├── shell/                           # ⬜ Phase 1–2：ArkTS 加载页 / 错误页 / 导航围栏 / 历史清理
│       │   └── panel/                           # ⬜ Phase 1：诊断面板（日志尾 = Logger.tail 读回）
│       └── resources/
│           ├── base/element/string.json         # ✅ 模块文案 + 8 条权限 reason（⚠️ `module_desc`/`EntryAbility_*` 三条**仅 base**，三语补齐见 constitution T2）
│           ├── base/element/color.json          # ✅ start_window_background = #FFFFFF
│           ├── base/media/{icon,startIcon}.png  # ✅ Ability 图标 / 启动图
│           ├── base/profile/main_pages.json     # ✅ 路由表（只有 pages/Index，见 §3）
│           ├── zh_CN/element/string.json        # ✅ 8 条权限 reason 中文
│           ├── en_US/element/string.json        # ✅ 8 条权限 reason 英文（与 base 逐字节同文）
│           ├── rawfile/                         # ✅ 随包原样资源（解压语义不可控，见 §4）
│           │   ├── boot.html                    # ✅ 首屏加载页（ArkWeb 内加载）
│           │   └── selfcheck.js                 # ✅ 骨架期载荷：env 自检 + `/facts` + `/log`
│           └── resfile/pi-web/                  # ⬜ 应用载荷落点（**只读直读**）；当前只有 README.md
├── docs/                                       # ✅ 见 `docs/README.md`
│   ├── 000-工程规划.md                          # 唯一权威规划（747 行）
│   ├── ACL配置.md                              # 声明面/授权面/两次装机实测/两条设计规则
│   ├── README.md                               # 文档索引
│   └── evidence/2026-10-16-acl-jit-verified.md  # 真机证据（/facts 原样 JSON + 复现命令）
└── specs/                                      # ✅ 本目录（项目级规格）
    ├── constitution.md                         # 宪法（A1–A10 + 规约 T1–T9 + 红线 + 评审 + 变更）
    ├── STRUCTURE.md                            # ← 本文件
    ├── TECH.md                                 # 技术选型
    ├── ARCHITECTURE.md                         # 架构（分层/时序/状态机/16 项能力/鉴权/载荷）
    ├── overall-spec.md                         # 整体规格（技术无关，FR-ARK-*）
    ├── overall-plan.md                         # 整体技术方案（Phase/跨切面/测试/流水线）
    ├── overall-data-model.md                   # 数据模型（状态/环境/目录/权限/体积/HTTP 面）
    ├── overall-test-cases.md                   # 测试用例索引（TC-ARK-* / TC-1NN-*）
    └── 1NN-<name>/{spec.md,plan.md[,tasks.md,test-cases.md]}  # ⬜ 模块级规格（规划 §14.2，Phase 1 起）
```

> 说明：`entry/src/main/ets/{host,shell,panel}/` 在规划 §14.1 里写作 `{host,shell,panel}/`（✅ 同一口径），
> Phase 1–2 落地时**只允许**往这三个目录加文件，不要把 shell 逻辑塞进 `pages/` 或 `app/`。

---

## 2. 关键配置

### 2.1 `AppScope/app.json5`（应用身份与 API 级别）

| 键 | 值 | 说明 |
|---|---|---|
| `bundleName` | `org.fellow99.pi.PiDesktopArk` | 包名；**签名证书与其绑定**，改包名 ⇒ ACL 必须重新申请（宪法 A10） |
| `vendor` | `fellow99` | — |
| `versionCode` / `versionName` | `100` / `0.1.0` | 编码规则 `major*10000 + minor*100 + patch`（对齐旧壳）；上架每次必须递增（G7） |
| `icon` / `label` | `$media:app_icon` / `$string:app_name`（"Pi Desktop Ark"） | 图标/命名/备案三一致的落点（G7） |
| `minAPIVersion` / `targetAPIVersion` | `17` / `24` | ⚠️ **与规划 §1 的「API 26」口径不一致**：真机实测 `const.ohos.apiversion = 26`（🔶 旧壳能力清单），但本工程 `targetAPIVersion` 写的是 **24**；`build-profile.json5` 的 `compatibleSdkVersion = 5.0.5(17)`、`targetSdkVersion = 6.1.1(24)`。Phase 1 需明确「API 26 只说设备，不说 targetSdk」的口径并写回规划（见 `overall-plan.md` 的开放问题） |

### 2.2 `build-profile.json5`（产品与签名指针）

| 区块 | 内容 | 纪律 |
|---|---|---|
| `app.signingConfigs[]` | 当前**含本机材料**（证书/`.p12`/`.p7b` 绝对路径 + hvigor `DecipherUtil` 密文口令） | ✅ DevEco「自动生成签名」会把材料写进来；`git status` 显示其为本机**未提交改动**（`M build-profile.json5`）⇒ **不得提交**（宪法 T3） |
| `app.products[].name` | `default` | 与 `hvigorw -p product=default` 一致 |
| `compatibleSdkVersion` / `targetSdkVersion` | `5.0.5(17)` / `6.1.1(24)` | 见 §2.1 的口径备注 |
| `buildOption.nativeLib.collectAllLibs` | `true` | 让 `entry/libs/arm64-v8a/` 的原生库进包（module 级 `nativeLib` **不接受** `abiFilters`，已实测报 schema 错） |
| `buildOption.strictMode.useNormalizedOHMUrl` | `true` | 该模式**拒绝跨工程源码相对导入**（`00309001`）⇒ 必须消费 HAR（宪法 T7） |
| `products[].signingConfig` | 文件中**没有** | 由 `hvigorfile.ts` 在构建期补指针（少了它即便材料在也会**静默产出未签名包**） |
| `modules[]` | `entry` / `srcPath: ./entry` | 单模块应用 |

### 2.3 `entry/src/main/module.json5`（模块声明与权限声明面）

| 区块 | 内容 | 事实 |
|---|---|---|
| `deviceTypes` | `["2in1", "tablet"]` | 不做 phone（规划 §0.3） |
| `mainElement` / `pages` | `EntryAbility` / `$profile:main_pages` | 唯一入口 Ability + 路由表 |
| `abilities[0]` | `EntryAbility`：`exported: true`、`backgroundModes: ["taskKeeping"]`、`startWindowIcon`/`startWindowBackground` | ⬜ 规划 §5 第 16 条要求 `launchType: singleton`，**当前未显式声明** |
| `abilities[0].skills` | 仅 `entity.system.home` + `action.system.home` | ✅ G2：**不**声明 `entity.system.browsable` / `ohos.want.action.viewData` |
| `requestPermissions` | **21 项**（`web_engine` 的 23 项 + `KEEP_BACKGROUND_RUNNING`，**已撤销 3 项**：剪贴板 / 桌面 / 持久化授权；**保留**文档 / 下载），其中 **6 项**带 `reason` + `usedScene` | ✅ 基线逐项一致，见 `docs/001-能力复刻评估.md` REV-5·6·7；现役 ACL 仅 1 项（`docs/ACL配置.md` §1.1） |
| `definePermissions` | `LOCK_WINDOW_CURSOR`、`kernel.ALLOW_WRITABLE_CODE_MEMORY` | ✅ 与 `requestPermissions` **成对出现**（受限权限口径） |

> 权限明细、分类与「声明面 ≠ 授权面」的两次装机实测见 [`../docs/ACL配置.md`](../docs/ACL配置.md) 与 [`overall-data-model.md`](overall-data-model.md) §5。

### 2.4 `entry/src/main/resources/base/profile/main_pages.json`（路由表）

```json
{ "src": [ "pages/Index" ] }
```

唯一路由 = `pages/Index`。新页面必须同时改这里（否则 `loadContent`/路由解析失败）。

### 2.5 其它配置

| 文件 | 用途 |
|---|---|
| `hvigorfile.ts`（根） | 签名材料注入：① 环境变量（`CERTPATH`/`STORE_FILE`/`PROFILE`/`KEY_PASSWORD`/`STORE_PASSWORD`…）② `signing.<mode>.local.json`；两者都没有 ⇒ **不改动任何东西**并补 `products[].signingConfig` 指针 |
| `entry/build-profile.json5` | `apiType: stageMode`；`nativeLib.collectAllLibs: true`；**不编译 C++**（引导件随 HAR 提供） |
| `oh-package.json5`（根/模块） | 依赖链；模块 `version` 必须 ≥1.0.0（hvigor 对 0.x 报 SemVer 告警） |
| `hvigor/hvigor-config.json5` | `modelVersion 6.1.1`（依赖/执行/日志/调试段为空） |

---

## 3. 路由 / 页面清单

| 路由 | 文件 | 用途 | 状态 |
|---|---|---|---|
| `pages/Index` | `entry/src/main/ets/pages/Index.ets` | 唯一页面：顶部状态条（`UIState` + 文案）+ 重试/日志按钮 + `Web({src: $rawfile('boot.html')})`，`READY` 后 `loadUrl('http://127.0.0.1:<port>/')` | ✅ 骨架 |

- ⬜ Phase 1–2 计划新增的**不是**新路由，而是同一页面上的叠加视图：ArkTS 加载页/错误页/诊断面板（规划 §5 第 12 条要求「ArkTS 加载页」而不是 `data:`/`rawfile` 页）。
- ⬜ 规划 §5 第 8 条的外链「真正注册的能力」（旧壳的死代码 `ExternalWeb.Open` 调用即 SIGSEGV，不得照抄）——落地时若需要独立页面，必须同步改 `main_pages.json`。

---

## 4. 资源目录规则（`rawfile` vs `resfile`）

| 维度 | `entry/src/main/resources/rawfile/` | `entry/src/main/resources/resfile/pi-web/` |
|---|---|---|
| 语义 | 随包**原样**资源（应用可经 `resourceManager` 取内容） | 随包**只读**资源目录（面向「数万小文件载荷」的落点） |
| 读取方式 | ArkTS：`getRawFileContentSync(name)`；Node：**读不到包内只读条目**（库硬约束 ④） | Node：从安装目录**直读**（规划 §7.1 路线 ①，`resfile` 直读） |
| 本工程用法 | `boot.html`（首屏加载页）、`selfcheck.js`（骨架载荷，启动时由 ArkTS **物化**到 `<filesDir>/payload/`） | `pi-web` + `pi` 的构建产物（⬜ 现只有 `README.md`） |
| 大小上限直觉 | 适合**少量、需 ArkTS 处理**的文件 | 面向**大载荷**；数万小文件是否可接受 ⬜ 待 P0-13 实测（规划 §8.4、风险 A1） |
| 幂等/失败面 | 物化是「覆盖写」，天然幂等 | 零解压 ⇒ 无首启解压失败面（首选路线的收益） |

**规则（违反即返工）**：

1. **谁写谁读**：ArkTS/OHOS 侧解压器写出的文件 Node **读不到**（`MODULE_NOT_FOUND`）⇒ 载荷解包只能由 **Node 自己**做（库宪法 C3）；
2. 需要**可写**的载荷才走 `tar.gz` + Node 自解包；只读不可写需求优先 `resfile` 直读（规划 §7.1）；
3. `resfile/pi-web/` 内容**全部 gitignored**（保留 `README.md` 作为落点说明）；
4. **路径一律绝对**：真机 `process.cwd() = /`，入口脚本必须用绝对路径指到 `resfile`/沙箱（宪法 T5）。

---

## 5. 不入库清单（由 `.gitignore` 执行）

| 路径 | 为什么不入库 | 谁生成 | 缺失时的后果 |
|---|---|---|---|
| `entry/libs/`（`libnode.so` 126.8 MB + `libc++_shared.so`） | 二进制 120+ MB，版本由锁文件管理（库附录 G.1「两层解耦」） | `scripts/provision-runtime.sh`（委托 `ohos-node-bridge/tools/provision.mjs`，SHA-256 + 七项 ELF 门禁） | HAP 里没有 Node ⇒ 启动必失败；脚本会明确报错，不会静默降级 |
| `libs/**/*.har` | 库的**构建产物**（441,353 B），消费者应从 ohpm/构建流程取 | `scripts/build-bridge-har.sh` | `ohpm install` 找不到 `@fellow99/node-bridge` ⇒ 编译失败 |
| `entry/src/main/resources/resfile/pi-web/*`（保留 `README.md`） | 载荷压后预估 70–90 MB（规划 §7.2），git 不适合 | Phase 1 的载荷组装脚本（⬜ 待建） | 主界面起来后 `/` 404（服务端无内容） |
| `signing.*.local.json`、`*.p12`、`*.p7b`、`*.cer` | 签名私钥与口令（宪法 T3） | 开发者本机 / DevEco | 无材料 ⇒ 产出**未签名 HAP**（不能装机），不报错 |
| `build-profile.json5` 的 `signingConfigs` 内容 | 同上（文件本身入库，材料属本地未提交改动） | DevEco「自动生成签名」 | 同上 |
| `**/build/`、`**/.hvigor/`、`**/.cxx/`、`**/.preview/`、`oh_modules/`、`*.hap` | 构建产物与依赖缓存 | hvigor / ohpm | 无影响（可重建） |
| `/.idea/`、`*.iml` | 编辑器状态 | DevEco | 无影响 |
| （库仓库内，非本仓库）`../ohos-node-bridge/runtime/`（仅 `*.so` 不入库）、（父工程）`/_test` | 运行时缓存与探针工程 | 库侧 tooling | 缺产物时 `provision --download` 联网取（国内要 `NODE_USE_ENV_PROXY=1`）；2026-10-18 前缓存在父工程 `/ohos-node-runtime` |

> ⚠️ **当前工作区状态**：`entry/libs/arm64-v8a/`、`libs/@fellow99/node-bridge.har`、`entry/build/**` **已存在于本机**（构建过），但它们都不在 git 索引里 —— 这是**正确状态**，不要顺手 `git add`。

---

## 6. 模块编号 ↔ 目录落点（规划 §14.2）

| 编号 | 模块 | 主要落点目录/文件 | 现状 |
|---|---|---|---|
| `101-runtime-integration` | 运行时接入 | `et/app/PiDesktopRuntime.ets`、`et/common/Constants.ets`、`et/entryability/EntryAbility.ets` | ✅ 骨架（⬜ 随机端口、关停、诊断面板） |
| `102-payload-pipeline` | 载荷流水线 | `entry/src/main/resources/resfile/pi-web/`、⬜ `scripts/`下的组装/裁剪脚本 | ⬜ 未开始 |
| `103-arkweb-shell` | 渲染壳 | `et/pages/Index.ets`、`rawfile/boot.html`、⬜ `et/shell/` | ✅ 骨架（⬜ 围栏/清历史/错误页） |
| `104-host-capabilities` | 宿主能力 | ⬜ `et/host/`（`HostBridge` 的 ArkTS 实现） | ⬜ 未开始 |
| `105-auth` | 鉴权 | ⬜ `et/shell/`（Cookie 注入）＋ Node 侧启动脚本（密码派生） | ⬜ 未开始（路线选型 = 规划 §6.2 ①） |
| `106-tools-extensions` | 工具扩展 | ⬜ 载荷内 `pi-agent/extensions/`（`bash`/`find`/`grep` 同名顶替 + 工作区主目录） | ⬜ 未开始（复用旧壳资产） |
| `107-compliance` | 合规 | `AppScope/app.json5`、`module.json5`、⬜ 许可清单与材料 | ⬜ Phase 3 |

---

## 7. 与兄弟工程的关系

| 兄弟工程 | 关系 | 依赖的具体物 | 断开的后果 |
|---|---|---|---|
| `../ohos-node-bridge` | **依赖（运行时库）** | `library/build/.../library.har`（经 `scripts/build-bridge-har.sh` 拷成 `libs/@fellow99/node-bridge.har`）＋ `tools/provision.mjs` ＋ `runtime.lock.json` | 构建/投放失败（脚本会指出 `BRIDGE=<路径>` 补救） |
| `../pi` | **上游（agent harness）** | 载荷内容的一部分（`@earendil-works/*`）；补丁纪律见规划 §9 | 载荷不完整 |
| `../pi-web` | **上游（UI + Next 服务端）** | 载荷内容与 `/api/*`、SSE、鉴权源码事实（规划 §6.1） | 主界面无内容 |
| `../pi-desktop-hos` | **资产来源与对标基线**（一次性退役） | 环境装配、进程内 Next 宿主、三个同名扩展、预置模板、工作区补丁、全部失败经验（规划 §8.3） | 需重新踩坑（不阻塞构建） |
| `../harmonypc-electron` | **被推翻的对象** | 无（仅历史对照：`libelectron.so` 181 MB / HAP 320.3 MB 的合规与体积教训） | — |
| `../pi-workspace`（父容器） | 容器仓库 | submodule 布局；运行时缓存 2026-10-18 起在 `../ohos-node-bridge/runtime/`（仅 `*.so` 不入库），此前为父容器同级 `../ohos-node-runtime/` | 脚本中的相对默认路径失效（可用 `BRIDGE=`/`OHOS_NODE_RUNTIME_DIR=` 覆盖） |

> 本工程是 `pi-workspace` 的 **submodule**，构建脚本按 `../` 解析兄弟目录（库规划 §7.1）⇒ **不要**把本工程单独拷出仓库根外构建。

---

## 8. 新增文件的落点纪律

| 你要加的东西 | 放哪里 | 不许放哪里 |
|---|---|---|
| 宿主能力实现（权限/选择器/外链/通知） | `entry/src/main/ets/host/` | `pages/`、`app/` |
| 加载页 / 错误页 / 诊断面板 / 围栏 | `entry/src/main/ets/shell/`、`panel/` | `PiDesktopRuntime.ets`（它只做编排与状态） |
| Node 侧启动脚本、同名扩展、预置模板 | 载荷内（`resfile/pi-web/` 或 `pi-agent/`）；**host 侧脚本**放 `scripts/` | `entry/src/main/ets/`（那是 ArkTS，不是 Node） |
| 真机证据 | `docs/evidence/YYYY-MM-DD-*.md` | `specs/`（specs 只引用证据） |
| 模块规格 | `specs/1NN-<name>/`（编号见 §6） | `specs/` 根（根只放项目级八件套） |
