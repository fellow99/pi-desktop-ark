import { Log } from './Constants';

/**
 * 设备侧用例执行通道（**仅 debug 构建**）—— `specs/overall-test-cases.md` §3 的取证通道之一。
 *
 * 为什么需要它：本工程的用例里有一大半（108 兼容层、204 工具链、真实模型调用）是**纯 JS 断言**，
 * 只有在设备上的 Node（`--jitless` / jit 两种形态、真实文件系统、真实网络）里跑才算证据。
 * 设备上没有可执行的 `node` 二进制（`libnode.so` 只能被应用进程 `dlopen`），因此唯一路径是
 * 让应用**把自己的 Node 入口换成语例脚本**：bootstrap 的 `resolveEntry` 支持绝对路径，
 * 所以只需把 `plan.entry` 覆盖成 resfile 下某个脚本即可。
 *
 * 判定纪律（与 `NodeMode` 同源，合规 G9）：
 *   · `applicationInfo.debug === false`（release）⇒ 一律不读 want 参数，通道**不存在**；
 *   · 参数名与用途写进 `specs/overall-test-cases.md` §3，便于审计"发布包里没有调试入口"。
 *
 * 三个参数：
 *   `piTestScript`  —— 语例脚本：相对 `context.resourceDir` 或以 `/` 开头的绝对路径；
 *   `piTestEnvFile` —— 环境来源（URL 或路径）：测试态主机/账号/密钥由电脑侧一次性提供，
 *                      脚本自己取；本模块只转发**位置**，绝不把内容写进日志（敏感信息零落盘）；
 *   `piTestSuite`   —— 跑哪一支（`108-fetch`/`108-photon`/`204-unit`/`204-e2e`/`model`/`probe`/`all`）。
 *                      单独给的原因：108 的两支语例要**自己**安装兼容层并断言安装日志，
 *                      若执行器先装一遍，那条断言就会看到「已安装过（幂等）」而误判失败。
 */
export class DeviceTestRequest {
  /** 覆盖后的入口绝对路径；空串 = 未启用本通道 */
  readonly script: string;
  /** 环境来源（URL 或路径；可空） */
  readonly envFile: string;
  /** 要跑哪一支语例（空串 = 由语例按 `all` 自行决定） */
  readonly suite: string;

  constructor(script: string, envFile: string, suite: string) {
    this.script = script;
    this.envFile = envFile;
    this.suite = suite;
  }
}

/** 本进程当前生效的请求（EntryAbility 写入、PiDesktopRuntime 读取；同进程，无需序列化） */
export class DeviceTest {
  private static script: string = '';
  private static envFile: string = '';
  private static suiteName: string = '';

  static set(script: string, envFile: string, suite: string): void {
    DeviceTest.script = script;
    DeviceTest.envFile = envFile;
    DeviceTest.suiteName = suite;
  }

  static scriptPath(): string {
    return DeviceTest.script;
  }

  static envFilePath(): string {
    return DeviceTest.envFile;
  }

  static suite(): string {
    return DeviceTest.suiteName;
  }

  static active(): boolean {
    return DeviceTest.script.length > 0;
  }
}

const PARAM_SCRIPT: string = 'piTestScript';
const PARAM_ENV_FILE: string = 'piTestEnvFile';
const PARAM_SUITE: string = 'piTestSuite';

/** 取 want 参数里的字符串（缺省/空 ⇒ 空串） */
function paramString(params: Record<string, Object> | undefined, key: string): string {
  if (params === undefined) {
    return '';
  }
  const raw: Object | undefined = params[key];
  if (raw === undefined) {
    return '';
  }
  return raw as string;
}

/**
 * 解析调试参数。**release 直接返回空请求**（不读参数、不打日志内容）。
 *
 * @param resourceDir `context.resourceDir`（resfile 安装后的真实目录，Node 的 fs 可读）
 * @param debugBuild  `context.applicationInfo.debug`
 * @param params      `want.parameters`
 */
export function resolve(resourceDir: string, debugBuild: boolean, params: Record<string, Object> | undefined): DeviceTestRequest {
  if (!debugBuild) {
    return new DeviceTestRequest('', '', '');
  }
  const given: string = paramString(params, PARAM_SCRIPT);
  if (given.length === 0) {
    return new DeviceTestRequest('', '', '');
  }
  // 绝对路径原样使用（便于指向 resfile 之外的调试位置）；相对路径一律挂到 resfile 下
  const script: string = given.startsWith('/') ? given : (resourceDir + '/' + given);
  const envFile: string = paramString(params, PARAM_ENV_FILE);
  const suite: string = paramString(params, PARAM_SUITE);
  Log.info('设备用例通道已启用（debug）：script=' + script + ' suite=' + (suite.length > 0 ? suite : '(all)')
    + ' env=' + (envFile.length > 0 ? envFile : '(无)') + '；本轮上游服务不会启动');
  return new DeviceTestRequest(script, envFile, suite);
}
