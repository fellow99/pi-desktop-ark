/**
 * crop-rules.mjs —— 载荷裁剪规则（**数据**，不是过程）。
 *
 * 为什么单独成文件：裁剪是**有代价的**动作（删错一项 Next 就起不来），所以规则必须
 * ①可读（人能一条条审）、②可被脚本与评审复用（`assemble-payload.mjs` 只做执行）、
 * ③带证据标记（哪条是实测、哪条还只是规划里的估计）。本文件因此**只导出数据 + 纯匹配函数**，
 * 不做任何 IO。
 *
 * 依据：`docs/000-工程规划.md` §7.2（体积与裁剪表，✅ 本机 `du -sb` 实测值）与
 * §12.2 开放问题 O1/O2（⬜ 待真机验证的两条）。
 *
 * 证据标记口径（沿用工程规划 §0.2）：
 *   ✅ 实测 · 🔶 沿用 · ⬜ 待验证 · ⚠️ 冲突/风险
 *
 * ⚠️ 纪律：**规则只描述「删什么」，不描述「为什么安全」的乐观结论**。凡是规划里标 ⬜ 的
 * （`.nft.json`、win32 SWC），这里照旧标 ⬜ —— 裁剪脚本不会把它们偷偷升级成「已验证」。
 */

/** 规则种类：`glob` = 相对**源根**的路径通配；本工程目前只用这一种，留字段以便将来扩展 */
export const CROP_KINDS = Object.freeze(['glob']);

/**
 * @typedef {Object} CropRule
 * @property {string}   id                  稳定标识（脚本输出 / JSON 报告里的键）
 * @property {string}   kind                `glob`
 * @property {string}   pattern             相对源根的 glob（`**` 跨段，`*`/`?` 段内）
 * @property {string[]} keep                在同一规则下的**保留白名单**（命中即不裁；见下方 assertKeepSound）
 * @property {string}   reason              为什么可以裁（人读；含「裁了会怎样」）
 * @property {number}   expectedFiles       规划/实测的期望文件数（-1 = 未知）
 * @property {number}   expectedSavingBytes 规划/实测的期望字节数（-1 = 未知）
 * @property {string}   evidence            证据标记 + 出处（✅/🔶/⬜/⚠️ 开头）
 * @property {string}   planRef             工程规划章节锚点
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
      + '在设备上无意义）。运行期是否读它**未证实**：规划把它列为开放问题 O1，'
      + '要求「删除后真机起服务」才算通过。',
    expectedFiles: 76,
    expectedSavingBytes: 348096301,
    evidence: '✅ 体积本机实测（du -sb）/ ⬜ 可删性待真机验证',
    planRef: 'docs/000-工程规划.md §7.2 第 1 行 · §12.2 O1',
    safeByDefault: false
  },
  {
    id: 'next-swc-native',
    kind: 'glob',
    pattern: 'node_modules/@next/**',
    // ⚠️ 唯一的硬保留项：设备侧 SWC 只能走 WASM 版。
    // 注意 wasm 版**不在**本规则的 pattern 之下（它落在 node_modules/next/wasm/@next/…），
    // 这里显式写出来是为了让「保留」这件事在数据里可见、可被 assertKeepSound() 审计。
    keep: ['node_modules/next/wasm/**'],
    reason:
      'node_modules/@next 下全是**按平台编译的原生 SWC 二进制**（win32/darwin/linux 的 .node 件）。'
      + '设备是 arm64-ohos，没有对应的原生件，Next 在端上只会用 WASM 版 SWC；'
      + '旧壳「故意保留」只是为了避开「删了 Next 会联网补下载」——本工程 PI_OFFLINE=1 且设备无 npm，'
      + '联网补下载这条路本来就不通。⇒ 前提：node_modules/next/wasm/@next/swc-wasm-nodejs/ 在位。',
    expectedFiles: -1,
    expectedSavingBytes: 106203772,
    evidence: '✅ 体积本机实测 / 🔶 设备侧只用 WASM SWC（旧壳工程规划 R6）/ ⬜ 删后是否仍走 WASM 待真机（O2）',
    planRef: 'docs/000-工程规划.md §7.2 第 2 行 · §12.2 O2',
    safeByDefault: false
  },
  {
    id: 'img-sharp',
    kind: 'glob',
    pattern: 'node_modules/@img/**',
    keep: [],
    reason:
      'sharp 及其 libvips 平台原生件（服务端图片优化用）。**只有**在 next.config 里 '
      + 'images.unoptimized = true 时服务端才不需要它；本工程沿用旧壳的 pi-web 产物构建配置，'
      + '该开关由上游产物决定 ⇒ 裁剪前后必须核对。',
    expectedFiles: -1,
    expectedSavingBytes: 28767709,
    evidence: '✅ 体积本机实测 / ⚠️ 依赖 images.unoptimized = true（未逐包核对）',
    planRef: 'docs/000-工程规划.md §7.2 第 3 行',
    safeByDefault: false
  },
  {
    id: 'node-pty',
    kind: 'glob',
    pattern: 'node_modules/node-pty/**',
    keep: [],
    reason:
      'PTY 在本平台**不可用**（SELinux），且残留物是 win32 的 conpty.dll / OpenConsole.exe —— '
      + '对设备完全无意义。规划把「终端/PTY」列入非目标（§0.3 / §8.4）。',
    expectedFiles: -1,
    expectedSavingBytes: 26931902,
    evidence: '✅ 体积本机实测 / ✅ 平台级不可用（规划 §8.4 PTY 行）',
    planRef: 'docs/000-工程规划.md §7.2 第 4 行 · §8.4',
    safeByDefault: true
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

/**
 * 单个**文件**是否被该规则裁掉（相对路径一律用 `/` 分隔）。
 * @param {string} relPath
 * @param {CropRule} rule
 */
export function ruleMatchesFile(relPath, rule) {
  if (!globToRegExp(rule.pattern).test(relPath)) return false;
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
 * 规则自审（在脚本启动时调用）：白名单必须**不可能**被任何规则命中，
 * 否则「保留」只是注释级的承诺（真删的时候照样删）。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function assertKeepSound() {
  const problems = [];
  for (const rule of CROP_RULES) {
    for (const keepPattern of rule.keep) {
      // 白名单与规则 pattern 有交集 ⇒ 白名单形同虚设（必须显式在 matcher 里排除，见 ruleMatchesFile）
      const prefix = ruleDirectoryPrefix(rule);
      if (prefix !== null && keepPattern.startsWith(prefix + '/')) {
        // 落在规则目录之下是预期情形 —— 报告出来，让人确认 matcher 真的排除了它
        problems.push(
          `${rule.id}: keep "${keepPattern}" 落在规则目录 "${prefix}/" 之内（靠 ruleMatchesFile 的排除生效，请保持该分支存在）`
        );
      }
    }
  }
  return problems;
}

/** 规则清单的简短文本（脚本与文档都用它，避免两处写死） */
export function describeRules() {
  return CROP_RULES.map((r) => `${r.id}: ${r.pattern} ← ${r.planRef}`).join('\n');
}
