/**
 * crop-rules.mjs —— 载荷裁剪规则（**数据**，不是过程）。
 *
 * 为什么单独成文件：裁剪是**有代价的**动作（删错一项 Next 就起不来），所以规则必须
 * ①可读（人能一条条审）、②可被脚本与评审复用（`assemble-payload.mjs` 只做执行）、
 * ③带证据标记（哪条是实测、哪条还只是规划里的估计）。本文件因此**只导出数据 + 纯匹配函数**，
 * 不做任何 IO。
 *
 * 依据两条线：
 *   ① `docs/000-工程规划.md` §7.2（体积与裁剪表，✅ 本机 `du -sb` 实测值）与 §12.2（O1/O2）；
 *   ② **已跑通的 `pi-desktop-hos` 实现**（本工程的对齐基线）：
 *      `pi-desktop-hos/scripts/prepare-next.mjs:29-31`（KEEP_PATH_MARKERS / `\.node$` 原生件判据）、
 *      `:262-268`（两条硬教训：删 `@next/swc-win32-*` ⇒ Next 首启联网补下 34 MB、启动 2 s→6 s；
 *      下一次 `next build` 会把 `@img/sharp-*` / `@tailwindcss/oxide-*` 原样装回 ⇒ **裁剪只能在打包期
 *      对副本做**）、`:274-298`（保留纯 JS 包 undici / web-push / @earendil-works，node-pty 的
 *      `prebuilds/<platform>/` 形态）。
 *
 * 证据标记口径（沿用工程规划 §0.2）：
 *   ✅ 实测 · 🔶 沿用 · ⬜ 待验证 · ⚠️ 冲突/风险
 *
 * ⚠️ 纪律：**规则只描述「删什么」，不描述「为什么安全」的乐观结论**。凡是还没在真机上复核的，
 * 这里照旧标 ⬜ —— 裁剪脚本不会把它们偷偷升级成「已验证」。
 */

/** 规则种类：`glob` = 相对**源根**的路径通配；本工程目前只用这一种，留字段以便将来扩展 */
export const CROP_KINDS = Object.freeze(['glob']);

/**
 * 运行期要保留的平台标记（**逐字取自 `pi-desktop-hos/scripts/prepare-next.mjs:29`**）。
 * 语义：相对路径（小写）里出现任一子串 ⇒ 视为「目标平台可用的原生件」，规则不得命中。
 * 注意它是**子串启发式**，会误判（例如 `darwin-arm64` / `win32-arm64` 也含 `arm64`）——
 * 因此需要精确列举的规则（node-pty prebuilds）改为按实测目录清单裁剪，并在规则里写清原因。
 */
export const KEEP_PATH_MARKERS = Object.freeze(['linux-arm64', 'arm64', 'ohos']);

/** 平台原生件判定（`pi-desktop-hos/scripts/prepare-next.mjs:31` 同值）：`*.node` */
export const NATIVE_EXT = /\.node$/i;

/**
 * 纯 JS 依赖（`pi-desktop-hos/scripts/prepare-next.mjs:279-280` 明示「§8.2 不许删」）。
 * platform-native 规则必须跳过它们：这些包里即便出现过 `.node` 也是可选加速件，
 * 删掉父目录会连带删掉 JS 入口（历史上就是这么把 `@earendil-works/*` 删出问题的）。
 */
export const PURE_JS_PREFIXES = Object.freeze([
  'node_modules/undici/',
  'node_modules/web-push/',
  'node_modules/@earendil-works/'
]);

