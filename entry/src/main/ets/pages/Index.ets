import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { DIAG_TAIL_BYTES, ERROR_PAGE, Log } from '../common/Constants';
import { PiDesktopRuntime, UIState } from '../app/PiDesktopRuntime';
import { HostCapabilities } from '../host/HostCapabilities';

/**
 * Pi Desktop V2 主界面。
 *
 * 形态（工程规划 §5 第 1/11/12 条 · §5.10 ⑥⑦⑧⑨）：
 *   ① 先加载**应用内** boot 页（`$rawfile('boot.html')`）—— 必须有本地首屏，否则白屏无法诊断；
 *   ② 后台把 Node / pi-web 拉起来并探活；
 *   ③ 探活成功后 `loadUrl('http://127.0.0.1:<实际端口>/')`（端口来自 Node 侧回报，**不是常量**）
 *      → 页面由**本地服务**渲染，天然同源、零 CORS；
 *   ④ 起来后 `clearHistory()`：否则返回键/手势会把用户永久卡在「启动中」的 boot 页（⑧）；
 *   ⑤ 失败：切到应用内 `error.html`（带失败详情与「请重启应用」），并保留诊断面板入口。
 *
 * 判据口径（工程规划 §2.4）：本机 `uitest dumpLayout` **拿不到结果**，所以「界面上的东西」
 * 用 `snapshot_display` 截图 + 诊断面板里的结构化字段来断言；接口类判据走 HTTP 端点。
 */
@Entry
@Component
struct Index {
  @State status: string = UIState.IDLE;
  @State detail: string = '(未启动)';
  @State stage: string = 'idle（尚未启动）';
  @State lastError: string = '';
  @State diagOpen: boolean = false;
  @State diagText: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private launched: boolean = false;
  /** 历史只清一次（⑧）；清除失败也记日志，不静默 */
  private historyCleared: boolean = false;
  /** 错误页只切一次，避免在 onPageEnd 里反复 loadUrl */
  private errorPageLoaded: boolean = false;

  aboutToAppear(): void {
    this.launchBackend();
  }

  /** 取 UIAbilityContext（替代已弃用的全局 getContext(this)） */
  private abilityContext(): common.UIAbilityContext {
    const host: common.Context | undefined = this.getUIContext().getHostContext();
    if (host === undefined) {
      throw new Error('UIAbilityContext 不可用：页面尚未挂载到 Ability');
    }
    return host as common.UIAbilityContext;
  }

  private launchBackend(): void {
    if (this.launched) {
      return;
    }
    this.launched = true;

    const ctx: common.UIAbilityContext = this.abilityContext();
    const flags: string | undefined = AppStorage.get<string>('nodeFlags');
    const effective: string = flags !== undefined ? flags : '--no-verify-heap';

    this.status = UIState.LAUNCHING;
    this.stage = '正在启动（flags=' + effective + '）';
    this.detail = '正在启动 Node / pi-web（flags=' + effective + '）…';
    Log.info('launch 开始：flags=' + effective);

    PiDesktopRuntime.getInstance().launch(ctx, effective).then((result: string) => {
      const runtime: PiDesktopRuntime = PiDesktopRuntime.getInstance();
      this.status = runtime.getState();
      this.stage = runtime.getStage();
      this.lastError = runtime.getLastError();
      this.detail = result;
      Log.info('launch result: ' + result);
      if (runtime.getState() === UIState.READY) {
        // 服务已就绪：把 Web 切到本地服务页（URL 用**读回的真实端口**拼）
        this.controller.loadUrl(runtime.getUrl());
      } else {
        this.showErrorPage();
      }
    }).catch((e: Object) => {
      this.status = UIState.FAILED;
      this.stage = 'FAILED（编排抛异常）';
      this.lastError = 'launch 抛异常：' + JSON.stringify(e);
      this.detail = this.lastError;
      Log.error(this.lastError);
      this.showErrorPage();
    });
  }

  /** 失败 → 应用内错误页（**不提供假的重试按钮**：进程内 Node 无法重启） */
  private showErrorPage(): void {
    if (this.errorPageLoaded) {
      return;
    }
    this.errorPageLoaded = true;
    try {
      this.controller.loadUrl($rawfile(ERROR_PAGE));
      Log.info('已切到应用内错误页：' + ERROR_PAGE);
    } catch (e) {
      Log.error('错误页加载失败（界面仍会显示状态行与诊断面板）：' + JSON.stringify(e));
    }
  }

  /** 把失败详情注入错误页（页面里 window.__piError 负责渲染） */
  private injectErrorDetail(): void {
    const runtime: PiDesktopRuntime = PiDesktopRuntime.getInstance();
    const payload: string = this.errorPayload(runtime);
    this.controller.runJavaScript('window.__piError && window.__piError(' + payload + ');')
      .then(() => {
        Log.info('错误详情已注入 error.html');
      })
      .catch((e: Object) => {
        Log.warn('错误详情注入失败（错误页仍显示内置文案）：' + JSON.stringify(e));
      });
  }

