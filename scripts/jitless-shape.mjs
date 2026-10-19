/**
 * jitless-shape.mjs —— 108-jitless 的**组装期**载荷改造（零依赖，ESM）。
 *
 * 为什么放在组装期而不是运行期改文件：
 *   · `next.config.ts` 必须在 Next 启动前就不存在（否则 Next 启动期会走 SWC-WASM 转译）；
 *     运行期改写载荷树会改变归档的幂等键（sha256 变 ⇒ 每次冷启都重新解包）；
 *   · `undici` / `photon` 的替换点唯一且稳定：`package.json#main`。组装期只做一次，
 *     运行期只剩一个 `typeof WebAssembly === 'undefined'` 的分支。
 *
 * 纪律：
 *   · **只写传入的暂存目录**，源目录（`pi-dist`）一个字节都不碰；
 *   · 每步都能被审计（打印"改了哪个包、为什么、原 main 是什么"）；
 *   · 任何一步失败都抛错 —— 宁可组装失败，也不产出「看起来打了包」的坏归档。
 *
 * 依据与决策记录：`docs/108-jitless-方案决策.md`、`specs/108-jitless/plan.md` §2.3。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** 条件入口文件名（写进各包的 `main`） */
export const JITLESS_ENTRY_FILE = 'pi-jitless-entry.cjs';

/** 各包**必须**有的具名导出（compat 形态下垫片一定实现）。其余导出允许为 undefined，但会进报告。 */
const REQUIRED_EXPORTS = {
  undici: [
    'install', 'fetch', 'setGlobalDispatcher', 'getGlobalDispatcher',
    'Client', 'Pool', 'Agent', 'Dispatcher', 'EnvHttpProxyAgent',
    'Headers', 'Request', 'Response', 'FormData', 'errors'
  ],
  photon: ['PhotonImage', 'resize', 'fliph', 'flipv', 'SamplingFilter']
};

const requireFromHere = createRequire(import.meta.url);

/**
 * 找 `typescript`（用于把 `next.config.ts` 编译成 `.mjs`）。
 * 顺序：同级 `../pi-web/node_modules/typescript`（上游源码树）→ 本工程。
 */
