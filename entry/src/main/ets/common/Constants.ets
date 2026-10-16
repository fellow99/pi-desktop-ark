import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0xD0033;
const TAG = 'PI_DESKTOP_ARK';

/** 与 `pi-web` / 探针一致的默认端口（探针实测：`hdc fport` + `curl` 可达） */
export const DEFAULT_PORT: number = 15577;

/** 沙箱内入口脚本相对 HOME 的路径 */
export const BOOTSTRAP_REL_PATH: string = 'payload/bootstrap.js';

/** 探活参数：退避重试（先例实测：一次探活就下结论会误判首启慢） */
export const PROBE_ATTEMPTS: number = 20;
export const PROBE_INTERVAL_MS: number = 500;

/** 端上渲染入口（Node 侧服务起来后由 ArkWeb 加载） */
export function appUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

export class Log {
  static info(msg: string): void {
    hilog.info(DOMAIN, TAG, '%{public}s', msg);
  }

  static error(msg: string): void {
    hilog.error(DOMAIN, TAG, '%{public}s', msg);
  }
}
