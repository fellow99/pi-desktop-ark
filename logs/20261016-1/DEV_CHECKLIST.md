# DEV_CHECKLIST —— `000-scaffold` / Phase 1 **应用侧**（`pi-desktop-ark`）

> 记录人：实施者（fixer）· 日期：2026-10-16/17 · 设备：**本机（host）**；**本会话没有真机**
> 结论口径：✅ 本机已复现 · ⬜ 需真机（本会话无法执行）· ⚠️ 发现但**不在本任务授权范围内**的偏差
> 命令一律给可粘贴原文；输出一律给**实际观测到的数字**（不是从规划抄的估计值）。

---

## 0. 交付范围（本次实现）

| # | 能力 | 落点 | 状态 |
|---|---|---|---|
| A | 载荷组装与四项裁剪（dry run 可审计 / `--apply` 复制时裁剪 / `tar.gz` 路线） | `scripts/{crop-rules.mjs,assemble-payload.mjs}` | ✅ |
| B | Node 侧启动脚本（环境契约 / 端口 / 进程内 Next / 就绪 marker / 异常兜底 / 关停钩子） | `payload/{env.js,pi-web-launch.js}` | ✅ 语法与契约级验证；⬜ 真机端到端 |
| B′ | 四个同名扩展 + 预置 config（原样搬自旧壳） | `payload/extensions/*.js`、`payload/config/*.json` | ✅（逐字一致 + 文件头差异说明） |
| C | ArkTS 启动编排（双路线 / `waitUntilRunning` / 真实端口读回 / 探活 / 诊断串 / shutdown） | `entry/src/main/ets/{app/PiDesktopRuntime.ets,common/Ports.ets,host/HostCapabilities.ets}` | ✅ 编译通过；⬜ 真机 |
| C′ | 单实例 | `entry/src/main/module.json5`（仅加 `launchType`） | ✅ HAP 内已确认 |
| D | 渲染壳（`databaseAccess` / `clearHistory` / 返回键守卫 / 导航围栏 / 弹窗 / 诊断面板 / 错误页） | `entry/src/main/ets/pages/Index.ets`、`resources/rawfile/error.html` | ✅ 编译通过；⬜ 真机 |
| E | 关停接线 | `entry/src/main/ets/entryability/EntryAbility.ets#onPrepareToTerminate` | ✅（返回 `false`，依据 SDK 原文） |

---

## 1. 载荷组装（A）—— ✅ 本机

### 1.1 只读路线 dry run（真实文件树，非估算）

命令：

```bash
node scripts/assemble-payload.mjs --route readonly
```

观测（`../pi-desktop-hos/pi-dist` 存在，27232 文件 / 884,167,367 B —— 与规划 §2.3 的 884,167,367 B **逐字节相同**）：

| 规则 | 实际命中 | 规划期望 | 差异 | 证据 |
|---|---|---|---|---|
| `.next/**/*.nft.json` | **76 文件 / 348,096,301 B** | 348,096,301 B / 76 文件 | 0 | ⬜ O1 待真机 |
| `node_modules/@next/**` | **7 文件 / 106,203,772 B** | 106,203,772 B | 0 | ⬜ O2 待真机 |
| `node_modules/@img/**` | **20 文件 / 28,767,609 B** | 28,767,709 B | −100 B | ⚠️ 依赖 `images.unoptimized` |
| `node_modules/node-pty/**` | **39 文件 / 26,914,121 B** | 26,931,902 B | −17,781 B | ✅ 平台级不可用 |
| **合计** | **142 文件 / 509,981,803 B (486.4 MiB)** | — | — | 裁剪后估算 **27,090 文件 / 374,185,564 B (356.9 MiB)** |

> ⚠️ 首次运行时第 1 条报 **0 文件** —— 原因是脚本里复制了一份 glob 匹配器（多出/少了一个 `/`），
> 与 `crop-rules.mjs` 的语义不一致。已修：**匹配只有一份实现**（`crop-rules.mjs` 导出，
> 脚本 import），并把这次事故写进了注释（`assemble-payload.mjs:197`）。
> 这条正是「dry run 的数字必须来自真实文件树」的价值所在。

### 1.2 `tar.gz` 路线端到端（✅ 真跑过，随后清理了产物）

```bash
node scripts/assemble-payload.mjs --route tar --apply --quiet
```

观测：

```
暂存文件    : 27086 /    374167783 B  (356.8 MiB)
裁剪文件    : 76 文件 + 3 个整目录 /    348096301 B  (332.0 MiB)
归档        : entry/src/main/resources/rawfile/pi-web.tar.gz
归档大小    :     84473532 B  (80.6 MiB)
SHA-256     : d9153505e38d18c2399e079e496d68d1a74d517c190b5afa9eea3589ba3b8803
前 12 位    : d9153505e38d   ← 幂等键（NodeRuntimeOptions.archiveSha256 / 库契约 §3.2）
哈希旁文件  : entry/src/main/resources/rawfile/pi-web.tar.gz.sha256
```

- **80.6 MiB 落在规划 §7.2 预估的 70–90 MB 区间内**（这是实测值，不是外推）；
- 归档自检：`tar -tzf … | grep -vc '/$'` → **27086**（与暂存文件数一致）；
  关键条目存在（`package.json`、`bin/rotate-preview-secrets.js`、
  `node_modules/next/dist/server/lib/start-server.js`、`node_modules/next/wasm/@next/swc-wasm-nodejs/package.json`）；
  被裁的四项在归档里**grep 不到**（无输出）；
- 因为输入相同 + 头里 `mtime=0`，重跑得到**同一个 SHA-256**（可作幂等键的稳定性证据）；
- **产物已在验证后删除**（`rm -f entry/src/main/resources/rawfile/pi-web.tar.gz*`）：
  它是构建产物，留着会让每次 `assembleHap` 都白带 80 MB。重建命令即上面那条。

### 1.3 tar 写入器的长名处理（⚠️ 过程中发现并修掉一个**静默改名**缺陷）

