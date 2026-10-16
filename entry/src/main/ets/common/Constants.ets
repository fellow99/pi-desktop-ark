import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0xD0033;
const TAG = 'PI_DESKTOP_ARK';

/**
 * 与 `pi-web` / 探针一致的默认端口。
 *
 * ⚠️ 它**只用于兜底与诊断**（自检载荷、诊断面板显示），**绝不**作为产品路径的目标端口：
 * 硬约束 ⑰ 实测「端口被占 ⇒ EADDRINUSE ⇒ 整个 App 进程 abort」，因此产品路径一律
 * 「Node 侧探空闲端口 → 写就绪 marker → ArkTS 读回真实端口」（见 `common/Ports.ets`）。
 */
export const DEFAULT_PORT: number = 15577;

/** 沙箱内载荷目录（相对 HOME） */
export const PAYLOAD_DIR: string = 'payload';

/**
 * 骨架期载荷入口（Phase 0 回归路径）：**rawfile 名 = 落盘后的文件名**。
 * 产品路径（pi-web）的入口见 `PI_WEB_ENTRY_FILE`（在 `resfile/pi-web/` 里，只读直读）。
 */
export const PAYLOAD_ENTRY: string = 'selfcheck.js';

// ── 产品载荷（工程规划 §7.1 两条路线）─────────────────────────────────────────
/** 只读直读路线 ①：`resources/resfile/` 下的载荷目录名（`readonlyRoot` 之内的一层） */
export const READONLY_PAYLOAD_DIR: string = 'pi-web';
/** Node 侧入口文件名（`payload/pi-web-launch.js`，由库的 bootstrap require） */
export const PI_WEB_ENTRY_FILE: string = 'pi-web-launch.js';
/** 路线 ② 的归档 rawfile 名（由 `scripts/assemble-payload.mjs --route tar` 产出） */
export const ARCHIVE_RAWFILE: string = 'pi-web.tar.gz';
/** 归档 SHA-256 旁文件（首行 64 位 hex = 幂等键，交给 `options.archiveSha256`） */
export const ARCHIVE_SHA256_RAWFILE: string = 'pi-web.tar.gz.sha256';
/** 归档在沙箱内的落点（Node 自己解包；ArkTS 只做**原始字节搬运**，不解析 tar） */
export const ARCHIVE_STAGED_NAME: string = 'pi-web.tar.gz';

// ── 库自带 Node 侧载荷（F4：HAR 不含 payload/，必须由本应用投放）──────────────────
/**
 * 库引导器（`../ohos-node-bridge/payload/bootstrap.js`）。它是交给库 `scriptPath` 的
 * **实际执行脚本**：解归档 / 幂等 marker / `uncaughtException` 兜底 / 独立日志通道都在它里面。
 * 投放位置：路线 ① = `resfile/<READONLY_PAYLOAD_DIR>/`；路线 ② = `rawfile/`（应用物化到 payloadRoot）。
 */
export const BRIDGE_BOOTSTRAP_FILE: string = 'bootstrap.js';
/** bootstrap 的同级依赖（Node 侧宿主桥客户端；`registerShutdownHook` 也找它） */
export const BRIDGE_HOST_FILE: string = 'host.js';
/** bootstrap 的相对依赖 `./lib/tar-extract.js`（路线 ② 解归档用；rawfile 里保留 lib 层级） */
export const BRIDGE_TAR_EXTRACT_RAWFILE: string = 'lib/tar-extract.js';
/** 路线 ② 必须物化的库载荷清单（顺序即物化顺序；第一个是 `scriptPath`） */
export const BRIDGE_RAWFILES: string[] = ['bootstrap.js', 'host.js', 'lib/tar-extract.js'];
/** Node 侧就绪 marker（载荷写、ArkTS 读；内容是真实端口/URL/耗时） */
export const READY_MARKER_NAME: string = 'pi-web.ready.json';
/** 载荷自己的日志通道（⑱：与库的 node.log 分开） */
export const APP_LOG_NAME: string = 'app.log';
/** 应用内错误页（ArkWeb `$rawfile`） */
export const ERROR_PAGE: string = 'error.html';