/**
 * @typedef {Object} CropRule
 * @property {string}   id                  稳定标识（脚本输出 / JSON 报告里的键）
 * @property {string}   kind                `glob`
 * @property {string}   pattern             相对源根的 glob（`**` 跨段，`*`/`?` 段内）
 * @property {string[]} keep                在同一规则下的**保留白名单**（glob；命中即不裁）
 * @property {string[]} [keepPathMarkers]   按 KEEP_PATH_MARKERS 子串保留（大小写不敏感）
 * @property {string[]} [skipPrefixes]      这些前缀一律不裁（纯 JS 包，见 PURE_JS_PREFIXES）
 * @property {string[]} [expectOverlapWith] 预期会与这些规则同时命中的 id（计数归第一条；不算告警）
 * @property {string}   reason              为什么可以裁（人读；含「裁了会怎样」）
 * @property {number}   expectedFiles       规划/实测的期望文件数（-1 = 未知/与环境相关）
 * @property {number}   expectedSavingBytes 规划/实测的期望字节数（-1 = 未知/与环境相关）
 * @property {string}   evidence            证据标记 + 出处（✅/🔶/⬜/⚠️ 开头）
 * @property {string}   planRef             工程规划章节锚点
 * @property {string}   prepareRef          pi-desktop-hos 对齐锚点（prepare-next.mjs 行号）
 * @property {boolean}  safeByDefault       不做真机验证也敢裁？（false ⇒ 必须真机复核，属 O1/O2）
 */