用一棵小树做往返测试（含「120 字符文件名放在长目录下」与「>255 字符全路径」）：

```bash
# 构造 + 打包 + 解包 + 逐条 diff（命令见下方「复现」小节）
```

- **修前**：`sub/xxxxx…(120 字符).txt` 被截成 100 字节 → 解包后文件名丢了 `.txt`
  （**归档静默损坏**，只会在用到时才暴露）。根因：`ustarHeader` 在「最后一个 `/` 处切开 + 截断到 100 字节」；
- **修后**：只允许**完整放得下**的 `prefix(155)/name(100)` 拆分，放不下就走 GNU `L` 长名条目
  （库侧 `tar-extract` 明确支持 `'L'`，契约 §3.7）；往返 diff 逐条一致、内容一致；
- 同一轮还修掉：`gz.once('error')` 每次 write 都挂 → 27k 个监听器（`MaxListenersExceededWarning`）。
  现在只挂一次（`assemble-payload.mjs:404`）。

---

## 2. Node 侧载荷（B）—— ✅ 语法/契约级，⬜ 真机端到端

```bash
for f in payload/env.js payload/pi-web-launch.js payload/extensions/*.js; do node --check "$f"; done
node -e "const e=require('./payload/env.js'); console.log(e.buildEnv({HOME:'/tmp/x'}))"
```

观测（`--check` 六个文件全部 OK；env 契约）：

```json
{"PI_OFFLINE":"1","PI_CODING_AGENT_DIR":"/tmp/x/pi-agent",
 "NO_PROXY":"127.0.0.1,localhost,::1","no_proxy":"127.0.0.1,localhost,::1",
 "PI_HOS_ROOTS":"[…4 个主目录…]","PI_WEB_SKIP_VERSION_CHECK":"1","PI_WEB_APP_NAME":"Pi Desktop",
 "PI_WEB_HOSTNAME":"127.0.0.1","PI_WEB_PORT":"0"}
```

- **刻意不含** `HOME`/`TMPDIR`/`TMP`/`TEMP`/`NODE_ENV`/`NODE_OPTIONS`（库的职责，见 `payload/env.js:19-24`）；
- 路线 ② 缺密码时**抛错**（不静默降级）：`node -e "…buildEnv({HOME:'/x'},{route:'lan'})"` →
  `PI_WEB_PASSWORD 缺失：路线 ②（局域网）必须由宿主应用生成强密码后再设置该变量` ✅
- `payload/config/{settings.json,mcp.json}` 与原文件逐字节一致（`cmp` 无差异）；
- 四个扩展与原文件**仅差文件头注释**（说明「为什么是 ESM —— pi 用 jiti 加载，改 CJS 属未验证改写」）。

⬜ 真机项（本会话无设备）：`pi-web-launch.js` 真起 Next、`/api/web-auth` 就绪、`app.log` 落盘、`pi-web.ready.json` 内容。

---

## 3. ArkTS 与 HAP 构建（C/C′/D）—— ✅

### 3.1 必须先重建库 HAR（否则编译必然失败）

```bash
cd /d/pi-workspace/pi-desktop-ark
export DEVECO_SDK_HOME='D:\oh-workspace\command-line-tools\sdk'
export PATH="/d/oh-workspace/DevEco Studio/tools/node:$PATH"
./scripts/build-bridge-har.sh          # → libs/@fellow99/node-bridge.har（473,238 B；BUILD SUCCESSFUL in 25 s）
cmd //c "D:\oh-workspace\command-line-tools\bin\ohpm.bat install --all"   # ⚠️ 必须！否则 oh_modules 还是旧 HAR
```

- 旧 HAR（21:35）**没有** `entry`/`readonlyRoot`/`archiveSha256`/`env`/`waitUntilRunning`/`logs`/
  `lastCrash`/`shutdown`/`getStage`/`getLastError`/`getPid` → 首次编译报 **27 个错误**（证据见下）；
- 重建 HAR 后**还要 `ohpm install --all`**：只换 `libs/` 里的 `.har` 不会更新 `oh_modules/` 的解包副本，
  编译仍然看到旧 API（实测踩到）。装完 `oh_modules/@fellow99/node-bridge/src/main/ets/runtime/*.d.ets`
  时间戳变为 00:19/00:20，编译随即通过。

**重建前的编译错误（原文第一条，供复核「确实是旧 API」）：**

```
ERROR: 10505001 ArkTS Compiler Error
Error Message: Type '{ entry: string; archive: string; archiveSha256: string; payloadRoot: string; flags: string; env: Record<string, string>; }'
is not assignable to type 'NodeRuntimeOptions'. Object literal may only specify known properties, and 'entry' does not exist in type 'NodeRuntimeOptions'.
At File: D:/pi-workspace/pi-desktop-ark/entry/src/main/ets/app/PiDesktopRuntime.ets:233:9
```

**重建后仍需修的 2 个真实类型错误（已修）：** `checkAccessTokenSync` 返回 `GrantStatus`（不是 boolean）且
形参类型是 `Permissions` 字面量联合 → 改为 `status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED`
+ `permission as Permissions`（`HostCapabilities.ets:143-148`）。

### 3.2 构建

```bash
cmd //c "D:\oh-workspace\command-line-tools\bin\hvigorw.bat assembleHap --mode module -p product=default -p buildMode=debug --no-daemon"
```

观测：

```
> hvigor Finished :entry:default@CompileArkTS... after 8 s 168 ms
> hvigor Finished :entry:default@SignHap... after 3 s 377 ms
> hvigor BUILD SUCCESSFUL in 27 s 161 ms
（WARN: 9 条，全部是 “Function may throw exceptions. Special handling is required.”，无 ERROR）
```

产物：

```
entry/build/default/outputs/default/entry-default-signed.hap    129,535,202 B
entry/build/default/outputs/default/entry-default-unsigned.hap  128,453,132 B
```

