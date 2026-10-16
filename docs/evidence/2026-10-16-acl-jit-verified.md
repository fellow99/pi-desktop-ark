# 真机验证：ACL 生效（JIT 可用）—— 2026-10-16

- **设备**：HAD-W32 / HarmonyOS 6.1.0 / API 26 / arm64-v8a（`3QC0226526001227`）
- **应用**：`org.fellow99.pi.PiDesktopArk` v0.1.0（DevEco 调试签名，Profile 含 3 项 ACL）
- **构建**：`entry-default-signed.hap`（129,347,874 B），内含 `libnode.so`（SHA-256 = `runtime.lock.json`）、`libnode_bridge.so`（来自 `@fellow99/node-bridge` HAR）

## 1. 怎么跑出来的

```bash
# ① 设备侧确保 15577 空闲（探针 App 会占它，见 §3）
hdc shell "aa force-stop org.fellow99.test.NodeProbe"
# ② 启动（**不带 --jitless** ⇒ 走 JIT 路径，需要 ACL）
hdc shell "aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk --ps probeFlags '--no-verify-heap'"
# ③ 取证
hdc fport tcp:15577 tcp:15577
curl -s http://127.0.0.1:15577/facts
curl -s http://127.0.0.1:15577/log      # node.log 尾部
```

## 2. 结果（`/facts` 原样）

```json
{
  "node": "v24.2.0",
  "platform": "openharmony",
  "arch": "arm64",
  "execArgv": ["--no-verify-heap"],
  "versions": {"v8": "13.6.233.10-node.17", "uv": "1.51.0", "modules": "137", "napi": "10", "undici": "7.10.0", "openssl": "3.0.16"},
  "wasm.available": true,
  "wasm.validate": true,
  "hotloop_ms_2e6": 9,
  "homedir": "/data/storage/el2/base/haps/entry/files",
  "tmpdir": "/data/storage/el2/base/haps/entry/files/tmp",
  "netifaces": ["lo", "wlan0", "ancowlan0"],
  "cpus": 0
}
```

| 判据 | 结果 |
| --- | --- |
| 进程内 Node 起来 | ✅ `node v24.2.0` / `platform openharmony` / `modules 137` |
| **JIT 生效（ACL 生效）** | ✅ `wasm.available = true`、`wasm.validate = true`（`--jitless` 下这两项会缺失/报 `WebAssembly is not defined`） |
| 性能 | ✅ 热循环 **6–9 ms / 2e6 次**；同型解释器基线按探针 `--jitless` 的 296 ms/5 轮折算约 **59 ms/2e6** ⇒ **约 7–10×** |
| 崩溃 | ✅ 本轮 `hilog` 中 `Cpp Crash` **0 条**，应用进程（含 ArkWeb `:gpu`/`:render`）稳定存活 |
| HAP 内 `module.json` | ✅ 24 项 requestPermissions + 2 项 definePermissions + `backgroundModes:["taskKeeping"]`（与 `pi-desktop-hos` 完全一致） |

## 3. 对照：两次失败（都已定位）

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| `hdc install` 报 `code:9568289 / PermissionName: ohos.permission.READ_PASTEBOARD` | 当时调试 Profile **不含任何权限项**（声明面有了、授权面没有） | 重新生成含 ACL 的 Profile 后**装机成功**（见 `docs/ACL配置.md` §2） |
| 启动即 `Cpp Crash`（进程消失，栈里有 `libnode_bridge.so`） | **15577 被探针 App 占着**：载荷 `server.listen()` 抛 `EADDRINUSE` → 进程内 Node 的未捕获异常 → 整个 App 进程 abort（无优雅退出路径） | 停掉占用者后同一构建完全正常；设计含义见 §4 |

## 4. 由此确认的两条设计规则

1. **端口必须随机（或先探测空闲）+ 单实例**（工程规划 §5.10 ⑫）：进程内 Node 里一个端口冲突就能把整个 App 带走。
2. **载荷必须自装 `uncaughtException` / `unhandledRejection` 兜底**并把错误写进自己的日志（`payload/app.log`），而不是靠 stdout —— 否则任何未捕获异常都是「应用级事故」。

## 5. 顺带发现的日志噪声（Phase 1 待处理）

`node_bridge.c` 用 `dup2` 把进程的 fd1/fd2 指向 `node.log`，于是 **ArkWeb/Chromium 的原生输出也写进了同一份文件**
（`/log` 返回的 16 KB 里大部分是 `arkweb/chromium_ext/...` 行）。桥自己的 `[node_bridge] …` 行仍在文件里，只是被淹没。
处置方向（§5.10 ⑤）：改成「1 MB pipe + 独立 reader 线程排空 + 只把 Node 侧内容写入 `node.log`」，
载荷侧另写结构化日志；本次不影响 JIT 结论。