/** @type {CropRule[]} */
export const CROP_RULES = [
  {
    id: 'next-nft-json',
    kind: 'glob',
    pattern: '.next/**/*.nft.json',
    // 没有保留白名单：这条规则删的就是「文件追踪清单」本身（内含宿主 Windows 绝对路径）。
    keep: [],
    reason:
      'Next 的 output-file-trace 清单（内含构建宿主的 C:/Program Files/WindowsApps/… 绝对路径，'
      + '在设备上无意义）。本机实测 76 个文件里 5 个是 67 MB 级（.next/server/app/api/**/route.js.nft.json），'
      + '是本次裁剪的**最大头**。运行期是否读它**未证实**：规划把它列为开放问题 O1，'
      + '要求「删除后真机起服务」才算通过。',
    expectedFiles: 76,
    expectedSavingBytes: 348096301,
    evidence: '✅ 体积本机实测（76 文件 / 348,096,301 B）/ ⬜ 可删性待真机验证',
    planRef: 'docs/000-工程规划.md §7.2 第 1 行 · §12.2 O1',
    prepareRef: 'pi-desktop-hos/scripts/prepare-next.mjs 未涉及（Next 自有产物）；collect-pi.mjs:7 的 ustar 结论同理',
    safeByDefault: false
  },
  {
    id: 'next-swc-win32',
    kind: 'glob',
    // 精确到「宿主平台的原生 SWC 包」：`@next/swc-win32-x64-msvc` 这类整包删除。
    pattern: 'node_modules/@next/*win32*/**',
    keep: [],
    // 下面的 next-swc-native 会同时命中，platform-native 也会 —— 都是预期重叠，不当作规则冲突。
    expectOverlapWith: ['next-swc-native', 'platform-native'],
    reason:
      '宿主 Windows 平台的 SWC 原生二进制（`next-swc.win32-x64-msvc.node`，106 MB）。设备是 arm64-ohos，'
      + '这个文件永远加载不了。'
      + '⚠️ prepare-next.mjs:262-266 的两条硬教训正是指它：'
      + '① 曾经删掉 `@next/swc-win32-x64-msvc` ⇒ `next start` 首启打印 `Downloading swc package …`，'
      + '从 registry 拉 34 MB 到 LOCALAPPDATA，启动 2 s→6 s；本工程设备**离线**（PI_OFFLINE=1）且无 npm，'
      + '这条下载必然失败/超时 ⇒ 所以裁剪必须在**打包期对副本**做一次、载荷不得再触发补装；'
      + '② 下一次 `next build` 会把这类 optionalDependencies 原样装回源目录 ⇒ 对源目录删除无效。'
      + '端上 SWC 只能走 WASM 版 ⇒ 前提：node_modules/next/wasm/@next/swc-wasm-nodejs/ 在位（见下一条的 keep）。',
    expectedFiles: 3,
    expectedSavingBytes: 106191877,
    evidence: '✅ 体积本机实测（swc-win32-x64-msvc 3 文件 / 106,191,877 B，其中 .node 106,191,360 B）'
      + ' / ✅ prepare-next.mjs:262-266 的 dsh 实测（删后联网补装、启动翻倍）'
      + ' / ⬜ 端上只用 WASM SWC 待真机复核（§12.2 O2）',
    planRef: 'docs/000-工程规划.md §7.2 第 2 行 · §12.2 O2',
    prepareRef: 'pi-desktop-hos/scripts/prepare-next.mjs:262-266',
    safeByDefault: false
  },
  {
    id: 'next-swc-native',
    kind: 'glob',
    // 通用形态：将来在别的宿主上构建会出现 darwin-* / linux-* 的原生 SWC 包。
    // ⚠️ 只裁 `@next/swc-*`，**不**裁整个 `@next/`：`@next/env` 是纯 JS 运行时模块，
    // `next/dist` 里有 14 个文件 require('@next/env')（含 server/config.js）。
    // 上一轮把 pattern 写成 `node_modules/@next/**` 的实测后果：真机 app.log 里
    // `Cannot find module '@next/env'` ⇒ 候选入口全部启动失败，pi-web 起不来。
    pattern: 'node_modules/@next/swc-*/**',
    // ⚠️ 硬保留项：设备侧 SWC 只能走 WASM 版。wasm 版**不在**本 pattern 之下
    // （它落在 node_modules/next/wasm/@next/…），这里显式写出来是为了让「保留」在数据里可见、可被 assertKeepSound() 审计。
    keep: ['node_modules/next/wasm/**'],
    expectOverlapWith: ['next-swc-win32', 'platform-native'],
    reason:
      '`@next/swc-*` 下是按平台编译的原生 SWC 二进制。设备无对应原生件，Next 在端上只会用 WASM 版。'
      + '本机这一族在 @next 下只有 win32 一份（已由前一条规则 next-swc-win32 先计数），本条覆盖将来出现的'
      + 'darwin/linux 平台包 ⇒ 本环境命中集为 0 属正常。',
    expectedFiles: -1,
    expectedSavingBytes: -1,
    evidence: '✅ 体积本机实测（@next 共 7 文件 / 106,203,772 B；其中原生 .node 106,191,360 B）'
      + ' / ✅ 真机实测：删 @next/env ⇒ Cannot find module（2026-10-17 app.log）'
      + ' / 🔶 端上只用 WASM SWC（规划 §8.2）/ ⬜ O2 待真机',
    planRef: 'docs/000-工程规划.md §7.2 第 2 行 · §12.2 O2',
    prepareRef: 'pi-desktop-hos/scripts/prepare-next.mjs:29-31（保留口径）、:274-285（原生件盘点）',
    safeByDefault: false
  },
  {
    id: 'img-sharp',
    kind: 'glob',
    pattern: 'node_modules/@img/**',
    keep: [],
    expectOverlapWith: ['platform-native'],
    reason:
      'sharp 及其平台件（服务端图片优化用）：本机为 `@img/sharp-win32-x64/lib/libvips-42.dll`（19 MB）、'
      + '`@img/sharp-wasm32/*`（9.1 MB）与纯 JS 的 `@img/colour`。**只有**在 next.config 里 '
      + 'images.unoptimized = true 时服务端才不需要它；本工程沿用旧壳的 pi-web 产物构建配置，'
      + '该开关由上游产物决定 ⇒ 裁剪后必须核对（真机 O2）。'
      + '⚠️ prepare-next.mjs:267-268 实测：下一次 `next build` 会把 `@img/sharp-*` 装回源目录，'
      + '所以裁剪只能在打包期对**副本**做。',
    expectedFiles: 20,
    expectedSavingBytes: 28767609,
    evidence: '✅ 体积本机实测（20 文件 / 28,767,609 B）'
      + ' / ⚠️ 依赖 images.unoptimized = true（未逐包核对）'
      + ' / ✅ prepare-next.mjs:267-268 的「build 会装回」实测',
    planRef: 'docs/000-工程规划.md §7.2 第 3 行',
    prepareRef: 'pi-desktop-hos/scripts/prepare-next.mjs:267-268',
    safeByDefault: false
  },
  {
    id: 'tailwind-oxide',
    kind: 'glob',
    // 覆盖 `@tailwindcss/oxide`（JS 包装）与 `@tailwindcss/oxide-<platform>-<arch>`（原生扫描器）
    pattern: 'node_modules/@tailwindcss/oxide*/**',
    keep: [],
    expectOverlapWith: ['platform-native'],
    reason:
      'Tailwind v4 的原生扫描器（宿主平台 .node），只在**构建期**被 tailwindcss 的 postcss 插件使用；'
      + '运行期 Next 只发预构建好的 CSS，不需要它。prepare-next.mjs:267-268 实测这类包会被下一次 '
      + '`next build` 装回 ⇒ 同样只能打包期裁。'
      + '⬜ 本 pi-dist **不含**该目录（实测 0 文件）：规则保留的目的是「以后出现也一定被裁」，'
      + '并让报告里能看见这条规则的命中数（0 也算证据）。',
    expectedFiles: 0,
    expectedSavingBytes: 0,
    evidence: '⬜ 本机 pi-dist 实测无该目录（0 文件）/ ✅ prepare-next.mjs:267-268 的「build 会装回」实测',
    planRef: 'docs/000-工程规划.md §7.2（原生件口径）',
    prepareRef: 'pi-desktop-hos/scripts/prepare-next.mjs:267-268',
    safeByDefault: true
  },
  {
    id: 'node-pty-prebuilds',
    kind: 'glob',
    // prepare-next.mjs:287-298 的 `prebuilds/<platform>/` 形态。
    pattern: 'node_modules/node-pty/prebuilds/*/**',
    // ⚠️ 这里**刻意不用** KEEP_PATH_MARKERS：它是子串启发式，会把 `darwin-arm64` / `win32-arm64`
    // 误判成「目标平台可用」。本机实测目录只有 darwin-arm64 / darwin-x64 / win32-arm64 / win32-x64，
    // **没有** ohos / linux-arm64 ⇒ 全部对设备无效，按实测清单裁。
    keep: [],
    expectOverlapWith: ['node-pty'],
    reason:
      'node-pty 的按平台预编译件：win32 的 conpty.dll / OpenConsole.exe / *.pdb，darwin 的 spawn-helper。'
      + '设备是 arm64-ohos（ELF），这些一个都加载不了；PTY 本身在平台上也不可用（SELinux，规划 §8.4）。'
      + '本规则单独存在是为了让「prebuilds/<platform>/」这一族的字节数在报告里可见（对齐 prepare-next.mjs 的形状）。',
    expectedFiles: 10,
    expectedSavingBytes: 23232544,
    evidence: '✅ 体积本机实测（10 文件 / 23,232,544 B；目录 = darwin-arm64,darwin-x64,win32-arm64,win32-x64）'
      + ' / ✅ 平台级不可用（规划 §8.4 PTY 行）',
    planRef: 'docs/000-工程规划.md §7.2 第 4 行 · §8.4',
    prepareRef: 'pi-desktop-hos/scripts/prepare-next.mjs:287-298',
    safeByDefault: true
  },
  {
    id: 'node-pty',
    kind: 'glob',
    pattern: 'node_modules/node-pty/**',
    keep: [],
    expectOverlapWith: ['node-pty-prebuilds'],
    reason:
      'PTY 在本平台**不可用**（SELinux），包内除了 prebuilds/ 之外只剩 win32 的 conpty 残留与 JS 包装；'
      + '整包裁掉最干净（prebuilds 由前一条规则先计数，这里记剩余部分）。'
      + '规划把「终端/PTY」列入非目标（§0.3 / §8.4）。',
    expectedFiles: 33,
    expectedSavingBytes: 3699358,
    evidence: '✅ 体积本机实测（整包 43 文件 / 26,931,902 B = prebuilds 10/23,232,544 + 其余 33/3,699,358）'
      + ' / ✅ 平台级不可用（规划 §8.4 PTY 行）',
    planRef: 'docs/000-工程规划.md §7.2 第 4 行 · §8.4',
    prepareRef: 'pi-desktop-hos/scripts/prepare-next.mjs:287-298（同族判定）',
    safeByDefault: true
  },
  {
    id: 'platform-native',
    kind: 'glob',
    // 通用兜底：任何 `*.node` 原生件（NATIVE_EXT 同口径），除非命中平台标记或落在纯 JS 包里。
    pattern: 'node_modules/**/*.node',
    keep: [],
    keepPathMarkers: KEEP_PATH_MARKERS,
    skipPrefixes: PURE_JS_PREFIXES,
    expectOverlapWith: ['next-swc-win32', 'next-swc-native', 'img-sharp', 'tailwind-oxide'],
    reason:
      'prepare-next.mjs:29-31 的原生件判据（`\\.node$` + KEEP_PATH_MARKERS）与 :274-285 的保留口径'
      + '（undici / web-push / @earendil-works 一律跳过）。本机唯一 `.node` 已被 next-swc-win32 先计数 ⇒ '
      + '本规则在本环境命中 0 文件；它的作用是兜住以后新增的宿主平台原生件'
      + '（prepare-next.mjs:267-268 提到的 @unrs/resolver-binding-* / lightningcss-* 就是这一类）。',
    expectedFiles: -1,
    expectedSavingBytes: -1,
    evidence: '✅ 判据来自 prepare-next.mjs:29-31（本机 `*.node` 共 1 个 / 106,191,360 B，已归 next-swc-win32）'
      + ' / 🔶 保留标记与纯 JS 跳过口径沿用 dsh / ⬜ 新增平台件的可删性待复核（O2）',
    planRef: 'docs/000-工程规划.md §7.2（原生件口径）· §12.2 O2',
    prepareRef: 'pi-desktop-hos/scripts/prepare-next.mjs:29-31, :274-285',
    safeByDefault: false
  }
];