（对照 Phase 0：129,311,411 B ⇒ 本次新增约 **224 KB**：新 ArkTS 代码 + `error.html` + 重建后的 HAR。）

### 3.3 HAP 内容核对（**查 HAP，不查磁盘**）

```bash
python -c "import zipfile,json; z=zipfile.ZipFile('entry/build/default/outputs/default/entry-default-signed.hap'); …"
```

观测：

| 项 | 结果 |
|---|---|
| `launchType` | **singleton** ✅（本轮唯一的 `module.json5` 改动） |
| `requestPermissions` | **24** 项（**未改动**） |
| `definePermissions` | `LOCK_WINDOW_CURSOR`、`kernel.ALLOW_WRITABLE_CODE_MEMORY`（**未改动**） |
| `backgroundModes` | `["taskKeeping"]` |
| 新错误页 | `resources/rawfile/error.html` ✅ 在包内 |
| `resources/rawfile/selfcheck.js` | ✅ 在包内（Phase 0 回归路径仍在） |
| `resources/resfile/pi-web/` | 只有 `README.md`（载荷未投放，符合本次范围） |
| `.so` 压缩方式 | ⚠️ **`compress_type = 0`（STORED）**：`libnode.so`/`libnode_bridge.so`/`libc++_shared.so` 全部未压缩 |

> ⚠️ 最后一条**不在本次授权范围**（`module.json5` 只允许加 `launchType`，`build-profile.json5` 禁止改动）：
> 库规划 §5.10 要求 module 级 `compressNativeLibs: true` + `extractNativeLibs: true`，实测当前两者都缺席
> （HAP 的 `module.json` 里是 `None`）⇒ 129 MB 的 HAP 里有约 120 MB 未压缩。留给后续任务决定。

---

## 4. 本会话**无法**执行的部分（不要当作已完成）

| 项 | 原因 |
|---|---|
| 任何真机验证（安装/启动/`/facts`/`/log`/截图/返回键/外链/clearHistory/SSE） | **本会话没有设备**；不做任何设备侧结论 |
| 路线 ① 真实 `resfile/pi-web/` 投放后的 `require` 全链 | 需要先跑 `--apply`（约 700 MB 副本）+ 真机；
  本次只跑到 `--route tar` 的归档端到端 |
| 库的 `payload/host.js` 存在性 | 该文件由库侧并行实现，本会话观察时**尚不存在**；
  `pi-web-launch.js#registerShutdownHook` 已在找不到时**如实告警**而不是假装注册成功 |
| 库是否把本工程 `entry` 相对路径解析到 `readonlyRoot` | 冻结契约 §3.1 规定运行根决策 = 解包目录 → `readonlyRoot` → `payloadRoot`；
  本会话读到的库实现（`ohos-node-bridge/library/src/main/ets/runtime/NodeRuntime.ets:206`）用 `absoluteUnder(entryOpt, payloadRoot)`。已按契约传
  `entry='pi-web/pi-web-launch.js'` + `readonlyRoot`，**真机上若首次启动报入口找不到，首先复核这一处**（不是应用侧改动能解决的） |

---

## 5. 复现命令（可整段粘贴）

```bash
cd /d/pi-workspace/pi-desktop-ark
export DEVECO_SDK_HOME='D:\oh-workspace\command-line-tools\sdk'
export PATH="/d/oh-workspace/DevEco Studio/tools/node:$PATH"

# ① 载荷 dry run（只读路线）
node scripts/assemble-payload.mjs --route readonly

# ② 载荷 tar 路线（写盘；约 4 分钟；产物在 rawfile 下，验证完记得删）
node scripts/assemble-payload.mjs --route tar --apply --quiet
tar -tzf entry/src/main/resources/rawfile/pi-web.tar.gz | grep -vc '/$'      # 期望 27086
rm -f entry/src/main/resources/rawfile/pi-web.tar.gz*

# ③ Node 侧语法 + 契约
for f in payload/env.js payload/pi-web-launch.js payload/extensions/*.js; do node --check "$f"; done
node -e "const e=require('./payload/env.js'); console.log(e.buildEnv({HOME:'/tmp/x'}))"

# ④ tar 写入器长名往返（小树）
T="$PI_SCRATCH_DIR/tar-test"; rm -rf "$T"; mkdir -p "$T/sub/deep"
echo hello > "$T/a.txt"; dd if=/dev/zero of="$T/zeros.bin" bs=1024 count=64 2>/dev/null
echo longpath > "$T/sub/$(printf 'x%.0s' $(seq 1 120)).txt"
node scripts/assemble-payload.mjs --from "$T" --route tar --apply --quiet
X="$PI_SCRATCH_DIR/tar-out"; rm -rf "$X"; mkdir -p "$X"
tar -xzf entry/src/main/resources/rawfile/pi-web.tar.gz -C "$X"
diff <(cd "$X" && find . -type f | sort) <(cd "$T" && find . -type f | sort)   # 期望无差异
rm -rf "$T" "$X" entry/src/main/resources/rawfile/pi-web.tar.gz*

# ⑤ HAR + HAP
./scripts/build-bridge-har.sh
cmd //c "D:\oh-workspace\command-line-tools\bin\ohpm.bat install --all"        # 必须
cmd //c "D:\oh-workspace\command-line-tools\bin\hvigorw.bat assembleHap --mode module -p product=default -p buildMode=debug --no-daemon"
```

---

## 6. 修复轮 F1–F5（2026-10-17，同一会话）—— ✅ 本机可验证项全过

> 契约修订（本轮依据）：`scriptPath` = `node::Start` **实际执行的脚本**；`entry` = 应用入口，
> 经 `NODE_BRIDGE_ENTRY` 由库 bootstrap 按运行根解析。库 `payload/`（`bootstrap.js` / `host.js` /
> `lib/tar-extract.js`）**不在 HAR 里** ⇒ 本轮由应用自己投放（F4）。

### 6.1 F1/F2 载荷文案与行为（本机）

