import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { Log } from '../common/Constants';
import * as NodeMode from '../common/NodeMode';
import * as DeviceTest from '../common/DeviceTest';
import { WindowState } from '../common/WindowState';
import { PiDesktopRuntime } from '../app/PiDesktopRuntime';

/**
 * Pi Desktop Ark 主 Ability。
 *
 * 起 Node 的时机（工程规划 §5.10 ⑪ / ⑫）：**先 `loadContent`，再起 Node**，
 * 且权限申请放在 `loadContent` 之后 —— 权限弹窗在无人点按的设备上会卡住启动屏（APP_INPUT_BLOCK）。
 * 本工程把「起 Node」放在页面里（`pages/Index`）执行，便于把状态直接画在界面上。
 *
 * 单实例由 `module.json5` 的 `launchType: "singleton"` 保证（硬约束 ⑰：多实例会互抢端口与数据目录）。
 *
 * 支持命令行传参（调试用）：
 *   aa start -a EntryAbility -b org.fellow99.pi.PiDesktopArk --ps probeFlags "--jitless --no-verify-heap"
 */
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (e) {
      Log.error('setColorMode 失败：' + JSON.stringify(e));
    }

    // F3（合规 G9）：`probeFlags` 是一个**调试通道**，release 构建里必须不存在。
    // 判定依据 = 应用自己的 debug 标志（`applicationInfo.debug`，由构建器写入；release 恒为 false）。
    const debugBuild: boolean = this.context.applicationInfo.debug;
    const params: Record<string, Object> | undefined = want.parameters;

    /*
     * 108-jitless：先定**运行形态**（jit / compat），再定 flags。
     *
     * 为什么不能固定 `--no-verify-heap`：没有 ACL 的设备上 V8 走 JIT 会直接 SIGTRAP/SIGABRT
     * （真机实测：`--jitless` 之外没有第二条活路），而有 ACL 时带 `--jitless` 又白白损失 7–10×。
     * 形态判定与依据见 `common/NodeMode.ets`（顺序：probeFlags > piNodeMode > 偏好设置 > ACL 探测）。
     */
    const decision: NodeMode.NodeModeDecision = NodeMode.resolve(this.context, debugBuild, params);
    let flags: string = decision.flags();
    /*
     * probeFlags 覆盖：直接给整串 Node 参数，**优先级最高**（既有诊断通道，行为不变）。
     * 注意它会让"形态"与"实际 flags"脱钩（例如 probeFlags 里没有 `--jitless` 但是 compat 形态），
     * 所以覆盖时必须把 mode 标成 `custom` 并把真实 flags 写进依据 —— 否则诊断面板会说反话。
     */
    let modeForUi: string = decision.mode;
    let reasonForUi: string = decision.reason;
    if (debugBuild) {
      if (params !== undefined) {
        const raw: Object | undefined = params['probeFlags'];
        if (raw !== undefined) {
          const s: string = raw as string;
          if (s.length > 0) {
            flags = s;
            modeForUi = 'custom';
            reasonForUi = '调试参数 probeFlags 直接给出 flags=' + s
              + '（形态判定结果 ' + decision.mode + ' 已被绕过）';
          }
        }
      }
    } else {
      // release：**忽略**调试参数，并留下一条可查的说明（不是静默丢弃）
      Log.info('probeFlags / piNodeMode 调试通道在 release 构建中已禁用（applicationInfo.debug=false）：'
        + 'want.parameters 一律忽略，形态由偏好设置/ACL 探测决定');
    }
    AppStorage.setOrCreate<string>('nodeFlags', flags);
    AppStorage.setOrCreate<string>('nodeMode', modeForUi);
    AppStorage.setOrCreate<string>('nodeModeReason', reasonForUi);
    Log.info('onCreate flags=' + flags + ' mode=' + modeForUi + '（依据：' + reasonForUi + '）'
      + ' debug=' + debugBuild + ' filesDir=' + this.context.filesDir);

    /*
     * 设备侧用例通道（`specs/overall-test-cases.md` §3）：把 Node 入口换成语例脚本，
     * 让「108 兼容层 / 204 工具链 / 真实模型调用」在**设备上的 Node**里跑（PC 侧跑不算证据）。
     * release 构建里 `resolve()` 直接返回空请求（合规 G9：发布包没有调试入口）。
     */
    const testReq: DeviceTest.DeviceTestRequest = DeviceTest.resolve(this.context.resourceDir, debugBuild, params);
    DeviceTest.DeviceTest.set(testReq.script, testReq.envFile, testReq.suite);
    if (testReq.script.length > 0) {
      Log.info('onCreate 设备用例通道：entry 将被覆盖为 ' + testReq.script);
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // ⑪：先 loadContent（首屏是应用内 boot 页），再让页面去投递 Node —— 顺序不能反
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        Log.error('loadContent 失败: ' + JSON.stringify(err));
        return;
      }
      Log.info('loadContent ok（随后由页面投递 Node）');
      // ⑫（行动项 E12）：窗口尺寸记忆。restore 只应用一次；watch 只记录**用户后续改过的**
      // 尺寸——启动时不回写，避免把系统默认尺寸固化成「用户选择」。
      try {
        const restored: string = WindowState.restore(windowStage, this.context);
        Log.info('窗口状态 restore → ' + restored);
        WindowState.watch(windowStage, this.context);
      } catch (e) {
        Log.warn('窗口状态初始化失败（不影响启动）：' + JSON.stringify(e));
      }
    });
  }

  onForeground(): void {
    Log.info('onForeground');
  }

  onBackground(): void {
    Log.info('onBackground（进程内 Node 随应用存活，不做后台保活）');
  }

  /**
   * 用户从任务栏/托盘关闭应用时的回调（2in1 设备；需要 `ohos.permission.PREPARE_APP_TERMINATE`，
   * 本工程已在 `module.json5` 声明）。
   *
   * **返回值语义（SDK 原文，`@ohos.app.ability.UIAbility.d.ts:780-782`）**：
   *   - `true`  = 取消终止流程（应用留在前台）；
   *   - `false` = 继续终止。
   * ⇒ 本工程**返回 false**：进程内 Node 没有优雅退出路径（库契约 §2.6：`shutdown()` 只是标记 +
   *   触发 Node 侧钩子，`node::Start` 不返回），拦下终止只会把用户困在一个已经不响应的窗口里。
   *
   * 回调是**同步**的，而 `shutdown()` 是 Promise ⇒ 这里同步调用并挂 `.then/.catch` 打印结果，
   * 同时**先写一行同步日志**（退出路径上的日志可能是最后一条证据）。
   */
  onPrepareToTerminate(): boolean {
    try {
      Log.info('onPrepareToTerminate：通知运行时 shutdown（同步记录；真正停止只能是进程退出）');
      const runtime: PiDesktopRuntime = PiDesktopRuntime.getInstance();
      const report: string = 'onPrepareToTerminate：state=' + runtime.getState()
        + ' stage=' + runtime.getStage() + ' url=' + runtime.getUrlOrPending();
      Log.info(report);
      runtime.shutdown('onPrepareToTerminate').then((detail: string) => {
        Log.info('shutdown 结果：' + detail);
      }).catch((e: Object) => {
        Log.error('shutdown 调用异常：' + JSON.stringify(e));
      });
    } catch (e) {
      // 关停路径上的任何异常都不能反过来打断终止流程
      Log.error('onPrepareToTerminate 处理异常（仍然继续终止）：' + JSON.stringify(e));
    }
    // 不取消终止（返回 false 的依据见上方注释）；「请重启应用」的提示由错误页承担
    return false;
  }

  onDestroy(): void {
    // 进程内 Node 没有「优雅停止」接口（`node::Start` 不返回）：应用退出即整体结束。
    // 这里只记日志，不做假动作（也不假装 server.close() 被触发过）。
    const runtime: PiDesktopRuntime = PiDesktopRuntime.getInstance();
    Log.info('onDestroy：state=' + runtime.getState() + ' stage=' + runtime.getStage()
      + '（进程内 Node 随进程结束，无需也不能单独停止）');
  }
}
