import { window } from '@kit.ArkUI';
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { Log } from './Constants';

/**
 * 窗口**尺寸**记忆（行动项 §K.9 E12 / 工程规划 §5 第 7 条「先做『记忆尺寸』最小版」）。
 *
 * ## 为什么只记尺寸、不记位置
 *
 * `moveWindowTo()` 在 2in1 上属窗口摆放策略面（多显示器、吸附、系统记忆都会参与），
 * 而**尺寸**是纯应用侧收益、且失败无副作用。所以 v1 只做尺寸；位置记忆留到确认
 * `moveWindowTo` 语义之后（见 `docs/001-能力复刻评估.md` §K.9）。
 *
 * ## 纪律
 *
 * - **绝不阻断启动**：所有 `window`/`preferences` 调用都包 try/catch，失败只记日志。
 * - **取值范围校验**：恢复前把宽高钳到合理区间，避免把坏值写回去后窗口不可见。
 * - **只写「用户改过的」**：只监听 `windowSizeChange`，不在启动时回写（否则会把默认尺寸
 *   当成用户选择固化下来）。
 * - **节流**：拖动窗口会连续触发事件，300 ms 内的多次变更只落一次盘。
 */
const STORE_NAME: string = 'pi-window-state';
const KEY_SIZE: string = 'lastSize';
/** 合理区间：比这更小的窗口没有可用性，比这更大的多半是坏值 */
const MIN_W: number = 480;
const MIN_H: number = 360;
const MAX_W: number = 8000;
const MAX_H: number = 5000;
/** 尺寸变更落盘节流窗口（毫秒） */
const SAVE_DEBOUNCE_MS: number = 300;

/** 持久化用的最小结构（不存 rect 全量：位置不由本版本恢复） */
class SavedSize {
  width: number = 0;
  height: number = 0;
}

export class WindowState {
  /** 上次落盘时间（节流用；0 = 尚未写过） */
  private static lastSavedAt: number = 0;
  /** 最近一次待写的尺寸（节流窗口内的最后一次） */
  private static pending: SavedSize | null = null;
  /** 节流定时器（只用于把「最后一次」补写下去） */
  private static timer: number = -1;

  private static store(context: common.UIAbilityContext): preferences.Preferences | null {
    try {
      return preferences.getPreferencesSync(context, { name: STORE_NAME });
    } catch (e) {
      Log.warn('窗口状态：打开 preferences 失败（本次不记忆尺寸）：' + JSON.stringify(e));
      return null;
    }
  }

  private static clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    const rounded: number = Math.round(value);
    if (rounded < min) {
      return min;
    }
    if (rounded > max) {
      return max;
    }
    return rounded;
  }

  /**
   * 应用已保存的尺寸（若有）。
   * @returns 人读结果串（同时进日志；测试与诊断面板可断言）
   */
  static restore(windowStage: window.WindowStage, context: common.UIAbilityContext): string {
    const prefs: preferences.Preferences | null = WindowState.store(context);
    if (prefs === null) {
      return 'skip:no-prefs';
    }
    let raw: string = '';
    try {
      const value: preferences.ValueType = prefs.getSync(KEY_SIZE, '');
      raw = typeof value === 'string' ? value as string : '';
    } catch (e) {
      Log.warn('窗口状态：读取失败（用系统默认尺寸）：' + JSON.stringify(e));
      return 'skip:read-error';
    }
    if (raw.length === 0) {
      Log.info('窗口状态：无历史记录，使用系统默认尺寸');
      return 'skip:no-record';
    }
    let saved: SavedSize;
    try {
      saved = JSON.parse(raw) as SavedSize;
    } catch (e) {
      Log.warn('窗口状态：历史值不是合法 JSON，忽略：' + raw);
      return 'skip:bad-json';
    }
    const width: number = WindowState.clamp(saved.width, MIN_W, MAX_W);
    const height: number = WindowState.clamp(saved.height, MIN_H, MAX_H);
    try {
      const win: window.Window = windowStage.getMainWindowSync();
      win.resize(width, height).then(() => {
        Log.info('窗口状态：已恢复尺寸 ' + width + '×' + height);
      }).catch((e: Object) => {
        Log.warn('窗口状态：resize 失败（保持系统默认尺寸）：' + JSON.stringify(e));
      });
      return 'restore:' + width + 'x' + height;
    } catch (e) {
      Log.warn('窗口状态：取主窗口失败（保持系统默认尺寸）：' + JSON.stringify(e));
      return 'skip:no-window';
    }
  }

  /**
   * 监听尺寸变更并节流落盘。**只写用户真的改过的尺寸**。
   */
  static watch(windowStage: window.WindowStage, context: common.UIAbilityContext): void {
    try {
      const win: window.Window = windowStage.getMainWindowSync();
      win.on('windowSizeChange', (size: window.Size) => {
        const next: SavedSize = new SavedSize();
        next.width = WindowState.clamp(size.width, MIN_W, MAX_W);
        next.height = WindowState.clamp(size.height, MIN_H, MAX_H);
        WindowState.pending = next;
        const now: number = Date.now();
        if (now - WindowState.lastSavedAt >= SAVE_DEBOUNCE_MS) {
          WindowState.flush(context);
          return;
        }
        if (WindowState.timer >= 0) {
          clearTimeout(WindowState.timer);
        }
        WindowState.timer = setTimeout(() => {
          WindowState.timer = -1;
          WindowState.flush(context);
        }, SAVE_DEBOUNCE_MS);
      });
      Log.info('窗口状态：已开始监听 windowSizeChange（节流 ' + SAVE_DEBOUNCE_MS + ' ms）');
    } catch (e) {
      Log.warn('窗口状态：注册 windowSizeChange 失败（不记忆尺寸）：' + JSON.stringify(e));
    }
  }

  /** 把 pending 写盘（同步 put + 异步 flush；失败只记日志） */
  static flush(context: common.UIAbilityContext): void {
    const pending: SavedSize | null = WindowState.pending;
    if (pending === null) {
      return;
    }
    const prefs: preferences.Preferences | null = WindowState.store(context);
    if (prefs === null) {
      return;
    }
    WindowState.lastSavedAt = Date.now();
    WindowState.pending = null;
    const payload: string = JSON.stringify(pending);
    try {
      prefs.putSync(KEY_SIZE, payload);
      prefs.flush().then(() => {
        Log.info('窗口状态：已保存 ' + payload);
      }).catch((e: Object) => {
        Log.warn('窗口状态：flush 失败（下次尺寸变更会重试）：' + JSON.stringify(e));
      });
    } catch (e) {
      Log.warn('窗口状态：写入失败：' + JSON.stringify(e));
    }
  }
}
