import { buffer } from '@kit.ArkTS';
import { fileIo as fs } from '@kit.CoreFileKit';
import { http } from '@kit.NetworkKit';
import { Log, READY_MARKER_NAME, appUrl, readyMarkerPath } from './Constants';

/**
 * 端口解析结果（**声明式类型**：ArkTS 不接受匿名的结构化字面量，所以端口相关的结果
 * 一律用这个类表达，而不是临时对象）。
 */
export class PortResolution {
  /** 实际端口；`0` = 尚未解析出来 */
  port: number = 0;
  /** 依据（人读）：`marker` / `log:PI_WEB_READY` / `fallback:DEFAULT_PORT` */
  source: string = 'none';
  /** 原始证据片段（截图/日志可断言） */
  evidence: string = '';

  constructor(port: number, source: string, evidence: string) {
    this.port = port;
    this.source = source;
    this.evidence = evidence;
  }

  ok(): boolean {
    return this.port > 0;
  }
}

/** HTTP 探活结果 */
export class HttpProbeResult {
  ok: boolean = false;
  detail: string = '';

  constructor(ok: boolean, detail: string) {
    this.ok = ok;
    this.detail = detail;
  }
}

/**
 * 端口助手（硬约束 ⑰ 的 ArkTS 侧一半）。
 *
 * 机制（**就绪路径不使用常量端口**）：
 *   ① ArkTS 侧把 `PI_WEB_PORT=0` 交给 Node 侧（`options.env`）；
 *   ② Node 侧 `listen(0)` 探一个空闲端口、起服务、把**真实端口**写进
 *      `<filesDir>/payload/pi-web.ready.json` 与一行 `PI_WEB_READY {…}` 日志；
 *   ③ ArkTS 侧**读回**（先 marker，退化为解析日志行），再用**真实端口**探活与 loadUrl。
 *
 * `resolvePort(preferred)` 的另一半职责是把「用不用首选端口」这件事讲清楚：
 * 返回 `0` 表示「让 Node 侧随机取」（产品默认）。`preferredPortIsBusy()` 只服务于
 * 诊断面板与将来的回退路线 —— 它是**启发式**（GET 有 HTTP 响应 ⇒ 该端口被占），
 * 绝不能当判据用（被非 HTTP 服务占用的端口会误判为空闲）。
 */
export class Ports {
  /** 产品默认：**交给 Node 侧随机取端口**；`preferred > 0` 时原样返回（诊断/回退用） */
  static resolvePort(preferred: number): number {
    if (preferred > 0) {
      Log.warn('使用首选端口 ' + preferred + '（诊断/回退路径；产品路径应为 0 ⇒ 随机端口，硬约束 ⑰）');
      return preferred;
    }
    return 0;
  }

  /** 就绪 marker 是否存在（ArkTS 侧只读，不写） */
  static markerExists(filesDir: string): boolean {
    try {
      return fs.accessSync(readyMarkerPath(filesDir));
    } catch (e) {
      return false;
    }
  }

  /** 读 marker 全文（失败返回空串；调用方据空串走「解析日志」退化路径） */
  static readMarker(filesDir: string): string {
    const path: string = readyMarkerPath(filesDir);
    try {
      const stat: fs.Stat = fs.statSync(path);
      const size: number = stat.size;
      if (size <= 0 || size > 65536) {
        Log.warn('marker 大小异常（' + size + ' B），按不可读处理：' + path);
        return '';
      }
      const file: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
      try {
        const ab: ArrayBuffer = new ArrayBuffer(size);
        const read: number = fs.readSync(file.fd, ab);
        return Ports.decodeUtf8(ab, read);
      } finally {
        fs.closeSync(file);
      }
    } catch (e) {
      return '';
    }
  }

  /** `ArrayBuffer`（前 `bytes` 字节）→ UTF-8 字符串（与库 `Logger.tail` 同型） */
  private static decodeUtf8(ab: ArrayBuffer, bytes: number): string {
    try {
      // 与库的 `Logger.tail` 同型：用 `buffer.from(...).toString('utf-8')`，
      // 逐字节 `String.fromCharCode` 对中文会乱码（契约 §2.9 明确要求修掉这一点）。
      const buf: buffer.Buffer = buffer.from(ab, 0, bytes);
      return buf.toString('utf-8');
    } catch (e) {
      Log.error('marker UTF-8 解码失败：' + Ports.describe(e));
      return '';
    }
  }

  /**
   * 从 marker JSON 里取端口（**只认数字**；解析不出就是解析不出，不猜）。
   *
   * 手写解析而不是 JSON.parse/RegExp：ArkTS 侧不需要为此引入对象类型或动态正则，
   * 而且失败时能直接给出「文本里有没有这个键」的证据。
   */
  static parsePortFromMarker(json: string): number {
    return Ports.portAfterKey(json, '"port"', 0);
  }