export function resolveTypeScript(projectRoot) {
  const candidates = [
    path.resolve(projectRoot, '..', 'pi-web', 'node_modules', 'typescript'),
    path.resolve(projectRoot, 'node_modules', 'typescript')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return '';
}

/**
 * 受控类型擦除兜底（**仅在找不到 typescript 时使用**）。
 *
 * 它只覆盖本类配置文件的形状（`import type`、`const x: T =`、`as {...}`），
 * 因此**后面的执行门禁是必须的**：擦错了会在门禁里当场炸掉，而不是把坏配置打进归档。
 */
export function stripTypeAnnotations(source) {
  return source
    .replace(/^\s*import\s+type\s[^;]*;\s*$/gm, '')
    .replace(/^\s*export\s+type\s[^;]*;\s*$/gm, '')
    .replace(/\s+as\s+\{[^}]*\}/g, '')
    .replace(/\s+as\s+(?:const|unknown|any|string|number|boolean)\b/g, '')
    .replace(/(\b(?:const|let|var)\s+[A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$.<>[\]\s|]*(?=\s*=)/g, '$1');
}

/**
 * 执行门禁：导入一次 `next.config.mjs`，断言导出形状。
 *
 * 为什么**每次 apply 都跑**（而不是只在刚生成时跑）：`.mjs` 可能是上一轮留下的，
 * 而 `.ts` 已被删 —— 那样"生成即门禁"就永远跑不到，等于没有门禁。
 */
async function assertConfigShape(mjsAbs) {
  let exported;
  try {
    const mod = await import(`${pathToFileURL(mjsAbs).href}?t=${Date.now()}`);
    exported = mod.default;
  } catch (err) {
    throw new Error(`next.config.mjs 无法执行：${err === null || err === undefined ? '' : err.message}`);
  }
  const keys = exported !== null && typeof exported === 'object' ? Object.keys(exported) : [];
  for (const key of ['serverExternalPackages', 'images', 'env']) {
    if (!keys.includes(key)) {
      throw new Error(`next.config.mjs 缺少必需键 ${key}（现有：${keys.join(',')}）——拒绝产出归档`);
    }
  }
  if (typeof exported.headers !== 'function') {
    throw new Error('next.config.mjs 的 headers 必须是函数（原配置如此）——拒绝产出归档');
  }
  return keys;
}

/**
 * `next.config.ts` → `next.config.mjs`，并删除 `.ts`。
 *
 * Next 的 `CONFIG_FILES = [next.config.js, .mjs, .ts, .mts]`
 * （`next/dist/shared/lib/constants.js:364`，`findUp` 按此序取）⇒ 只要 `.mjs` 在位且 `.ts` 不在，
 * 启动期就**不会**走 SWC（载荷里 SWC 只有 WASM 版，30.4 MB）。
 */
export async function precompileNextConfig(targetDir, projectRoot, opts = {}) {
  const tsAbs = path.join(targetDir, 'next.config.ts');
  const mjsAbs = path.join(targetDir, 'next.config.mjs');
  const info = { tsPresent: fs.existsSync(tsAbs), mjs: mjsAbs, via: '', removedTs: false, keys: [] };
  const mjsPresent = fs.existsSync(mjsAbs);
  if (!info.tsPresent && !mjsPresent) {
    // 两者都没有 ⇒ 载荷会丢掉 `images.unoptimized` / `serverExternalPackages` 等关键配置，
    // 真机表现是"图片优化器去碰 sharp-wasm"或"外部包被打包"，不允许静默产出。
    throw new Error(`载荷根既无 next.config.ts 也无 next.config.mjs：${targetDir}——拒绝产出归档`);
  }
  if (!info.tsPresent) {
    info.via = '已存在 .mjs（重跑门禁）';
    info.keys = await assertConfigShape(mjsAbs);
    if (!opts.quiet) console.log(`jitless 配置 : 已有 next.config.mjs，门禁复跑通过（${info.keys.length} 键）`);
    return info;
  }

  const source = await fsp.readFile(tsAbs, 'utf8');
  const tsDir = resolveTypeScript(projectRoot);
  let emitted;
  if (tsDir !== '') {
    const ts = requireFromHere(tsDir);
    emitted = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: 'next.config.ts'
    }).outputText;
    info.via = `typescript@${ts.version}`;
  } else {
    emitted = stripTypeAnnotations(source);
    info.via = '受控类型擦除（未找到 typescript）';
  }
  if (!opts.quiet) console.log(`jitless 配置 : next.config.ts → next.config.mjs（${info.via}）`);
  await fsp.writeFile(mjsAbs, emitted, 'utf8');
  info.keys = await assertConfigShape(mjsAbs);
  await fsp.rm(tsAbs, { force: true });
  info.removedTs = true;
  if (!opts.quiet) {
    console.log(`jitless 配置 : 执行门禁通过（${info.keys.length} 键：${info.keys.join(',')}）；已删除 next.config.ts`);
  }
  return info;
}

/**
 * 找载荷树里所有指定包（含**嵌套副本**）。
 *
 * 为什么按 `package.json#name` 找而不是写死路径：`undici` 在载荷里有**两份**
 * （`node_modules/undici` 与 `…/pi-coding-agent/node_modules/undici`），photon 只在深层作用域包内；
 * 写死路径会在上游升级时静默漏改。
 *
 * 为什么要按层 BFS 到 `maxDepth`：嵌套去重 / 插件自带 `node_modules` 会形成
 * `node_modules/a/node_modules/b/node_modules/undici`。漏一份 = compat 形态下那份仍会
 * `install()` 覆写 `globalThis.fetch`（调模型全废，且组装期全绿）。
 */
