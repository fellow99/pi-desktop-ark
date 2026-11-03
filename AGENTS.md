# AGENTS.md — pi-desktop-ark（Pi Desktop · HarmonyOS 版）

> 本文件是本工程（`pi-desktop-ark`）的 AI Agent 工作规范与导航入口。
> 事实权威：`docs/000-工程规划.md`（v0.1，结论以它为准）；运行时契约见 `ohos-node-bridge/docs/000-工程规划.md` §6；
> 行为权威：`specs/constitution.md`。本文档只做收敛与回引。

---

## 一、项目定位

**Pi Desktop · HarmonyOS 版**（`pi-desktop-ark`）—— **不带任何 Chromium/Electron** 的鸿蒙纯血版：
ArkTS 宿主（UIAbility + **ArkWeb**）加载端上 `pi-web` 服务，该服务跑在**进程内 Node.js 运行时**
（`@fellow99/node-bridge` + `@fellow99/node-runtime`，均 ohpm 中心仓，`dlopen` + `node::Start`，Node **v24.2.0**）。
功能目标是与 `pi-desktop-hos`（Electron on HarmonyOS 版）对齐；载荷用 `pi-web` 补丁 **6 条**。

- 应用名 / 包名：`Pi Desktop Ark` / `org.fellow99.pi.PiDesktopArk`
- 目标设备：`2in1` / `tablet` / `phone` / `tv`（第 0 级真机已过：2in1 / tablet / phone；tv 未测）
- 版本：`0.14.2` / `versionCode` `1402`（tag `v0.14.2`）
- 上游基线：`pi` **v1.5.0** + `pi-web` **v0.14.2**

**⚠️ 运行形态**：编译期固定为 **compat（`--jitless`）**（`entry/src/main/ets/common/BuildConfig.ets` 的 `NODE_MODE`）。
运行期无形态切换；compat 下 **code-mode 不注册**（依赖 WebAssembly）。出 jit 变体 = 改 `BuildConfig.NODE_MODE='jit'` 后重建。

## 二、关键目录

| 路径 | 作用 |
|---|---|
| `AppScope/app.json5` | 包名 / 版本 / 图标 |
| `entry/src/main/ets/entryability/` | EntryAbility（形态取编译期常量；`--ps` 仅设备侧用例通道） |
| `entry/src/main/ets/pages/Index.ets` | 主界面：状态条 + ArkWeb（boot 页 → 本地服务页） |
| `entry/src/main/ets/app/` | PiDesktopRuntime：启动/探活编排（消费方逻辑） |
| `entry/src/main/ets/common/` | 常量与日志（含 `BuildConfig`：编译期形态开关） |
| `entry/src/main/resources/resfile/pi-web/` | 应用载荷落点（**gitignored**，构建脚本生成） |
| `vendor/node-bridge-payload/` | 库载荷三件 vendored（bootstrap/host/tar-extract） |
| `scripts/` | 载荷组装等构建脚本（`assemble-payload.mjs` 为核心）、jitless 裁剪链 |
| `specs/` | 规格文档集（`011` 版本 / `013` 品牌化 / `1XX` 基础 / `204` Git） |
| `docs/` | 工程规划、能力复刻评估、ACL 评估/配置、真机记录 |
| `patches/` | 上游 `pi-web` 补丁（`v0.14.2/` 6 条幂等可逆文件） |

**构建前提**：依赖 `ohpm` 中心仓运行时包；需 `DEVECO_SDK_HOME` 与 `hvigorw`；脱离开源目录会失败。

## 三、常用命令

```bash
ohpm install            # ① 装依赖（node-bridge 0.1.0 + node-runtime 24.2.0）—— 必须先做，否则 HAP 无 Node
export DEVECO_SDK_HOME='D:\oh-workspace\command-line-tools\sdk'
cmd //c "D:\oh-workspace\command-line-tools\bin\hvigorw.bat assembleHap --mode module -p product=default -p buildMode=debug --no-daemon"
# 产物：entry/build/default/outputs/default/entry-default-signed.hap（有签名材料时）
```

> 详见 README「构建」节；`build-profile.json5`（入库）可能被 DevEco 自动签名写入口令 —— **请勿提交该改动**。

## 四、规格文档（specs）

- 编号：`0XX` 公共模块（011 版本 / 013 品牌化；`012` 不适用于鸿蒙工程）·
  `1XX` 基础模块（101 运行时接入与启动编排 / 102 载荷流水线 / 103 渲染壳 / 104 宿主能力 / 105 鉴权 / 106 工具扩展 / 107 合规 / 108 jitless）·
  `204` Git 插件。
- 每个模块成对提供 `spec.md`（需求/验收）＋ `plan.md`；复杂模块加 `tasks.md` / `test-cases.md`。
- 证据纪律：`✅ 已核实` · `🔶 沿用` · `⬜ 待验证` · `⚠️ 风险`；`🔶` 不得当作本工程实测事实。
- 数据面由上游 `pi-web` 提供，本工程**不自有 API**，故无 `API.md`。

## 五、CodeGraph 代码地图规范

> 本工程已建立 CodeGraph 语义索引，AI 探索**优先走 CodeGraph**。

- 索引位置：`.codegraph/`（不入库，已 `.gitignore`）。
- **自动更新**：git `post-commit` 钩子（`.git/modules/pi-desktop-ark/hooks/post-commit`）在每次提交后自动 `codegraph sync`，非阻塞、不破坏提交。
- 常用命令：`codegraph status` / `codegraph context "<任务>"` / `codegraph query|callers|callees|impact <符号>` / `codegraph affected <文件>`。
- 改动大量源码后查不到符号，先 `codegraph sync` 再查。

## 六、提交纪律

- Conventional Commits（`feat`/`fix`/`docs`/`style`/`refactor`/`perf`/`test`/`build`/`ci`/`chore`/`revert`）。
- **严禁** `git add -A` / `git add .`：只暂存本会话改动的文件。
- **派生产物绝不入库**：`entry/src/main/resources/resfile/pi-web/`（载荷）、`*.hap`、`libs/**/*.har`、`entry/libs/` 为构建生成。
- **签名材料绝不提交**：`signing.*.local.json`、`.p12`、`.p7b`、`.cer`；`build-profile.json5` 若被 DevEco 写入本机口令，勿提交。
- 严禁提交密钥 / Token / 口令。

## 七、安全红线

- 严禁 `as any` / `@ts-ignore` / `@ts-expect-error` 压制类型错误。
- 严禁空的 `catch(e) {}`。
- 修复 Bug 只做最小改动，禁止顺手重构；禁止臆测未读取的代码。