  /** 从日志文本里解析 `PI_WEB_READY {"port":NNNNN,…}`（载荷自己打印的判据行） */
  static parsePortFromLog(text: string): number {
    const readyAt: number = text.lastIndexOf('PI_WEB_READY');
    if (readyAt >= 0) {
      const fromReady: number = Ports.portAfterKey(text, '"port"', readyAt);
      if (fromReady > 0) {
        return fromReady;
      }
    }
    // 退化：载荷还会打印「服务端口 = NNNNN」（起服务之前的日志行）
    const portAt: number = text.lastIndexOf('服务端口 =');
    if (portAt >= 0) {
      const value: number = Ports.portAfterKey(text, '服务端口 =', portAt - 16);
      if (value > 0) {
        return value;
      }
    }
    return 0;
  }

  /**
   * 在 `fromIndex` 之后找 `key`，跳过 `:`、`=`、空白与引号，读一段十进制数字。
   * 读不出合法端口（1..65535）就返回 0 —— 调用方据此走下一级退化，而不是编一个端口。
   */
  private static portAfterKey(text: string, key: string, fromIndex: number): number {
    if (text.length === 0) {
      return 0;
    }
    const start: number = fromIndex > 0 ? fromIndex : 0;
    const keyAt: number = text.indexOf(key, start);
    if (keyAt < 0) {
      return 0;
    }
    let i: number = keyAt + key.length;
    while (i < text.length) {
      const ch: string = text.charAt(i);
      if (ch === ':' || ch === '=' || ch === '"' || ch === ' ' || ch === '\t') {
        i++;
        continue;
      }
      break;
    }
    let digits: string = '';
    while (i < text.length && digits.length < 6) {
      const ch: string = text.charAt(i);
      const code: number = text.charCodeAt(i);
      if (code < 48 || code > 57) {
        break;
      }
      digits += ch;
      i++;
    }
    if (digits.length === 0) {
      return 0;
    }
    const value: number = Number.parseInt(digits, 10);
    if (Number.isNaN(value) || value <= 0 || value > 65535) {
      return 0;
    }
    return value;
  }

  /** 端上/日志里的原始证据片段（诊断面板与截图断言用） */
  static evidenceLine(text: string): string {
    const lines: string[] = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line: string = lines[i];
      if (line.indexOf('PI_WEB_READY') >= 0) {
        return line.length > 200 ? line.substring(0, 200) : line;
      }
    }
    return '';
  }

  /** 一旦拿到端口 → 构造可探活的 URL（**产品路径的唯一 URL 来源**） */
  static urlFor(port: number): string {
    return appUrl(port);
  }

  /** 单次 HTTP 探活（任一 HTTP 响应即算「有服务在听」；连接失败 = 未就绪） */
  static async probeOnce(url: string): Promise<HttpProbeResult> {
    const req: http.HttpRequest = http.createHttp();
    try {
      const resp: http.HttpResponse = await req.request(url, {
        method: http.RequestMethod.GET,
        connectTimeout: 800,
        readTimeout: 1500
      });
      const code: number = resp.responseCode as number;
      return new HttpProbeResult(code > 0, 'HTTP ' + code);
    } catch (e) {
      return new HttpProbeResult(false, 'connect: ' + Ports.describe(e));
    } finally {
      req.destroy();
    }
  }

  /** 退避重试探活（`attempts × intervalMs`）；返回首次成功的证据 */
  static async probeWithRetry(url: string, attempts: number, intervalMs: number): Promise<HttpProbeResult> {
    let last: string = '(尚未探测)';
    for (let i = 0; i < attempts; i++) {
      const result: HttpProbeResult = await Ports.probeOnce(url);
      if (result.ok) {
        return new HttpProbeResult(true, result.detail + ' @ ' + url);
      }
      last = result.detail;
      await Ports.sleep(intervalMs);
    }
    return new HttpProbeResult(false, last + ' @ ' + url);
  }

  /** 诊断用：首选端口像不像被占（启发式，**不是判据**） */
  static async preferredPortIsBusy(preferred: number): Promise<string> {
    if (preferred <= 0) {
      return '未探测（首选端口 <= 0）';
    }
    const result: HttpProbeResult = await Ports.probeOnce(appUrl(preferred));
    if (result.ok) {
      return '像被占用（GET 有响应：' + result.detail + '；非 HTTP 服务占用会误判为空闲，故仅作参考）';
    }
    return '未占用或不可判定（' + result.detail + '；连接失败也可能是防火墙/协议不符，故仅作参考）';
  }

  static sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(() => {
        resolve();
      }, ms);
    });
  }

  /** 错误描述（ArkTS 的 catch 参数是 Object，必须显式转字符串） */
  static describe(e: Object): string {
    try {
      const err = e as Error;
      if (err !== undefined && err.message !== undefined) {
        return err.message;
      }
    } catch (inner) {
      // 继续退到字符串化
    }
    return JSON.stringify(e);
  }

  /** marker 文件的相对名（日志里显示用，避免各处硬编码文件名） */
  static markerName(): string {
    return READY_MARKER_NAME;
  }
}