```bash
for f in payload/env.js payload/pi-web-launch.js payload/extensions/harmony-runtime.js payload/extensions/harmony-workspace-roots.js; do node --check "$f"; done
node -e "const e=require('./payload/env.js'); /* 断言见下表 */"
```

`node --check` 四件全 OK（node v24.7.0；两个扩展是 ESM，Node 自动探测通过）。断言观测：

| 断言 | 结果 |
|---|---|
| loopback 键集 | `NO_PROXY,PI_CODING_AGENT_DIR,PI_HOS_ROOTS,PI_OFFLINE,PI_WEB_APP_NAME,PI_WEB_HOSTNAME,PI_WEB_PORT,PI_WEB_SKIP_VERSION_CHECK,no_proxy`（**9 键，与改动前一致**） |
| `PI_HOS_ROOTS` 兜底标记（F2） | 四项全部带 `"fallback": true`（机器可读） |
| 继承的真清单 | 原样保留、**不带** fallback 标记 |
| lan 路线缺 `lanIp` | **抛错** `PI_WEB_HOSTNAME 缺失且 lanIp 不可用（未给/空串）：路线 ②（局域网）必须给出具体网卡地址；0.0.0.0 会绑到所有网卡，已拒绝` |
| lan 路线 `lanIp=0.0.0.0` | **抛错**（同上，`= 0.0.0.0`） |
| lan 路线 `lanIp=192.168.1.50` | `PI_WEB_HOSTNAME=192.168.1.50`；键集 10（多 `PI_WEB_PASSWORD`） |
| lan 路线显式 `PI_WEB_HOSTNAME=mybox.local` | 原样采用（不要求 `lanIp`） |

文案修正：`request-auth.ts` → `pi-web/lib/request-security.ts:90-102`（`payload/env.js` 与
`payload/pi-web-launch.js:511`）；`harmony-runtime` 报告行 → `… ｜ 应用进程内（库 dlopen 托管，无子进程）`；
`harmony-workspace-roots`：桥读不到时报 `不可判定（桥不可达：Phase 1 库传输层未接线）`，沙箱根改 `<filesDir>/workspace`。

### 6.2 F4 装配脚本 + 引导器投放（本机）

```bash
node scripts/assemble-payload.mjs --route readonly --apply --force --out "$PI_SCRATCH_DIR/ro-out" --json "$PI_SCRATCH_DIR/ro-report.json" --quiet
node scripts/assemble-payload.mjs --route tar --apply --force --out "$PI_SCRATCH_DIR/tar-stage" --keep-staging --quiet
tar -tzf entry/src/main/resources/rawfile/pi-web.tar.gz | grep -E '(^|/)(bootstrap\.js|host\.js|lib/tar-extract\.js)$'
```

观测：

- 路线 ①：输出目录里 `bootstrap.js`（17044 B）/ `host.js`（7301 B）/ `lib/tar-extract.js`（13370 B）**都在**；
  `ro-report.json#target.bridgeStaged = ["bootstrap.js","host.js","lib/tar-extract.js"]`、`bootstrapPresent=true`；
  ⚠️ `entryPresent=false` —— `pi-dist` 本身不含 `pi-web-launch.js`（应用载荷覆盖层仍未投放，既有缺口，不在本轮范围）。
- 路线 ②：三件在**打 tar 之前**进暂存树 ⇒ `tar -tzf` 命中 `bootstrap.js` / `host.js` / `lib/tar-extract.js`（3 条）；
  归档 84,489,078 B，sha256 `e0de051af00c…`。
- rawfile 投放（默认开）：`entry/src/main/resources/rawfile/{bootstrap.js,host.js,lib/tar-extract.js}`；
  验证后已删 `rawfile/pi-web.tar.gz*`（不随包）。

### 6.3 HAR 重建 + 依赖刷入（必须）

```bash
./scripts/build-bridge-har.sh                                   # BUILD SUCCESSFUL in 22 s；HAR 474,012 B
cmd //c "D:\oh-workspace\command-line-tools\bin\ohpm.bat install --all"   # install completed
```

### 6.4 HAP 构建 + 产物核对（**查 HAP，不查磁盘**）

```bash
cmd //c "D:\oh-workspace\command-line-tools\bin\hvigorw.bat assembleHap --mode module -p product=default -p buildMode=debug --no-daemon"
python -c "import zipfile,json; z=zipfile.ZipFile('entry/build/default/outputs/default/entry-default-signed.hap'); …"
```

`BUILD SUCCESSFUL in 28 s 984 ms`（仅既有的 ArkTS `Function may throw exceptions` WARN）。

| 项 | 结果 |
|---|---|
| `entry-default-signed.hap` | **46,022,785 B**（上一轮 129,535,202 B ⇒ **−64.5%**） |
| `launchType` | `singleton` ✅ |
| `requestPermissions` | **24**（未变） ✅ |
| `definePermissions` | **2**：`LOCK_WINDOW_CURSOR`、`kernel.ALLOW_WRITABLE_CODE_MEMORY`（未变） ✅ |
| `compressNativeLibs` / `extractNativeLibs` | `true` / `true`（module 级生效，schema 未拒绝） |
| `.so` 压缩（F5） | `libc++_shared.so`=8、`libnode.so`=8（126,809,264 → 45,115,605 B）、`libnode_bridge.so`=8 ⇒ **全部 DEFLATE** |
| rawfile | `error.html` ✅、`selfcheck.js` ✅、`bootstrap.js` ✅、`host.js` ✅、`lib/tar-extract.js` ✅；`pi-web.tar.gz` 不在包内（已清） |
| resfile | 仅 `pi-web/README.md`（载荷未投放，与既有范围一致） |

### 6.5 本会话仍**无法**验证的（不当作已完成）

