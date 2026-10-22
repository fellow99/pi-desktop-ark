/**
 * BuildConfig —— **编译期**运行配置（本工程唯一的形态开关）。
 *
 * 2026-10-20 产品决策：**运行期不做任何形态切换**。`--jitless` 是进程级形态，运行期切换意味着
 * 「先按 jit 起来、崩了再退」这类不可控路径；而进程内 Node（`node::Start`）每进程只能起一次、
 * 失败即终态（`@fellow99/node-bridge` 运行时契约 §2.6），一次误判就是整机不可用。因此：
 *
 *   · 形态 = **构建期常量**（本文件的 `NODE_MODE`），改它就是「出另一个变体」，重新编译即生效；
 *   · 运行期**没有**调试参数、没有设置项、没有 ACL 探测参与决策（见 `common/NodeMode.ets`）；
 *   · 默认 `compat`：所有 `deviceTypes`（2in1 / tablet / phone / tv）默认都按 `--jitless` 跑。
 *
 * 为什么默认 compat 而不是 jit（实测依据，详见 `docs/ACL-无ACL评估.md` §10）：
 *   手机 `JUY-AL80`（API 26）上 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 查询结果为
 *   **已授予**，但按 jit 启动后进程在 `libnode_bridge` 内 **SIGTRAP(TRAP_BRKPT)** 秒崩；
 *   同一 HAP 改 compat 则 1.6 s 正常就绪。⇒ 权限位不能作为 JIT 可用性的预检，
 *   且代价不对称：jit 误判 = 应用不可用；compat 代价 = 7–10× 慢（功能完整，仅 code-mode 不可用）。
 *
 * 出 jit 变体的做法：把下面改成 `'jit'` 后重新构建（建议同时在 `AppScope/app.json5` 里区分版本号/渠道）。
 */
export const NODE_MODE: string = 'compat';