// ── 应用语义环境变量的名字（**唯一事实源是 `payload/env.js`**）────────────────
// 这里只镜像名字：值由 PiDesktopRuntime 按同一个契约装配（filesDir 只有 ArkTS 知道）。
export const ENV_AGENT_DIR: string = 'PI_CODING_AGENT_DIR';
export const ENV_OFFLINE: string = 'PI_OFFLINE';
export const ENV_NO_PROXY: string = 'NO_PROXY';
export const ENV_NO_PROXY_LOWER: string = 'no_proxy';
export const ENV_HOS_ROOTS: string = 'PI_HOS_ROOTS';
export const ENV_SKIP_VERSION_CHECK: string = 'PI_WEB_SKIP_VERSION_CHECK';
export const ENV_APP_NAME: string = 'PI_WEB_APP_NAME';
export const ENV_WEB_HOSTNAME: string = 'PI_WEB_HOSTNAME';
export const ENV_WEB_PORT: string = 'PI_WEB_PORT';
export const ENV_WEB_PASSWORD: string = 'PI_WEB_PASSWORD';

/** pi 数据与扩展根（相对 HOME） */
export const AGENT_DIR_NAME: string = 'pi-agent';
/** 沙箱工作区根（相对 HOME；选择工作区目录的第一个 Tab） */
export const SANDBOX_DIR_NAME: string = 'workspace';
/** 鸿蒙 2in1 的用户目录挂载点（授权后可用；未授权时对话框如实报 EPERM） */
export const USER_HOME_DIR: string = '/storage/Users/currentUser';
/** 默认工作目录名（与 agent 目录区分；旧壳 `pi-cwd` 同口径） */
export const CWD_DIR_NAME: string = 'pi-cwd';

// ── 时序（每一段都可在诊断面板上看到，因此失败可见）────────────────────────────
/** 探活参数：退避重试（先例实测：一次探活就下结论会误判首启慢） */
export const PROBE_ATTEMPTS: number = 20;
export const PROBE_INTERVAL_MS: number = 500;
/** `waitUntilRunning()` 的超时：Node 线程起来（dlopen + node::Start）通常 < 2 s，给足 60 s 是宽容值 */
export const WAIT_RUNNING_TIMEOUT_MS: number = 60000;
/** 等待就绪 marker 的总时长（进程内 Next 首启要编译/预热，旧壳实测 15 s 量级） */
export const READY_MARKER_TIMEOUT_MS: number = 180000;
/** 读就绪 marker 的轮询间隔 */
export const READY_MARKER_INTERVAL_MS: number = 500;
/** 诊断面板读取的日志尾长度（`Logger.tail`） */
export const DIAG_TAIL_BYTES: number = 8192;
/** 诊断面板读取的日志行数（`logs()`） */
export const DIAG_LOG_LINES: number = 50;

/** 端上渲染入口（Node 侧服务起来后由 ArkWeb 加载） */
export function appUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

/** 就绪 marker 的绝对路径（载荷写、ArkTS 读） */
export function readyMarkerPath(filesDir: string): string {
  return `${filesDir}/${PAYLOAD_DIR}/${READY_MARKER_NAME}`;
}

/** 载荷自己的日志路径（app.log；诊断面板与「请重启应用」提示都指向它） */
export function appLogPath(filesDir: string): string {
  return `${filesDir}/${PAYLOAD_DIR}/${APP_LOG_NAME}`;
}

/**
 * `context.resourceDir` 指向安装包的 `resources/resfile`；`rawfile` 是它的**同级目录**。
 * 为什么需要它：路线 ② 的归档是 rawfile，ArkTS 侧要先判断「包内到底有没有归档」，
 * 再决定要不要走解包路线（不猜、不硬编码成功路径）。
 */
export function rawfileDirFromResourceDir(resourceDir: string): string {
  const suffix = '/resfile';
  if (resourceDir.endsWith(suffix)) {
    return resourceDir.substring(0, resourceDir.length - suffix.length) + '/rawfile';
  }
  return `${resourceDir}/../rawfile`;
}

/** JSON 字符串转义（手写：诊断/能力桥的 JSON 全部由字符串拼装，绝不让引号破坏结构） */
export function escapeJson(text: string): string {
  let out: string = '';
  for (let i = 0; i < text.length; i++) {
    const code: number = text.charCodeAt(i);
    const ch: string = text.charAt(i);
    if (ch === '"') {
      out += '\\"';
    } else if (ch === '\\') {
      out += '\\\\';
    } else if (code === 10) {
      out += '\\n';
    } else if (code === 13) {
      out += '\\r';
    } else if (code === 9) {
      out += '\\t';
    } else if (code < 32) {
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

export class Log {
  static info(msg: string): void {
    hilog.info(DOMAIN, TAG, '%{public}s', msg);
  }

  static warn(msg: string): void {
    hilog.warn(DOMAIN, TAG, '%{public}s', msg);
  }

  static error(msg: string): void {
    hilog.error(DOMAIN, TAG, '%{public}s', msg);
  }
}