| 项 | 原因 |
|---|---|
| 真机三路线端到端（`[bootstrap] entry=…`、解包跳过判定、端口读回、截图） | 本会话**没有设备** |
| 路线 ① 真实布局 `resfile/pi-web/{pi-web-launch.js,bootstrap.js,host.js,lib/…}` | `pi-dist` 不含应用侧载荷 ⇒ 装配产物 `entryPresent=false`；需先有载荷覆盖层 |
| 路线 ② 归档内 `entry='pi-web/pi-web-launch.js'` 的解析 | 归档根目前 = `pi-dist` 内容（**没有 `pi-web/` 这一层**，也不含 `pi-web-launch.js`）：要跑通，装配需把应用载荷放进 `pi-web/` 层。本轮按契约指定形状传参并如实记录该依赖，未私自改布局 |

---

## 7. 载荷打包重构 + 真机验证（2026-10-17，第三轮；requirement 000-scaffold）

> 目标：把 `pi-desktop-ark` 的载荷打包改成**与已跑通的 `pi-desktop-hos` 同形**，并在真机
> （HAD-W32 / API 26 / 序列号 `3QC0226526001227`）上端到端验一遍。
>
> 对齐基线：`pi-desktop-hos/scripts/collect-pi.mjs:7`（ustar 归档理由）、`:431-471`（打包 + sha256）、
> `collect-app.mjs:5-14,76-86`（投放到 **resfile**，不是 rawfile）、`prepare-next.mjs:29-31,262-268,287-298`、
> `src-main/main.js:40-45`（resfile 里的 tar 可被 Node 直读）、`:502-543`（sha256 marker 幂等）。

### 7.1 P0 载荷路线重做（代码）

| 位置 | 改动 |
|---|---|
| `entry/src/main/ets/common/Constants.ets:35-51` | 删 `ARCHIVE_RAWFILE` / `ARCHIVE_SHA256_RAWFILE` / `ARCHIVE_STAGED_NAME` / `BRIDGE_TAR_EXTRACT_RAWFILE` / `BRIDGE_RAWFILES` / `rawfileDirFromResourceDir()`；新增 `ARCHIVE_REL='pi-web/pi-web.tar.gz'`、`ARCHIVE_VERSION_REL='pi-web/pi-web.version'`（**相对 `context.resourceDir`**） |
| `entry/src/main/ets/app/PiDesktopRuntime.ets:382-417` | 路线 ② 判据改为 **resfile 上的真实 `fs` 检查**（`readonlyRoot + '/pi-web/pi-web.tar.gz'`）；`scriptPath=readonlyRoot+'/pi-web/bootstrap.js'`、`entry='pi-web/pi-web-launch.js'`、`archive`/`archiveSha256` 直接取 resfile 里的归档与 `pi-web.version`、`payloadRoot=<filesDir>/payload`；**不再做任何物化搬运** |
| 同文件 | 删除 `rawfileExists()` / `materializeBridge()` / `materializeRawArchive()` / `utf8()`；`materializeRawfile()` 仅保留给 SELFCHECK（`selfcheck.js` 走 `$rawfile` → resourceManager） |
| 同文件 `invalidateReadyMarker()` | 投递前作废上一轮 `payload/pi-web.ready.json`（修「重启读到旧端口」） |
| 同文件 `logsToTextSince(runtime,200,launchStartedAt)` | 端口回退解析**只认本轮日志行**（`entry.at >= launchStartedAt`），`at=0` 的行保留（修「读到上一轮 PI_WEB_READY」） |
| `.gitignore` | 只保留 `entry/src/main/resources/resfile/pi-web/`（整目录派生：归档 + version + 引导器三件）；删掉 rawfile 的派生条目 |

### 7.2 P1 脚本成为唯一事实源

```bash
cd /d/pi-workspace/pi-desktop-ark
NODE18="/d/oh-workspace/DevEco Studio/tools/node/node.exe"   # v18.20.1（文档化流程里 PATH 首位就是它）
"$NODE18" scripts/assemble-payload.mjs --quiet          # dry run
"$NODE18" scripts/assemble-payload.mjs --apply --quiet  # 裁剪 + 打包 + 投放 resfile
```

观测（两次独立 `--apply`，间隔约 16 min）：

| 项 | 第一次 | 第二次 |
|---|---|---|
| 计划（dry run，与实测一致） | 142 文件 / 509,987,689 B → 27,090 文件 / 374,179,678 B | 同 |
| 暂存实测 | **27,090 文件 / 374,179,678 B** | 同 |
| 裁剪实测 | **79 文件 + 2 个整目录 / 454,288,178 B** | 同 |
| 归档 | `resfile/pi-web/pi-web.tar.gz` **84,538,840 B** | 同 |
| SHA-256 | `e1db33d73a20574d79276082c74e0ecec802fb80e2fe466efd1267050a1a47ef` | **同**（`cmp` 逐字节相同） |
| `pi-web.version` | 65 B，首行即上面那串 | 同 |
| 归档自检 | 27,101 文件条目 / 2,708 目录条目 / 0 个 GNU 长名 / 结束块在位 | 同 |
| 耗时 | 15 m 02 s | 16 m 15 s（≈380 MB 复制 + gzip -9） |

