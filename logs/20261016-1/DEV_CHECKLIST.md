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