  /** 错误页要的 JSON（转义由 Constants.escapeJson 负责；这里只拼结构） */
  private errorPayload(runtime: PiDesktopRuntime): string {
    const diag: string = runtime.getDiagnostics();
    const appLog: string = runtime.tailAppLog(this.safeFilesDir(), 2048);
    return '{'
      + '"state":"' + runtime.getState() + '",'
      + '"stage":"' + Index.escape(runtime.getStage()) + '",'
      + '"detail":"' + Index.escape(this.detail) + '",'
      + '"lastError":"' + Index.escape(runtime.getLastError()) + '",'
      + '"route":"' + runtime.getRoute() + '",'
      + '"hint":"进程内 Node 无法在应用内重启：请完全退出应用后重新打开（崩溃是终态）",'
      + '"diagnostics":' + diag + ','
      + '"appLog":"' + Index.escape(appLog) + '"'
      + '}';
  }

  /** 与 Constants.escapeJson 同实现（页面里只做字符串转义，逐字符） */
  private static escape(text: string): string {
    let out: string = '';
    for (let i = 0; i < text.length; i++) {
      const ch: string = text.charAt(i);
      const code: number = text.charCodeAt(i);
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

  private safeFilesDir(): string {
    try {
      return this.abilityContext().filesDir;
    } catch (e) {
      return '';
    }
  }

  /** 诊断面板：库侧事实（JSON）+ 两条日志尾（库 node.log / 载荷 app.log） */
  private refreshDiagnostics(): void {
    const runtime: PiDesktopRuntime = PiDesktopRuntime.getInstance();
    const filesDir: string = this.safeFilesDir();
    const nodeLog: string = runtime.tailLog(DIAG_TAIL_BYTES);
    const appLog: string = filesDir.length > 0 ? runtime.tailAppLog(filesDir, DIAG_TAIL_BYTES) : '(filesDir 不可用)';
    this.diagText = '── 诊断（getDiagnostics）────────────────────────────\n'
      + runtime.getDiagnostics()
      + '\n\n── 库日志尾 node.log（Logger.tail ' + DIAG_TAIL_BYTES + ' B）────\n'
      + nodeLog
      + '\n\n── 载荷日志尾 app.log（⑱ 独立通道）────────────────────\n'
      + appLog
      + '\n\n── 提示 ────────────────────────────────────────────────\n'
      + '本机 uitest dumpLayout 拿不到结果：请用 snapshot_display 截图，或读上面的结构化字段。';
    Log.info('诊断面板已刷新（' + this.diagText.length + ' 字符）');
  }

  private toggleDiagnostics(): void {
    this.diagOpen = !this.diagOpen;
    if (this.diagOpen) {
      this.refreshDiagnostics();
    }
  }

  /** 是否指向本机服务（导航围栏的放行判据：**只放行本服务的 origin**） */
  private isOwnServiceUrl(url: string): boolean {
    const base: string = PiDesktopRuntime.getInstance().getUrl();
    if (base.length === 0) {
      return false;
    }
    if (url === base || url.startsWith(base)) {
      return true;
    }
    // 允许带 hash/query 的等价写法（base 末尾有 `/`）
    return url.indexOf('http://127.0.0.1:' + PiDesktopRuntime.getInstance().getPort()) === 0;
  }

  /** 应用内资源与内联页面（boot/error 页）*/
  private isAppLocalUrl(url: string): boolean {
    return url.startsWith('file://') || url.startsWith('data:') || url.startsWith('about:')
      || url.startsWith('resource://') || url.indexOf('rawfile') >= 0 || url.length === 0;
  }

  /**
   * 外链分流（⑨）：**只**用 `startAbility(viewData)` 交系统浏览器。
   *
   * ⚠️ 绝不调用未注册的 ArkTS 宿主函数：旧壳 `ExternalWeb.Open` 从未注册却被调用，
   * `GetJSFunction` 失败后解引用空指针 → 整个应用 SIGSEGV（R15）。这里用系统 Want →
   * 找不到处理器时只是「打开失败」并被如实记日志。
   */
  private openExternal(url: string): void {
    Log.warn('拦截到外部导航，交系统浏览器：' + url);
    try {
      const ctx: common.UIAbilityContext = this.abilityContext();
      // 复用宿主能力桥的同一实现（能力名 `shell.openExternal`）—— 单一实现，两处共用
      HostCapabilities.openExternal(ctx, url);
    } catch (e) {
      Log.error('外链分流失败（未调用任何未注册的宿主函数）：' + url + '｜' + JSON.stringify(e));
    }
  }

  onBackPress(): boolean {
    if (this.diagOpen) {
      this.diagOpen = false;
      Log.info('返回键：关闭诊断面板');
      return true;
    }
    if (this.status === UIState.READY) {
      // ⑧：主动拦下返回键。放行会让 ArkWeb 回到已被 clearHistory 清除的 boot 页（或退出应用），
      // 而**主界面就是本应用的功能本体**，退出应走系统手势/关闭按钮。
      Log.info('返回键已拦截（主界面由本地服务提供，不放行以免回到 boot 页）');
      return true;
    }
    return false;
  }

  @Builder
  statusRow() {
    Row() {
      Text('Pi Desktop V2')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .layoutWeight(1)
      Text(this.status)
        .fontSize(14)
        .fontColor(this.status === UIState.READY ? Color.Green
          : (this.status === UIState.FAILED ? Color.Red : Color.Orange))
      Button('诊断')
        .fontSize(14)
        .margin({ left: 12 })
        .onClick(() => {
          this.toggleDiagnostics();
        })
      if (this.status === UIState.READY) {
        // 「重新加载页面」≠「重启 Node」：只重新加载当前页面（文案如实，不承诺重启）
        Button('重载页面')
          .fontSize(14)
          .margin({ left: 8 })
          .onClick(() => {
            this.controller.loadUrl(PiDesktopRuntime.getInstance().getUrl());
          })
      }
    }
    .width('100%')
    .padding(12)
  }

  @Builder
  statusDetail() {
    Column() {
      Text('阶段：' + this.stage)
        .fontSize(12)
        .fontColor(Color.Gray)
        .width('100%')
      Text(this.detail)
        .fontSize(12)
        .fontColor(Color.Gray)
        .width('100%')
      if (this.lastError.length > 0) {
        // 失败必须可见（规划 §3 目标 7）：红色文本可被截图直接断言
        Text('失败：' + this.lastError)
          .fontSize(12)
          .fontColor(Color.Red)
          .width('100%')
      }
      // P2：平台能力缺失必须**显式**展示为「能力标志」，而不是等 API 抛模块加载异常
      Text(PiDesktopRuntime.getInstance().getCapabilityNotice())
        .fontSize(12)
        .fontColor(Color.Orange)
        .width('100%')
    }
    .width('100%')
    .padding({ left: 12, right: 12, bottom: 8 })
  }

  @Builder
  diagnosticsPanel() {
    Column() {
      Row() {
        Text('诊断 / 日志')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
        Button('刷新')
          .fontSize(13)
          .onClick(() => {
            this.refreshDiagnostics();
          })
        Button('关闭')
          .fontSize(13)
          .margin({ left: 8 })
          .onClick(() => {
            this.diagOpen = false;
          })
      }
      .width('100%')
      .padding({ bottom: 8 })

      Scroll() {
        Text(this.diagText)
          .fontSize(11)
          .fontFamily('monospace')
          .textAlign(TextAlign.Start)
          .copyOption(CopyOptions.LocalDevice)
          .width('100%')
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Auto)
    }
    .width('100%')
    .height('60%')
    .padding(12)
    .backgroundColor('#F2F3F5')
    .border({ width: { top: 1 }, color: '#D0D0D0' })
  }

  build() {
    Column() {
      this.statusRow()
      this.statusDetail()

      // 主渲染区：先本地 boot 页；就绪后由代码切到 127.0.0.1:<实际端口>
      Stack() {
        Web({ src: $rawfile('boot.html'), controller: this.controller })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          // §5 第 1 条：缺 databaseAccess 时部分 Web 存储 API（IndexedDB）不可用，SPA 首屏可能崩
          .databaseAccess(true)
          .width('100%')
          .height('100%')
          .onControllerAttached(() => {
            Log.info('ArkWeb controller attached');
          })
          .onPageEnd((event: OnPageEndEvent) => {
            Log.info('页面加载完成：' + event.url);
            if (this.errorPageLoaded) {
              this.injectErrorDetail();
              return;
            }
            if (this.isOwnServiceUrl(event.url)) {
              if (!this.historyCleared) {
                try {
                  this.controller.clearHistory();
                  this.historyCleared = true;
                  Log.info('已清除 Web 历史（返回键不会再回到 boot 页，⑧）');
                } catch (e) {
                  Log.warn('clearHistory 失败（返回键可能仍会回到 boot 页）：' + JSON.stringify(e));
                }
              }
              this.status = UIState.READY;
              this.stage = PiDesktopRuntime.getInstance().getStage();
              this.detail = '已加载本地服务页面：' + event.url;
            }
          })
          .onLoadIntercept((event: OnLoadInterceptEvent) => {
            const url: string = event.data.getRequestUrl();
            const mainFrame: boolean = event.data.isMainFrame();
            // 子 frame（内嵌 iframe / 资源）一律放行：拦了会把页面搞坏（⑨）
            if (!mainFrame) {
              return false;
            }
            if (this.isAppLocalUrl(url) || this.isOwnServiceUrl(url)) {
              return false;
            }
            // 其余主 frame 导航一律阻断并分流到系统浏览器
            this.openExternal(url);
            return true;
          })
          .onWindowNew((event: OnWindowNewEvent) => {
            // 弹窗拦截：**不静默丢弃**。把新窗口的控制器指回本 Web ⇒ 弹窗在本组件内打开，
            // 随后的主 frame 导航会被上面的 onLoadIntercept 分流（外链→系统浏览器）。
            Log.warn('拦截到 window.open / target=_blank：改由本 Web 承载后分流：' + event.targetUrl);
            event.handler.setWebController(this.controller);
          })
      }
      .layoutWeight(1)
      .width('100%')

      if (this.diagOpen) {
        this.diagnosticsPanel()
      }
    }
    .width('100%')
    .height('100%')
  }
}