- **裁剪真的生效了**：上一轮 dry run 报 142 却复制了 27,232 文件 —— 根因是 Node 18 给 `fs.cp` 的
  `filter(src)` 带 `\\?\` 前缀（`stripLongPathPrefix()` 已修），且计划里排除了「父目录被整目录裁掉」的
  文件（本轮改成逐文件判定，计划与实测差额从 4 个文件变 0）。`assertCropApplied()` 现在直接用
  `crop-rules.mjs` 的 `ruleMatchesFile` 遍历产物：零被裁项 + WASM SWC 在位 + `@next/env` 在位 +
  undici/`@earendil-works` 未被误伤，四类断言全过。
- 裁剪规则升级（`scripts/crop-rules.mjs`，每条带 `evidence` / `planRef` / **`prepareRef`**）：
  `next-nft-json` · `next-swc-win32` · `next-swc-native`（keep `node_modules/next/wasm/**`）· `img-sharp` ·
  `tailwind-oxide` · `node-pty-prebuilds` · `node-pty` · `platform-native`
  （`node_modules/**/*.node` + `KEEP_PATH_MARKERS=['linux-arm64','arm64','ohos']` + 跳过
  `undici`/`web-push`/`@earendil-works`）。本机命中：76+3+20+0+10+33+0 = 142 文件。
- 应用载荷覆盖层（8 文件）已进归档与 resfile；归档内 entry = `pi-web/pi-web-launch.js`
  （`entryPresent=true`）。

### 7.3 真机验证（HAD-W32 / API 26 / `3QC0226526001227`）

```bash
export DEVECO_SDK_HOME='D:\oh-workspace\command-line-tools\sdk'
export PATH="/d/oh-workspace/command-line-tools/bin:/d/oh-workspace/DevEco Studio/tools/node:$PATH"
cmd //c "D:\oh-workspace\command-line-tools\bin\hvigorw.bat assembleHap --mode module -p product=default -p buildMode=debug --no-daemon"
# BUILD SUCCESSFUL in 28 s 965 ms（仅既有 ArkTS WARN「Function may throw exceptions」）

HDC="/d/oh-workspace/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe"
"$HDC" uninstall org.fellow99.pi.PiDesktopArk
"$HDC" install -r entry/build/default/outputs/default/entry-default-signed.hap
"$HDC" shell "aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk"
```

**① HAP 产物**（`.hap` 是 zip，用 python `zipfile` 查，不查磁盘）：

| 项 | 值 |
|---|---|
| `entry-default-signed.hap` | **130,566,051 B**（上一轮 46,022,785 B；+84 MB 即归档本体） |
| resfile 条目 | `resources/resfile/pi-web/{bootstrap.js, host.js, lib/tar-extract.js, pi-web.tar.gz(84,538,840 B, **stored**), pi-web.version(65 B)}` |
| rawfile 条目 | 仅 `boot.html` / `error.html` / `selfcheck.js`（**归档与引导器三件已不在 rawfile**） |

**② 首启（uninstall → install → start）：路线 ② 命中、无 Cpp Crash、进程存活**

```bash
BASE=/data/app/el2/100/base/org.fellow99.pi.PiDesktopArk/haps/entry/files
"$HDC" shell "ls $BASE/payload"     # app.log  e1db33d73a20  node.log  pi-web.ready.json
"$HDC" shell "grep -nE 'bootstrap|archive=|extracted|runRoot|entry=' $BASE/payload/node.log | head -20"
```

```
5:  [node_bridge] env NODE_BRIDGE_ARCHIVE=/data/storage/el1/bundle/entry/resources/resfile/pi-web/pi-web.tar.gz
6:  [node_bridge] env NODE_BRIDGE_ARCHIVE_SHA256=e1db33d73a20574d79276082c74e0ecec802fb80e2fe466efd1267050a1a47ef
7:  [node_bridge] env NODE_BRIDGE_READONLY_ROOT=/data/storage/el1/bundle/entry/resources/resfile
24: [node_bridge] argv[2]=/data/storage/el1/bundle/entry/resources/resfile/pi-web/bootstrap.js
28: [bootstrap] node=v24.2.0 platform=openharmony arch=arm64 modules=137
30: [bootstrap] archive=/data/storage/el1/bundle/entry/resources/resfile/pi-web/pi-web.tar.gz sha256=e1db33d7…47ef
31: [bootstrap] extracted dir=…/payload/e1db33d73a20 files=27101 dirs=2708 bytes=374317294 skipped=0 ms=6434 marker=…/.ready-e1db33d73a20
32: [bootstrap] runRoot=…/payload/e1db33d73a20 route=archive
47: [bootstrap] entry=…/payload/e1db33d73a20/pi-web/pi-web-launch.js mode=cjs root=… cwd=…/pi-web
```

- **首启解包成本：6,434 ms**（27,101 文件 / 374,317,294 B，`skipped=0`）。
- `payload/app.log` **存在**（3,220 B）：`[ready] 第 1 次探测通过：GET /api/web-auth → 200
  {"enabled":false,"authenticated":true}`、`PI_WEB_READY {"port":40477,…,"elapsedMs":943}`、
  `已向宿主桥注册 shutdown 钩子（…/resfile/pi-web/host.js…）`。
- `pidof` = 56366（存活）；`hilog -x | grep -c 'Cpp Crash'` = **0**。

**③ 真实服务（`hdc fport` + `curl`）**

```
GET /api/web-auth → HTTP/1.1 200 OK … {"enabled":false,"authenticated":true}
GET /            → HTTP/1.1 200 OK, Content-Length: 10677
                   <!DOCTYPE html><html lang="en" translate="no" class="__variable_9e44ca notranslate"><head>
                   <meta charSet="utf-8"/>…<link rel="stylesheet" href="/_next/static/css/9bcd6051db4f8890.css"…
                   <title>Pi Desktop</title>
```

（全文存 `docs/evidence/2026-10-17-pi-web-index.html`）

**④ 退出判据：第二次启动必须是 skip**

```
81:  [bootstrap] payload ready (skip)
84:  [bootstrap] runRoot=…/payload/e1db33d73a20 route=archive
     marker=.ready-e1db33d73a20 → {"sha256":"e1db33d7…47ef","files":27101,"bytes":374317294,"skipped":0,"at":1792206508049}
