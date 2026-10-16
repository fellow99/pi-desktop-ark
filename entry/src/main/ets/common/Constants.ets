import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0xD0033;
const TAG = 'PI_DESKTOP_ARK';

/** 与 `pi-web` / 探针一致的默认端口（探针实测：`hdc fport` + `curl` 可达） */
export const DEFAULT_PORT: number = 15577;

/** 沙箱内载荷目录（相对 HOME） */
export const PAYLOAD_DIR: string = 'payload';

/**
 * 骨架期载荷入口：**rawfile 名 = 落盘后的文件名**。
 * 随包放 `entry/src/main/resources/rawfile/selfcheck.js`，启动时由 ArkTS 写到
 * `<filesDir>/payload/selfcheck.js`（「谁写谁读」，notes 硬约束 ④）。
 * Phase 1 换成 pi-web 产物（`resources/resfile/` 只读直读，工程规划 §5.5）。
 */
export const PAYLOAD_ENTRY: string = 'selfcheck.js';

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