/**
 * 把 glob 编译成正则源（`**` 跨段 / `*`、`?` 段内）。
 *
 * 刻意**不**支持 `{a,b}` 与 `[0-9]`：规则文件只需这四种写法，少一种语法就少一处歧义。
 * @param {string} pattern
 * @returns {string} 正则源（含 `^`/`$`）
 */
export function globToRegExpSource(pattern) {
  const segments = String(pattern).split('/');
  let source = '^';
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    if (segment === '**') {
      source += isLast ? '.*' : '(?:[^/]+/)*';
      return;
    }
    let part = '';
    for (const char of segment) {
      if (char === '*') part += '[^/]*';
      else if (char === '?') part += '[^/]';
      else part += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    source += part;
    if (!isLast) source += '/';
  });
  return source + '$';
}

/** @param {string} pattern */
export function globToRegExp(pattern) {
  return new RegExp(globToRegExpSource(pattern));
}

/**
 * 单看 pattern 是否命中（**不含白名单判定**）。
 *
 * 存在意义：脚本要能把「被规则命中但被白名单保住」的文件单独列出来给评审看
 * （否则「保留」这件事在报告里不可见）。**裁剪与否必须用 `ruleMatchesFile`。**
 * @param {string} pattern
 * @param {string} relPath
 */