```

`grep -c 'extracted dir=' node.log` 保持 **1**（没有第二次解包）；首启端口 40477 → 第二次 46619。

**⑤ UI（`snapshot_display` + `hdc file recv` + `uitest dumpLayout`）**

`uitest dumpLayout -p …` **本机可用**。第 5 次启动（端口 36283）的可见文本：

```
"running" / "阶段：就绪：http://127.0.0.1:36283/" / "已加载本地服务页面：http://127.0.0.1:36283/"
"Pi Desktop，版本：web 0.12.1，pi 1.2.0"
"新建" "搜索对话" "会话" "未找到会话" "打开其他项目…"
"文件" "文件操作" "当前平台不支持" "将文件上传到项目根目录" "0 个变更文件" "搜索文件"
"项目和 worktree" "选择项目…" "模型" "技能" "设置" "开始使用"
"1.从侧边栏选择项目目录\n2.打开底部的“设置”，然后选择“模型”"
```

⇒ ArkWeb 里是**真的 pi-web UI**（会话列表 + 文件面板 + 设置入口；新装无会话，所以是
「未找到会话 / 开始使用」），不是 `boot.html`。截图：`docs/evidence/2026-10-17-pi-web-ui-ready.jpeg`。

**本轮修掉的两个真机缺陷**

| 现象（实测原文） | 根因 | 修法 |
|---|---|---|
| 重启后 UI `FAILED: 探活失败：connect: Failed to connect to the server @ http://127.0.0.1:40477/（端口来自 marker）`，本轮真实端口 46619 | 上一轮的 `pi-web.ready.json` 还在盘上，ArkTS 在**新服务就绪前**就读到旧端口 | `PiDesktopRuntime.invalidateReadyMarker()`：投递前删除 marker |
| 再启动变成 `… :46619（端口来自 log:PI_WEB_READY）`，本轮真实端口 44031 | 库的 `logs()` 读 `node.log` **尾部**，该文件跨启动累积，端口回退解析读到了上一轮的 `PI_WEB_READY` | `logsToTextSince(…, launchStartedAt)`：只认本轮的行（`at=0` 的行保留） |

### 7.4 仍未验证 / 已知边界（不当已完成）

| 项 | 状态 |
|---|---|
| `.nft.json`（76 文件 / 348 MB）可删性的真机长跑（规划 O1） | 本轮「起服务 + 首页 200 + 会话/设置 UI 全在」已通过，但**没跑**完整会话链路（发消息 → SSE → 工具调用） |
| `@img/sharp-*` 删除后 `next/image` 的服务端优化路径（`images.unoptimized` 由上游产物决定） | 未触发图片优化路由；未逐包核对 |
| WASM SWC 端上是否真的被使用（O2） | 启动日志里没有 SWC 相关失败，但也没有「使用 WASM SWC」的实证打印 |
| `hilog -x \| grep PI_DESKTOP_ARK` | 本机为 **0 行**（ArkTS 侧 hilog 未进缓冲区/被轮转）⇒ ArkTS 侧证据改用 `uitest dumpLayout` 的结构化文本 |
| `hdc shell rm -rf <filesDir>/payload` | 权限不足（`Permission denied`）：清态只能用 `bm uninstall` + 重新 install |
| 路线 ①（整树投放 resfile） | 仍**不发**：会把 27,090 文件塞进 resfile（hvigor 会拖死）；脚本保留该分支仅作诊断 |

---

# 轮次 4（2026-10-17 · **真机** HAD-W24 / 7.0.0.107(SP7C00E100R13P5) / API 26 / OpenHarmony-7.0.0.105）

> 本轮全部结论都来自真机观测；命令与输出逐条给出。设备序列号 `3QC0226526001227`。
> 构建：`hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon` → **BUILD SUCCESSFUL**（0 ArkTS error）。

## R4.1 P0 —— `POST /api/agent/new` 带 toolNames 即 SIGSYS 打死进程（**已修**）

复现（修前，port 来自 `<base>/payload/pi-web.ready.json`）：

```bash
curl -s -X POST http://127.0.0.1:18457/api/agent/new -H 'Content-Type: application/json' \
  -d '{"cwd":"/data/storage/el2/base/haps/entry/files/pi-cwd/20261017","type":"ensure_session","toolNames":[]}'
# → HTTP 200 {"success":true,"sessionId":"01a14827-…"}
curl -s … -d '…"toolNames":["read","write"]}'
# → curl: (56) Empty reply; HTTP=000；随后 /api/web-auth = 000（进程已死）
```

故障块（`hilog -x`，原样引用）：

```
Reason:Signal:SIGSYS(SI_USER)from:11038:20020220
Fault thread info:
Tid:11038, Name:pi.PiDesktopArk
#00 pc 00000000001e06cc /system/lib/ld-musl-aarch64.so.1(__syscall_cp+112)
#01 pc 000000000017c588 /system/lib/ld-musl-aarch64.so.1(epoll_wait+52)
#02 pc 000000000001a93c /system/lib64/chipset-sdk-sp/libeventhandler.z.so(OHOS::AppExecFwk::EpollIoWaiter::WaitFor…)
C02C11/appspawn/APPSPAWN: [appspawn_service.c:140]org.fellow99.pi.PiDesktopArk with pid 11038 exit with signal:31
```

定位（真机数据，不是推断）：修前 `<base>/payload/node.log` 里**没有任何** `SIGSYS` 诊断行（`grep -c 'SIGSYS unclassified'` = 0），
说明 shim 的 handler 当时**不在信号路径上**（处置已被 libuv 的 `uv_signal_start(SIGSYS)` 顶掉 —— 载荷里 `signal-exit`
会注册 `process.on('SIGSYS')`）；`SI_USER` 说明打死进程的那一发是**进程自己 `kill()` 出来的**（`signal-exit` 的补发），
不是内核 seccomp 直接投递。修后同一请求，node.log 捕到真正的 seccomp 陷阱：

```
sys 1792212875541 [node_bridge] SIGSYS seccomp syscall=425 arch=0xc00000b7 call_addr=0x59b6b2fe4c pc=… at=svc-4
```

`425 = io_uring_setup`、`0xC00000B7 = AUDIT_ARCH_AARCH64`（`SIGSYS seccomp` 行只在 `si_code == SYS_SECCOMP` 时打印）。

修法（`ohos-node-bridge/library/src/main/cpp/node_bridge.c`，commit `b1e61f6`）：
handler 按 `si_code` 分流（只有 `SYS_SECCOMP` 才仿真；其它来源记现场后恢复 `SIG_DFL` + re-raise），
siginfo 按内核 ABI 固定偏移读取，新增监视线程在处置被顶掉时留档并装回。

