import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { DEFAULT_PORT, Log } from '../common/Constants';
import { PiDesktopRuntime, UIState } from '../app/PiDesktopRuntime';

/**
 * Pi Desktop V2 主界面（骨架）。
 *
 * 形态（工程规划 §5.10 ⑥ / §6.1）：
 *   ① 先加载**应用内** boot 页（`$rawfile('boot.html')`）—— 必须有本地首屏，否则白屏无法诊断；
 *   ② 后台把 Node / pi-web 拉起来并探活；
 *   ③ 探活成功后 `loadUrl('http://127.0.0.1:<port>/')` —— 页面由**本地服务**渲染，
 *      天然同源、零 CORS，且不需要 ArkWeb 进程去访问外部网络。
 *
 * Phase 1/2 待补：清历史（`clearHistory()`）、返回键守卫、外链拦截（`onLoadIntercept` + isMainFrame）、
 * 失败回退页与重试按钮的完整状态机。
 */
@Entry
@Component
struct Index {
  @State status: string = UIState.IDLE;
  @State detail: string = '(未启动)';
  @State logTail: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private launched: boolean = false;

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
    this.detail = '正在启动 Node / pi-web（flags=' + effective + '）…';


    PiDesktopRuntime.getInstance().launch(ctx, effective).then((result: string) => {
      this.status = PiDesktopRuntime.getInstance().getState();
      this.detail = result;
      Log.info('launch result: ' + result);
      if (PiDesktopRuntime.getInstance().getState() === UIState.READY) {
        // 服务已就绪：把 Web 切到本地服务页
        this.controller.loadUrl(PiDesktopRuntime.getInstance().getUrl());
      }
    }).catch((e: Object) => {
      this.status = UIState.FAILED;
      this.detail = 'launch 抛异常：' + JSON.stringify(e);
      Log.error(this.detail);
    });
  }

  private refreshLog(): void {
    // TODO(Phase 1)：从 <filesDir>/payload/node.log 读尾部（库里的 Logger.tail 可直接用）
    this.logTail = '(Phase 1：日志面板接 Logger.tail)';
  }

  build() {
    Column() {
      Row() {
        Text('Pi Desktop V2')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
        Text(this.status)
          .fontSize(14)
          .fontColor(this.status === UIState.READY ? Color.Green : Color.Orange)
        Button('重试')
          .fontSize(14)
          .margin({ left: 12 })
          .onClick(() => {
            this.controller.loadUrl(PiDesktopRuntime.getInstance().getUrl());
          })
        Button('日志')
          .fontSize(14)
          .margin({ left: 8 })
          .onClick(() => {
            this.refreshLog();
          })
      }
      .width('100%')
      .padding(12)

      Text(this.detail)
        .fontSize(12)
        .fontColor(Color.Gray)
        .width('100%')
        .padding({ left: 12, right: 12, bottom: 8 })

      // ArkWeb：先本地 boot 页，探活成功后由代码切到 127.0.0.1
      Web({ src: $rawfile('boot.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .layoutWeight(1)
        .width('100%')
        .onControllerAttached(() => {
          Log.info('ArkWeb controller attached');
        })

      if (this.logTail.length > 0) {
        Text(this.logTail)
          .fontSize(11)
          .width('100%')
          .height(120)
          .padding(8)
      }
    }
    .width('100%')
    .height('100%')
  }
}