export function findPackageDirs(targetDir, packageName, maxDepth = 3) {
  const found = [];
  const segments = packageName.split('/');
  const root = path.join(targetDir, 'node_modules');
  if (!fs.existsSync(root)) return found;
  const queue = [{ dir: root, depth: 1 }];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current.dir) || current.depth > maxDepth) continue;
    seen.add(current.dir);
    let entries;
    try {
      entries = fs.readdirSync(current.dir);
    } catch {
      continue;
    }
    const pkgDir = path.join(current.dir, ...segments);
    const pkgJson = path.join(pkgDir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      try {
        if (JSON.parse(fs.readFileSync(pkgJson, 'utf8')).name === packageName) found.push(pkgDir);
      } catch {
        /* 坏 package.json 不是本步骤的责任 */
      }
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const entryAbs = path.join(current.dir, entry);
      let stat;
      try {
        stat = fs.statSync(entryAbs);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (entry.startsWith('@')) {
        let subs;
        try {
          subs = fs.readdirSync(entryAbs);
        } catch {
          continue;
        }
        for (const sub of subs) {
          const nested = path.join(entryAbs, sub, 'node_modules');
          if (fs.existsSync(nested)) queue.push({ dir: nested, depth: current.depth + 1 });
        }
        continue;
      }
      const nested = path.join(entryAbs, 'node_modules');
      if (fs.existsSync(nested)) queue.push({ dir: nested, depth: current.depth + 1 });
    }
  }
  return found;
}

/**
 * 写条件入口：WASM 可用 ⇒ 原生实现；不可用 ⇒ 纯 JS 垫片。
 *
 * 具名导出**从真实包读取**（不手写）。逐条赋值是**承重**的：
 * 本机实测（Node 24）写成 `module.exports = { A: impl.A, … }` 时 cjs-module-lexer 只识别
 * **第一个**键 ⇒ ESM 侧 `import * as x` 只拿到 1 个具名导出，其余全 undefined
 * （后果：`photon.resize` 不存在 ⇒ 图片被上游静默丢弃）。
 */
export function writeJitlessEntry(pkgDir, spec, realMain, names) {
  const lines = [];
  lines.push("'use strict';");
  lines.push('/*');
  lines.push(` * ${JITLESS_ENTRY_FILE} —— 108-jitless 条件入口（由 scripts/jitless-shape.mjs 生成，请勿手改）`);
  lines.push(' *');
  lines.push(` * 包：${spec.packageName}｜原 main：${realMain}`);
  lines.push(' * 规则：WebAssembly 可用 ⇒ 原生实现（有 ACL/JIT 的设备，行为与改造前一致）；');
  lines.push(' *       不可用（无 ACL，V8 以 --jitless 运行）⇒ 纯 JS 垫片。');
  lines.push(' * 具名导出必须逐条赋值：ESM 侧靠 cjs-module-lexer 的静态分析识别具名键。');
  lines.push(' */');
  lines.push(`const REAL_MAIN = ${JSON.stringify(`./${realMain.replace(/\\/g, '/')}`)};`);
  lines.push('');
  lines.push('// 纯 JS 垫片目录（载荷入口安装兼容层时设置 PI_JITLESS_DIR；缺失说明启动顺序被破坏）');
  lines.push('function loadShim(file) {');
  lines.push('  const dir = process.env.PI_JITLESS_DIR;');
  lines.push("  if (typeof dir !== 'string' || dir.length === 0) {");
  lines.push(`    throw new Error('${spec.packageName}: PI_JITLESS_DIR 未设置（载荷入口未安装 108-jitless 兼容层？）');`);
  lines.push('  }');
  lines.push("  return require(require('node:path').join(dir, file));");
  lines.push('}');
  lines.push('');
  lines.push("const prim = typeof WebAssembly !== 'undefined';");
  lines.push('let impl;');
  if (spec.kind === 'undici') {
    lines.push('if (prim) {');
    lines.push('  impl = require(REAL_MAIN);');
    lines.push('} else {');
    lines.push("  impl = loadShim('undici-shim.js').createUndiciShim(require(REAL_MAIN));");
    lines.push('}');
  } else {
    lines.push("impl = prim ? require(REAL_MAIN) : loadShim('photon-shim.js');");
  }
  lines.push('');
  for (const name of names) {
    lines.push(`module.exports.${name} = impl.${name};`);
  }
  const entryAbs = path.join(pkgDir, JITLESS_ENTRY_FILE);
  fs.writeFileSync(entryAbs, `${lines.join('\n')}\n`, 'utf8');
  return entryAbs;
}