**反证实验**（同一次真机轮次，意外得到的对照）：把仿真分支临时关掉的那次构建上，同一请求立刻复现死亡，
且 node.log 正是 `SIGSYS seccomp syscall=425 … -> restore-default` ⇒ **崩溃点是工具路径上的 seccomp 陷阱，我们的 shim 在信号路径上（不是旁观者）**。
（该诊断开关实现有缺陷，**已整体删除**，不留在产品代码里。）

修后验证（port 35905）：

```
POST /api/agent/new {"toolNames":["read","write"]}  → 200 {"success":true,"sessionId":"01a14839-2db5-…"}
POST /api/agent/new {"type":"prompt", …}            → 200 {"sessionId":"01a14839-2f21-…"}
GET  /api/agent/01a14839-2f21-…/events (SSE)        → data:{"type":"connected",…,"isStreaming":true} …
                                                      data:{"type":"message_start",…} / text_delta:"done" / message_end
POST /api/agent/new {"toolNames":[]}（无工具回归）   → 200 {"sessionId":"01a14839-2fe6-…"}
curl /api/web-auth                                  → 200
模型真的用了 write 工具：files/workspace/final-proof.txt = "P0 FINAL OK"（11 B）
hilog 'Cpp Crash' 计数（本轮启动后）                = 0
```

## R4.2 P1a —— 声明的沙箱根建不出来（**已修**）

修前：`GET /api/cwd/browse?root=sandbox` → `{"error":"Directory does not exist","code":"ENOENT","rootId":"sandbox"}`；
`POST /api/cwd/browse`（代建）→ `Parent path is outside the declared workspace roots`。
修法：`PiDesktopRuntime.launchInternal` 在投递 Node 之前 `ensureDeclaredRoots()`（`ensureDirStrict` 幂等创建，
失败逐条 `Log.error` 并汇总进诊断串 `workspaceRoots`）。commit `f064878`。

修后（真机）：

```
ls -ld files/workspace            → drwxrwx--- 2 20020220 20020220 … 2026-10-17 12:47 …/files/workspace
GET /api/cwd/browse?root=sandbox  → 200 {"rootId":"sandbox","rootPath":"…/files/workspace","directories":[],"truncated":false,…}
POST /api/cwd/browse {path:"…/files/workspace",name:"probe-dir"}
                                  → 200 {"success":true,"path":"…/files/workspace/probe-dir"}
ls -la files/workspace            → probe-dir/  final-proof.txt  p0-proof.txt
```

## R4.3 P2 —— 终端/PTY 以「能力」上报（应用侧已做，**上游 API 未改**）

`CAP_TERMINAL_SUPPORTED=false` + `CAP_TERMINAL_REASON`（`common/Constants.ets`）→
`HostCapabilities.capabilitiesJson()`（`runtime.facts` 的 `capabilities` 字段）+ 诊断串 `capabilities` +
启动日志 `能力：…` + 首页橙色提示行。已确认字符串进了装机的 `ets/modules.abc`：
`本平台没有 PTY 设备节点：/proc/mounts 的 325 条里没有 devpts，/dev 是 devfs，…`。
⚠️ **未做**：`/api/terminal`（上游 pi-web 路由）仍抛 `Cannot load the node-pty native terminal module for openharmony-arm64`
→ 本轮**没有**把该路由改成结构化 501（pi-web 是钉住的上游子模块，不在本轮提交范围；改用 payload 覆盖层需重建 84 MB 归档并让设备重解包）。

## R4.4 平台探针（本轮实测，供能力清单 REV-2 引用）

```
param get const.product.name                → HUAWEI MateBook Pro
param get const.product.software.version    → HAD-W24 7.0.0.107(SP7C00E100R13P5)
param get const.ohos.apiversion             → 26
param get const.ohos.fullname               → OpenHarmony-7.0.0.105
uname -a → HarmonyOS localhost HongMeng Kernel 1.13.0 … aarch64 Toybox ; nproc → 20 ; MemTotal → 32680024 kB
wc -l < /proc/mounts → 325 ; grep -c devpts /proc/mounts → 0 ; grep ' /dev ' → devfs /dev devfs rw,relatime,hmmac=genfs,seclabel 0 0
stat /dev/ptmx → Permission denied (rc=1)
cd /data/local/tmp/symtest && ln -s a.txt sym.txt → ln_rc=0 ; ls -l → sym.txt -> a.txt
ln -s a /data/storage/el2/base/b → Read-only file system
ln -s a /storage/Users/currentUser/sym.txt → No such file or directory
sh -c 'exit 7' → rc=7 ; sh -c 'kill -11 $$' → Signal 11 (core dumped) rc=139 ; sh -c 'kill -31 $$' → Signal 31 (core dumped) rc=159
sh -c 'kill -SYS $$' → Signal 31 (core dumped) rc=159（**不需要 seccomp**）
sh -c 'sleep 1 &' → 2 s / 15 s 采样 ps -ef 僵尸数 0 / 0（全表 265 进程）
```

## R4.5 本轮**未验证 / 已知缺口**

1. **P2 的上游 API 面**：`/api/terminal` 仍是 500 + 模块加载错误（见 R4.3）。
2. **`Log.info('能力：…')` 没有在 hilog 里取到**（缓冲区被 CEF 日志刷掉；`hilog -x | grep D0033` 为空）。
   能力串已确认在 `ets/modules.abc` 里，但**没有**拿到运行期 hilog 行作为证据。
3. **P0 的精确机制仍有未解释的一环**：修前那次为什么 handler 不在路径上（libuv 顶掉 vs 其它），
   本轮**没有**取到「处置被外部改写」的日志行（修后也没有）——因为修前无日志、修后未触发。
   已确证的是「seccomp 陷阱在工具路径上，仿真与否决定生死」（R4.1 的反证实验）。
4. **#16 的 L1 面**仍缺应用域 `grantpt`/`openpty` 实测（REV-2 只给反证）。
