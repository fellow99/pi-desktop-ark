import { common } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { Env, NodeRuntime, NodeStartResult, NodeState } from '@fellow99/node-bridge';
import { appUrl, DEFAULT_PORT, Log, PAYLOAD_DIR, PAYLOAD_ENTRY, PROBE_ATTEMPTS, PROBE_INTERVAL_MS } from '../common/Constants';

/** 界面上看到的状态机（与库的运行时状态区分：这里是「整机可用性」） */
export enum UIState {
  IDLE = 'idle',
  LAUNCHING = 'launching',
  READY = 'running',
  FAILED = 'failed'
}

/**
 * PiDesktopRuntime —— 消费方编排（本工程自己的逻辑，不属于库）。
 *
 * 三段式（工程规划 §6.1）：
 *   ① 投放/定位入口脚本 → ② `NodeRuntime.start()` 投递启动 → ③ **探活**（轮询本地服务端口）
 * 只有第 ③ 步成功才算 `READY`：`start()` 返回 ok 只代表「已投递到后台线程」。
 *
 * ⚠️ 崩溃是终态：进程内 Node 不会自动重启（硬约束 ⑥）。本类只负责**如实报告**，
 *    不做「偷偷重启」——那只会把问题藏起来。
 */
export class PiDesktopRuntime {
  private static instance: PiDesktopRuntime | undefined = undefined;

  private state: UIState = UIState.IDLE;
  private port: number = DEFAULT_PORT;
  private lastError: string = '';

  static getInstance(): PiDesktopRuntime {
    if (PiDesktopRuntime.instance === undefined) {
      PiDesktopRuntime.instance = new PiDesktopRuntime();
    }
    return PiDesktopRuntime.instance;
  }

  getState(): UIState {
    return this.state;
  }

  getPort(): number {
    return this.port;
  }

  getLastError(): string {
    return this.lastError;
  }

  getUrl(): string {
    return appUrl(this.port);
  }

  /**
   * 启动后端并等待可用。
   * @param flags Node 参数；**无 ACL 时必须带 `--jitless`**（否则 JIT 路径 SIGTRAP）
   * @returns 人读状态串（同时写入状态机）
   */
  async launch(context: common.UIAbilityContext, flags: string): Promise<string> {
    if (this.state === UIState.READY) {
      return 'already running: ' + this.getUrl();
    }
    this.state = UIState.LAUNCHING;
    this.lastError = '';

    // ① 载荷物化：把随包 rawfile 写到沙箱（Node 读不到包内只读条目，notes 硬约束 ④）
    const scriptPath: string = this.preparePayload(context);
    Log.info('launch: flags=' + flags + ' script=' + scriptPath);

    // ① + ②：投递启动（幂等保护在库内；Node 只能启动一次）
    const runtime = NodeRuntime.getInstance();
    const result: NodeStartResult = runtime.start(context, { scriptPath: scriptPath, flags: flags });
    if (!result.ok) {
      this.state = UIState.FAILED;
      this.lastError = result.message;
      Log.error('start 失败：' + result.message);
      return 'FAILED: ' + result.message;
    }

    // ③：探活（退避重试）
    const ready: boolean = await this.probeReady();
    if (ready) {
      this.state = UIState.READY;
      runtime.markRunning();
      Log.info('READY: ' + this.getUrl());
      return 'READY: ' + this.getUrl();
    }

    this.state = UIState.FAILED;
    runtime.markFailed('探活超时');
    this.lastError = '探活超时（' + PROBE_ATTEMPTS + ' 次 × ' + PROBE_INTERVAL_MS + ' ms）；Node 日志：' + runtime.getLogPath();
    Log.error(this.lastError);
    return 'FAILED: ' + this.lastError;
  }

  /** 探活：轮询 `http://127.0.0.1:<port>/`，任一成功即视为可用 */
  private async probeReady(): Promise<boolean> {
    const url: string = appUrl(this.port);
    for (let i = 0; i < PROBE_ATTEMPTS; i++) {
      const ok: boolean = await this.probeOnce(url);
      if (ok) {
        return true;
      }
      await PiDesktopRuntime.sleep(PROBE_INTERVAL_MS);
    }
    return false;
  }

  private async probeOnce(url: string): Promise<boolean> {
    const req = http.createHttp();
    try {
      const resp = await req.request(url, {
        method: http.RequestMethod.GET,
        connectTimeout: 800,
        readTimeout: 1200
      });
      return resp.responseCode === 200;
    } catch (e) {
      return false;
    } finally {
      req.destroy();
    }
  }


  /**
   * 把随包载荷物化到沙箱并返回**入口脚本的绝对路径**。
   *
   * 为什么必须物化（notes 硬约束 ④「谁写谁读」）：Node 读得到 ArkTS 写进 `filesDir` 的文件，
   * 读不到安装包内的只读条目。骨架期载荷是 `rawfile/selfcheck.js`（环境自检 + `/facts` 探活）；
   * Phase 1 换成 pi-web 产物时改为 `resources/resfile/pi-web/` **只读直读、零解压**（工程规划 §5.5）。
   *
   * 失败不抛：打印日志后仍返回目标路径，让 Node 侧用「找不到模块」如实报错（比在这里吞掉更好定位）。
   */
  private preparePayload(context: common.UIAbilityContext): string {
    const destDir: string = context.filesDir + '/' + PAYLOAD_DIR;
    const dest: string = destDir + '/' + PAYLOAD_ENTRY;
    try {
      Env.ensureDir(destDir);
      Env.materializeRawfile(context.resourceManager, PAYLOAD_ENTRY, dest);
      Log.info('载荷已物化：' + dest);
    } catch (e) {
      Log.error('载荷物化失败（Node 将按原路径启动并在 node.log 报错）：' + JSON.stringify(e));
    }
    return dest;
  }
  private static sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(() => {
        resolve();
      }, ms);
    });
  }
}