/**
 * 门禁：条件入口写完后**按 ESM 导一次**，断言每个具名导出都真的可见。
 *
 * 与 `checkShimExports` 分工：这一条测的是**生成的文件**（lexer 形状），
 * 那一条测的是**垫片实现了哪些名字**（值是否存在）。
 */
async function assertEntryExports(entryAbs, names) {
  const ns = await import(`${pathToFileURL(entryAbs).href}?t=${Date.now()}`);
  const visible = Object.keys(ns);
  const missing = names.filter((name) => !visible.includes(name));
  if (missing.length > 0) {
    throw new Error(`条件入口的具名导出缺失（${path.basename(entryAbs)}）：${missing.join(',')}`
      + `（可见：${visible.join(',')}）——拒绝产出归档`);
  }
  return { exported: names.length };
}

/**
 * 门禁：compat 形态的 `impl` 必须覆盖**必需导出**，其余缺失项进报告（不抛错）。
 *
 * 为什么分层：photon 真实包有 194 个导出，垫片只实现上游真正用到的面 ——
 * 全量要求不现实；但"必需项缺一个"就是静默降级（图片被丢、fetch 被换回），必须当场炸。
 */
function checkShimExports(spec, real, shimDir) {
  const shim = spec.kind === 'undici'
    ? requireFromHere(path.join(shimDir, 'undici-shim.js')).createUndiciShim(real)
    : requireFromHere(path.join(shimDir, 'photon-shim.js'));
  // 108-jitless：vendor 必须齐备（缺了就是 compat 形态下图片/编解码直接抛错，且很难归因）
  const vendorDir = path.join(shimDir, 'vendor');
  for (const required of ['VENDOR.json', 'jpeg-js/package.json', 'pngjs/package.json']) {
    if (!fs.existsSync(path.join(vendorDir, required))) {
      throw new Error(`payload/jitless/vendor 缺少 ${required}（纯 JS 图片编解码依赖）——拒绝产出归档`);
    }
  }
  const allNames = Object.keys(real).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  const undefinedNames = allNames.filter((name) => shim[name] === undefined);
  const required = REQUIRED_EXPORTS[spec.kind === 'undici' ? 'undici' : 'photon'];
  const missingRequired = required.filter((name) => shim[name] === undefined);
  if (missingRequired.length > 0) {
    throw new Error(`${spec.packageName}: 垫片缺少必需导出 ${missingRequired.join(',')}`
      + '——拒绝产出归档（缺任何一个都会让上游静默降级）');
  }
  return { required: required.length, undefinedNames };
}

/**
 * 给一个包写条件入口并改写 `main`（幂等：已是条件入口会按 piJitlessOriginalMain 重算并重写入口）。
 *
 * @param {string} shimDir `payload/jitless` 的绝对路径（用于校验垫片导出面）
 */