export function patternHits(pattern, relPath) {
  return globToRegExp(pattern).test(relPath);
}

/** 规则 pattern 去掉尾部 `/**` 后的目录前缀（用于整目录裁剪）；无该尾缀则返回 `null`。 */
function ruleDirectoryPrefix(rule) {
  const suffix = '/**';
  return rule.pattern.endsWith(suffix) ? rule.pattern.slice(0, -suffix.length) : null;
}

/** 路径是否带某个平台标记（大小写不敏感的子串判定，与 prepare-next 同口径） */
function hasKeepMarker(relPath, markers) {
  if (!markers || markers.length === 0) return false;
  const lower = String(relPath).toLowerCase();
  return markers.some((marker) => lower.includes(String(marker).toLowerCase()));
}

/**
 * 单个**文件**是否被该规则裁掉（相对路径一律用 `/` 分隔）。
 *
 * 判定顺序（先保留、后裁剪）：platform 标记 → skipPrefixes（纯 JS 包）→ keep glob → pattern。
 * @param {string} relPath
 * @param {CropRule} rule
 */
export function ruleMatchesFile(relPath, rule) {
  if (!globToRegExp(rule.pattern).test(relPath)) return false;
  if (hasKeepMarker(relPath, rule.keepPathMarkers)) return false;
  if (rule.skipPrefixes) {
    for (const prefix of rule.skipPrefixes) {
      if (relPath.startsWith(prefix)) return false;
    }
  }
  for (const keepPattern of rule.keep) {
    if (globToRegExp(keepPattern).test(relPath)) return false;
  }
  return true;
}

