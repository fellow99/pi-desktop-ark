import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { Log } from '../common/Constants';

/**
 * Pi Desktop V2 主 Ability。
 *
 * 起 Node 的时机（工程规划 §5.10 ⑪ / ⑫）：**先 `loadContent`，再起 Node**，
 * 且权限申请放在 `loadContent` 之后 —— 权限弹窗在无人点按的设备上会卡住启动屏（APP_INPUT_BLOCK）。
 * 本工程把「起 Node」放在页面里（`pages/Index`）执行，便于把状态直接画在界面上。
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

    let flags: string = '--no-verify-heap';
    const params: Record<string, Object> | undefined = want.parameters;
    if (params !== undefined) {
      const raw: Object | undefined = params['probeFlags'];
      if (raw !== undefined) {
        const s: string = raw as string;
        if (s.length > 0) {
          flags = s;
        }
      }
    }
    AppStorage.setOrCreate<string>('nodeFlags', flags);
    Log.info('onCreate flags=' + flags + ' filesDir=' + this.context.filesDir);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        Log.error('loadContent 失败: ' + JSON.stringify(err));
        return;
      }
      Log.info('loadContent ok');
    });
  }

  onForeground(): void {
    Log.info('onForeground');
  }

  onBackground(): void {
    Log.info('onBackground（进程内 Node 随应用存活，不做后台保活）');
  }

  onDestroy(): void {
    // TODO(Phase 3)：进程内 Node 没有"优雅停止"接口（node::Start 不返回），
    // 应用退出即整体结束。这里只记日志，不做假动作。
    Log.info('onDestroy');
  }
}