export async function instrumentPackage(pkgDir, spec, shimDir, opts = {}) {
  const pkgPath = path.join(pkgDir, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    return { dir: pkgDir, error: `package.json 解析失败：${err === null || err === undefined ? '' : err.message}` };
  }
  /*
   * `exports` 字段会**绕过 `main`**：ESM/CJS 解析都按 `exports` 走 ⇒ 条件入口完全不生效，
   * compat 形态下拿到的还是原生包（undici 会把 `globalThis.fetch` 换回 WASM 版）。
   * 这种"改了却没用"的失效在真机上极难归因，所以在组装期硬失败。
   * 当前 undici@8 / photon-node@0.3 都没有 `exports`（已实测），这条是给升级兜底。
   */
  if (pkg.exports !== undefined) {
    return {
      dir: pkgDir,
      error: `${pkg.name}: package.json 含 exports 字段，改 main 不会影响解析（条件入口会被绕过）；`
        + '需改用改写 exports 的方案'
    };
  }
  const originalMain = typeof pkg.piJitlessOriginalMain === 'string'
    ? pkg.piJitlessOriginalMain
    : (typeof pkg.main === 'string' && pkg.main.length > 0 ? pkg.main : 'index.js');
  const realAbs = path.resolve(pkgDir, originalMain);
  if (!fs.existsSync(realAbs)) {
    return { dir: pkgDir, error: `原 main 不存在：${originalMain}` };
  }
  let real;
  let names;
  try {
    real = requireFromHere(realAbs);
    names = Object.keys(real).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  } catch (err) {
    return { dir: pkgDir, error: `读取真实导出名失败（${originalMain}）：${err === null || err === undefined ? '' : err.message}` };
  }
  const coverage = checkShimExports(spec, real, shimDir);
  const entryAbs = writeJitlessEntry(pkgDir, spec, originalMain, names);
  // 门禁在改 main 之前跑：入口用相对路径 require，不依赖 main 是否已指向它
  await assertEntryExports(entryAbs, names);
  pkg.piJitlessOriginalMain = originalMain;
  pkg.main = JITLESS_ENTRY_FILE;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  if (!opts.quiet) {
    console.log(`jitless 包   : ${path.relative(process.cwd(), pkgDir)} → main=${JITLESS_ENTRY_FILE}`
      + `（原 ${originalMain}；具名导出 ${names.length} 条，ESM 门禁通过；`
      + `垫片必需 ${coverage.required} 项齐备，未覆写 ${coverage.undefinedNames.length} 项）`);
  }
  return {
    dir: pkgDir,
    main: originalMain,
    names: names.length,
    changed: true,
    shimUndefined: coverage.undefinedNames
  };
}

/**
 * 对载荷树做全部 108-jitless 改造，返回可审计的报告片段。
 *
 * @param {string} targetDir 暂存目录（归档内根目录）
 * @param {string} projectRoot 本工程根（用于找 typescript 与 payload/jitless 垫片）
 * @param {{ quiet?: boolean }} [opts]
 */
export async function applyJitlessShape(targetDir, projectRoot, opts = {}) {
  const config = await precompileNextConfig(targetDir, projectRoot, opts);
  const shimDir = path.join(projectRoot, 'payload', 'jitless');
  if (!fs.existsSync(path.join(shimDir, 'index.js'))) {
    throw new Error(`找不到纯 JS 兼容层：${shimDir}/index.js（组装前必须先有 payload/jitless）`);
  }
  const undiciDirs = findPackageDirs(targetDir, 'undici');
  const photonDirs = findPackageDirs(targetDir, '@silvia-odwyer/photon-node');
  if (undiciDirs.length === 0) {
    throw new Error('载荷里找不到 undici 包（108-jitless 的 fetch 兼容依赖它）——拒绝产出归档');
  }
  if (photonDirs.length === 0) {
    throw new Error('载荷里找不到 @silvia-odwyer/photon-node（图片兼容依赖它）——拒绝产出归档');
  }
  // 逐包顺序 await：门禁里要 `import()` 条件入口，并发导入同一棵树的不同副本会让
  // cjs-module-lexer 的断言落到彼此的模块缓存上，测不出真实形状。
  const undici = [];
  for (const dir of undiciDirs) {
    undici.push(await instrumentPackage(dir, { kind: 'undici', packageName: 'undici' }, shimDir, opts));
  }
  const photon = [];
  for (const dir of photonDirs) {
    photon.push(await instrumentPackage(dir, { kind: 'photon', packageName: '@silvia-odwyer/photon-node' }, shimDir, opts));
  }
  for (const item of [...undici, ...photon]) {
    if (item.error !== undefined) {
      throw new Error(`108-jitless 包改造失败（${item.dir}）：${item.error}`);
    }
  }
  const rel = (item) => path.relative(targetDir, item.dir).replace(/\\/g, '/');
  return {
    nextConfig: { via: config.via, removedTs: config.removedTs, keys: config.keys },
    undici: undici.map((item) => ({
      dir: rel(item), names: item.names, changed: item.changed, shimUndefined: item.shimUndefined
    })),
    photon: photon.map((item) => ({
      dir: rel(item), names: item.names, changed: item.changed, shimUndefined: item.shimUndefined
    }))
  };
}