/**
 * 单个**目录**是否被该规则整目录裁掉（`node_modules/@img/**` ⇒ `node_modules/@img` 本身）。
 * 命中的目录必须**不再向下遍历**（否则会把白名单里的东西也一起删掉）。
 * @param {string} relDir
 * @param {CropRule} rule
 */
export function ruleMatchesDir(relDir, rule) {
  const prefix = ruleDirectoryPrefix(rule);
  if (prefix === null) return false;
  if (relDir !== prefix) return false;
  if (hasKeepMarker(relDir, rule.keepPathMarkers)) return false;
  if (rule.skipPrefixes) {
    for (const skip of rule.skipPrefixes) {
      if (`${relDir}/`.startsWith(skip)) return false;
    }
  }
  // 目录级裁剪与白名单冲突时，**保留**（白名单优先；由 assertKeepSound 在启动时兜底报错）
  for (const keepPattern of rule.keep) {
    if (globToRegExp(keepPattern).test(relDir)) return false;
  }
  return true;
}

/**
 * 命中任一规则的第一个规则（用于把「被裁掉的字节」归到唯一一条规则上，避免重复计数）。
 * @param {string} relPath
 * @returns {CropRule | null}
 */
export function firstMatchingRule(relPath) {
  for (const rule of CROP_RULES) {
    if (ruleMatchesFile(relPath, rule)) return rule;
  }
  return null;
}

/**
 * 两条规则的「同时命中」是否属于**预期**（后一条规则声明了 expectOverlapWith）。
 * 预期重叠不当作规则冲突告警，但报告里仍会打印说明。
 * @param {string} firstId 计数归属的规则（matches[0]）
 * @param {string} otherId 另一条同时命中的规则
 */
export function isExpectedOverlap(firstId, otherId) {
  const other = CROP_RULES.find((rule) => rule.id === otherId);
  if (!other || !other.expectOverlapWith) return false;
  return other.expectOverlapWith.includes(firstId);
}

/**
 * 规则自审（在脚本启动时调用）：
 *   ① 白名单必须**不可能**被任何规则命中（否则「保留」只是注释级的承诺）；
 *   ② 保留标记 / 纯 JS 跳过项必须真的被 matcher 排除（抽样断言，不信注释）。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function assertKeepSound() {
  const problems = [];
  for (const rule of CROP_RULES) {
    for (const keepPattern of rule.keep) {
      const prefix = ruleDirectoryPrefix(rule);
      if (prefix !== null && keepPattern.startsWith(prefix + '/')) {
        // 落在规则目录之下是预期情形 —— 报告出来，让人确认 matcher 真的排除了它
        problems.push(
          `${rule.id}: keep "${keepPattern}" 落在规则目录 "${prefix}/" 之内（靠 ruleMatchesFile 的排除生效，请保持该分支存在）`
        );
      }
    }
    for (const marker of rule.keepPathMarkers || []) {
      const sample = `node_modules/demo-${marker}/native.node`;
      if (ruleMatchesFile(sample, rule)) {
        problems.push(`${rule.id}: keepPathMarkers "${marker}" 未生效（${sample} 仍被判为可裁）`);
      }
    }
    for (const prefix of rule.skipPrefixes || []) {
      const sample = `${prefix}dummy.node`;
      if (ruleMatchesFile(sample, rule)) {
        problems.push(`${rule.id}: skipPrefixes "${prefix}" 未生效（${sample} 仍被判为可裁）`);
      }
    }
  }
  return problems;
}

/** 规则清单的简短文本（脚本与文档都用它，避免两处写死） */
export function describeRules() {
  return CROP_RULES.map((r) => `${r.id}: ${r.pattern} ← ${r.planRef}｜${r.prepareRef}`).join('\n');
}
