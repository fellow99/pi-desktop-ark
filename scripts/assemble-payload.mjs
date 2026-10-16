#!/usr/bin/env node
/**
 * assemble-payload.mjs —— 把 `pi-dist` 组装成**可投放的载荷**（零依赖，ESM）。
 *
 * 目的（工程规划 §7 / Phase 1 第 1 条）：一条命令完成「复制 → 按规则裁剪 → 投放/打包」，
 * 并且**每一步都可审计**：默认是 dry run，只报告「会删掉什么、会得到多大」，
 * 不动任何文件、更不动源目录。
 *
 * 两条投放路线（§7.1 二选一）：
 *   ① `--route readonly`（默认）：载荷**原样**放进 `entry/src/main/resources/resfile/pi-web/`，
 *      Node 从只读安装目录直读 ⇒ 零解压、零首启等待。库侧对应
 *      `NodeRuntimeOptions.readonlyRoot = context.resourceDir` + `entry = 'pi-web/<入口>'`。
 *   ② `--route tar`：先把裁剪后的树复制到暂存目录，再由本脚本打成单个 `tar.gz`
 *      放进 `entry/src/main/resources/rawfile/`，并打印 SHA-256（前 12 位是幂等键，
 *      经 `NodeRuntimeOptions.archiveSha256` 交给库，见契约 §3.2）。
 *
 * 纪律：
 *   · **源目录只读**：裁剪发生在**复制过程中**（fs.cp 的 filter），不是「先拷完再删」——
 *     源目录必须保持原样，随时可以重跑；
 *   · 默认 **dry run**；只有显式 `--apply` 才写盘；
 *   · 绝不写到项目目录之外，除非 `--out` 明确指到外面（此时会警告）；
 *   · 每个被跳过/保留的项都打印出来，供评审逐条核对（裁剪是删东西，不能只报总计）。
 *
 * 用法：
 *   node scripts/assemble-payload.mjs                       # dry run，路线 ①，报告裁剪明细
 *   node scripts/assemble-payload.mjs --apply               # 真正投放到 resfile/pi-web/
 *   node scripts/assemble-payload.mjs --route tar --apply   # 产出 rawfile/pi-web.tar.gz + SHA-256
 *   node scripts/assemble-payload.mjs --from <pi-dist> --out <dir> --json report.json --force
 */

import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CROP_RULES,
  assertKeepSound,
  firstMatchingRule,
  patternHits,
  ruleMatchesDir,
  ruleMatchesFile
} from './crop-rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 项目根 = scripts/ 的上一级 */
const PROJECT_ROOT = path.resolve(HERE, '..');
const DEFAULT_FROM = path.resolve(PROJECT_ROOT, '..', 'pi-desktop-hos', 'pi-dist');
const DEFAULT_OUT_READONLY = path.join(PROJECT_ROOT, 'entry', 'src', 'main', 'resources', 'resfile', 'pi-web');
/** 路线 ② 的暂存目录（默认在项目的 build/ 下，已被 .gitignore 的 `/**\/build/` 覆盖） */
const DEFAULT_STAGE = path.join(PROJECT_ROOT, 'build', 'payload-stage');
const DEFAULT_TAR = path.join(PROJECT_ROOT, 'entry', 'src', 'main', 'resources', 'rawfile', 'pi-web.tar.gz');

/**
 * 库自带 Node 侧载荷目录（`../ohos-node-bridge/payload/`）。
 *
 * ⚠️ F4：`payload/` 三件**不在 HAR 里**（已知打包缺口：HAR 只带 ArkTS/原生代码）——
 * 应用必须自己投放：`assemblePayload` 把它们放进路线 ① 的 `--out`、路线 ② 的暂存树（⇒ 进归档），
 * 并投放到 rawfile；运行期 `bootstrap.js` 是交给 `node::Start` 的 `scriptPath`（契约 §3.1–§3.4）。
 */
const DEFAULT_BRIDGE = path.resolve(PROJECT_ROOT, '..', 'ohos-node-bridge');
/** 必须随包投放的三件（保留相对路径：bootstrap 以同级 `host.js` 与 `./lib/tar-extract.js` 为依赖） */
const BRIDGE_PAYLOAD_FILES = ['bootstrap.js', 'host.js', 'lib/tar-extract.js'];
/** rawfile 投放目录（应用用 `getRawFileContentSync` 物化引导器三件；默认随包进 HAP） */
const DEFAULT_RAWFILE = path.join(PROJECT_ROOT, 'entry', 'src', 'main', 'resources', 'rawfile');
/** 入口脚本名（与 payload/ 下的文件名一致；库侧 entry 会指向它） */
const ENTRY_REL = 'pi-web-launch.js';

// ── 命令行解析 ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    from: DEFAULT_FROM,
    out: '',
    route: 'readonly',
    apply: false,
    force: false,
    keepStaging: false,
    json: '',
    quiet: false,
    bridge: DEFAULT_BRIDGE,
    rawfile: DEFAULT_RAWFILE,
    skipRawfile: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} 缺少取值`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--from': opts.from = path.resolve(next()); break;
      case '--out': opts.out = next(); break;
      case '--route': opts.route = next(); break;
      case '--bridge': opts.bridge = path.resolve(next()); break;
      case '--rawfile': opts.rawfile = path.resolve(next()); break;
      case '--apply': opts.apply = true; break;
      case '--force': opts.force = true; break;
      case '--keep-staging': opts.keepStaging = true; break;
      case '--skip-rawfile': opts.skipRawfile = true; break;
      case '--json': opts.json = path.resolve(next()); break;
      case '--quiet': opts.quiet = true; break;
      case '--help':
      case '-h': opts.help = true; break;
      default: throw new Error(`未知参数：${arg}（--help 看用法）`);
    }
  }
  if (opts.route !== 'readonly' && opts.route !== 'tar') {
    throw new Error(`--route 只能是 readonly 或 tar（收到 ${opts.route}）`);
  }
  return opts;
}

function usage() {
  return [
    '用法：node scripts/assemble-payload.mjs [选项]',
    '',
    '  --from <dir>      pi 产物目录（默认 ../pi-desktop-hos/pi-dist）',
    '  --out <dir>       输出目录：路线 ① = 投放目录；路线 ② = 暂存目录',
    '  --route <r>       readonly（默认，零解压直读）| tar（单个 tar.gz）',
    '  --apply           真正写盘（默认只做 dry run 并打印计划）',
    '  --force           目标已存在且非空时也继续（会先清空目标）',
    '  --keep-staging    路线 ②：保留暂存目录（默认打完包就删）',
    '  --bridge <dir>    库目录（默认 ../ohos-node-bridge）；取其 payload/ 三件随包投放',
    '  --rawfile <dir>   rawfile 投放目录（默认 entry/src/main/resources/rawfile）',
    '  --skip-rawfile    不投放引导器三件到 rawfile（路线 ② 将无法物化 bootstrap）',
    '  --json <path>     把机器可读报告写到该路径',
    '  --quiet           少打印（仍打印总计）',
    '  --help            显示本帮助'
  ].join('\n');
}

// ── 遍历与统计 ────────────────────────────────────────────────────────────────

/**
 * 遍历一棵树，按相对路径（`/` 分隔）产出 `{ rel, abs, size }`。
 * 刻意不跟随符号链接：设备侧 `symlink` 不可用，跟随会让统计与实际投放不一致。
 */
function walkTree(rootDir) {
  const out = [];
  const stack = [''];
  while (stack.length > 0) {
    const relDir = stack.pop();
    const absDir = relDir === '' ? rootDir : path.join(rootDir, relDir);
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      out.push({ rel: `${relDir}/`, abs: absDir, size: 0, error: String(err && err.message) });
      continue;
    }
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      const abs = path.join(rootDir, rel);
      if (entry.isDirectory()) {
        stack.push(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        size = 0;
      }
      out.push({ rel, abs, size });
    }
  }
  return out;
}

/** 磁盘占用字节数（表观大小；与规划里的 `du -sb` 口径一致：不按块对齐） */
function totalBytes(files) {
  return files.reduce((sum, f) => sum + (f.size || 0), 0);
}

function human(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${String(bytes).padStart(12, ' ')} B  (${mb.toFixed(1)} MiB)`;
}

// ── 计划：逐规则统计会裁掉什么 ─────────────────────────────────────────────────

/**
 * 对源树做一次「裁剪计划」：
 *   · cropped：每条规则命中且**未被白名单保留**的文件（含字节数）
 *   · kept：命中规则 pattern 但被白名单保住的文件（必须打印，评审要看）
 *   · overlaps：被多条规则同时命中的文件（计数只归第一条规则；出现即打印告警）
 */
function planCrop(sourceFiles) {
  const perRule = new Map(CROP_RULES.map((rule) => [rule.id, { rule, files: [], bytes: 0 }]));
  const kept = [];
  const overlaps = [];
  const survivors = [];

  for (const file of sourceFiles) {
    const matches = CROP_RULES.filter((rule) => !ruleMatchesDir(path.posix.dirname(file.rel), rule)
      && ruleMatchesFile(file.rel, rule));
    if (matches.length === 0) {
      // 白名单保住的也会走到这里（matchesFileForRule 已排除），用一次额外判定把「被保留」单独记录
      const keptBy = CROP_RULES.find((rule) => patternHits(rule.pattern, file.rel));
      if (keptBy) kept.push({ rule: keptBy, file });
      else survivors.push(file);
      continue;
    }
    if (matches.length > 1) overlaps.push({ file, rules: matches.map((r) => r.id) });
    const bucket = perRule.get(matches[0].id);
    bucket.files.push(file);
    bucket.bytes += file.size || 0;
  }
  return { perRule, kept, overlaps, survivors };
}

// 匹配**只有一份实现**（crop-rules.mjs）：这里不再复制一份 glob 编译器，
// 否则「dry run 报告的数字」与「真正裁剪的动作」可能来自两套有细微差别的语义（曾因此漏报 76 个 .nft.json）。

/** 打印计划（人读 + 可复核） */
function printPlan(opts, sourceFiles, plan) {
  const beforeBytes = totalBytes(sourceFiles);
  console.log('── 载荷组装计划（dry run 也会走完整遍历，数字来自真实文件树）────────────────');
  console.log(`源目录      : ${opts.from}`);
  console.log(`源规模      : ${sourceFiles.length} 文件 / ${human(beforeBytes)}`);
  console.log(`投放路线    : ${opts.route}${opts.route === 'readonly' ? '（只读直读，零解压）' : '（tar.gz + Node 自解包）'}`);
  console.log(`输出目标    : ${opts.route === 'readonly' ? (opts.out || DEFAULT_OUT_READONLY) : (opts.out || DEFAULT_STAGE)}`);
  if (opts.route === 'tar') console.log(`归档目标    : ${DEFAULT_TAR}`);
  console.log(`库载荷三件  : ${opts.bridge}/payload → ${BRIDGE_PAYLOAD_FILES.join(' / ')}`);
  console.log(`rawfile 投放: ${opts.skipRawfile ? '（--skip-rawfile：不投放）' : opts.rawfile}`);
  console.log('');
  console.log('── 逐规则裁剪明细 ────────────────────────────────────────────────────────');
  let plannedBytes = 0;
  let plannedFiles = 0;
  for (const rule of CROP_RULES) {
    const bucket = plan.perRule.get(rule.id);
    plannedBytes += bucket.bytes;
    plannedFiles += bucket.files.length;
    const expect = rule.expectedSavingBytes >= 0
      ? `规划期望 ${rule.expectedSavingBytes} B / ${rule.expectedFiles >= 0 ? rule.expectedFiles + ' 文件' : '文件数未记'}`
      : '规划未给期望值';
    console.log(`· [${rule.id}] ${rule.pattern}`);
    console.log(`    实际命中  : ${bucket.files.length} 文件 / ${human(bucket.bytes)}`);
    console.log(`    ${expect}｜差异 ${bucket.bytes - (rule.expectedSavingBytes >= 0 ? rule.expectedSavingBytes : 0)} B`);
    console.log(`    证据      : ${rule.evidence}`);
    console.log(`    依据      : ${rule.planRef}`);
    console.log(`    理由      : ${rule.reason}`);
    if (bucket.files.length > 0 && !opts.quiet) {
      const sample = bucket.files.slice(0, 5).map((f) => `        - ${f.rel}`);
      console.log(`    样例（最多 5 个）:`);
      console.log(sample.join('\n'));
      if (bucket.files.length > sample.length) console.log(`        … 其余 ${bucket.files.length - sample.length} 个略`);
    }
    if (rule.keep.length > 0) {
      console.log(`    保留白名单: ${rule.keep.join(', ')}`);
      const keptForRule = plan.kept.filter((k) => k.rule.id === rule.id);
      console.log(`    白名单实际保住: ${keptForRule.length} 文件 / ${human(totalBytes(keptForRule.map((k) => k.file)))}`);
      if (!opts.quiet) {
        for (const k of keptForRule.slice(0, 5)) console.log(`        + ${k.file.rel}`);
      }
    }
    console.log('');
  }
  const afterBytes = beforeBytes - plannedBytes;
  console.log('── 合计 ──────────────────────────────────────────────────────────────────');
  console.log(`将裁剪      : ${plannedFiles} 文件 / ${human(plannedBytes)}`);
  console.log(`裁剪后估算  : ${sourceFiles.length - plannedFiles} 文件 / ${human(afterBytes)}`);
  console.log(`压缩比参考  : 112.4 MB/GB 量级不适用（被裁项压缩比高于均值，规划 §7.2 明确禁止线性外推）`);
  if (plan.overlaps.length > 0) {
    console.log(`⚠️ 有 ${plan.overlaps.length} 个文件同时命中多条规则（计数归第一条，请核对规则是否重叠）：`);
    for (const o of plan.overlaps.slice(0, 5)) console.log(`    ! ${o.file.rel} ← ${o.rules.join(' + ')}`);
  }
  const unsafe = CROP_RULES.filter((r) => !r.safeByDefault).map((r) => r.id);
  if (unsafe.length > 0) {
    console.log(`⚠️ 尚需真机复核的规则（规划 O1/O2 口径，本脚本不会替你升级证据等级）：${unsafe.join(', ')}`);
  }
  return { beforeBytes, afterBytes, plannedFiles, plannedBytes };
}

// ── 复制（裁剪发生在复制过程中） ───────────────────────────────────────────────

/**
 * 用 `fs.cp(..., { filter })` 做**流式**复制，并在 filter 里执行裁剪：
 * 被裁掉的文件**根本不复制**（源目录保持原样，也就不存在「拷完再删」的中间态）。
 * @returns {{ copiedFiles: number, copiedBytes: number, skippedFiles: number, skippedBytes: number, keptFiles: number }}
 */
async function copyCropped(fromDir, toDir, opts) {
  const stats = {
    copiedFiles: 0, copiedBytes: 0,
    skippedFiles: 0, skippedBytes: 0,
    skippedDirs: 0, keptFiles: 0
  };
  await fsp.mkdir(path.dirname(toDir), { recursive: true });
  await fsp.rm(toDir, { recursive: true, force: true });
  await fsp.mkdir(toDir, { recursive: true });

  await fsp.cp(fromDir, toDir, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
    filter: (src) => {
      const rel = path.relative(fromDir, src).split(path.sep).join('/');
      if (rel === '') return true;
      let stat;
      try {
        stat = fs.statSync(src);
      } catch {
        return false;
      }
      if (stat.isDirectory()) {
        for (const rule of CROP_RULES) {
          if (ruleMatchesDir(rel, rule)) {
            stats.skippedDirs += 1; // 目录条目单独计数：文件数由 filter 里的文件分支累加
            if (!opts.quiet) console.log(`  ✂ 目录裁剪 ${rel} ← [${rule.id}]`);
            return false;
          }
        }
        return true;
      }
      if (!stat.isFile()) return true;
      const rule = firstMatchingRule(rel);
      if (rule !== null) {
        stats.skippedFiles += 1;
        stats.skippedBytes += stat.size;
        return false;
      }
      if (CROP_RULES.some((r) => patternHits(r.pattern, rel))) stats.keptFiles += 1; // 命中 pattern 但被白名单保住
      stats.copiedFiles += 1;
      stats.copiedBytes += stat.size;
      return true;
    }
  });
  return stats;
}

// ── tar.gz 打包（纯 Node，零依赖：ustar 写入器 + zlib） ──────────────────────────
/**
 * 把条目名拆成 ustar 的 `prefix`(155) / `name`(100)。
 *
 * 返回 `null` = **这套 512 字节头表达不了这个名字** ⇒ 调用方必须改用 GNU `L` 长名条目。
 * 为什么要显式返回 null：早先的实现「在最后一个 `/` 处切开、名超出 100 字节就截断」，
 * 会把「长目录 + 长文件名」的条目**静默改名**（实测：`.txt` 后缀被切掉）—— 归档于是静默损坏。
 * 现在只允许**完整放得下**的拆分，放不下就走长名条目。
 */
function splitUstarName(name) {
  const bytes = (text) => Buffer.byteLength(text, 'utf8');
  if (bytes(name) <= 100) {
    return { headerName: name, prefix: '' };
  }
  const slash = name.lastIndexOf('/');
  if (slash > 0) {
    const prefix = name.slice(0, slash);
    const base = name.slice(slash + 1);
    if (bytes(base) <= 100 && bytes(prefix) <= 155) {
      return { headerName: base, prefix };
    }
  }
  return null;
}

/** 512 字节 ustar 头（mtime 固定 0 ⇒ 同样输入 ⇒ 同样哈希，幂等键才稳定） */
function ustarHeader(name, size, typeflag) {
  const buf = Buffer.alloc(512, 0);
  const write = (text, offset, length) => {
    Buffer.from(text, 'utf8').copy(buf, offset, 0, length);
  };
  const plan = splitUstarName(name);
  if (plan === null) {
    // 绝不静默截断：调用方必须先用 GNU 'L' 长名条目把名字写出去
    throw new Error(`ustar 头容纳不下该条目名（需要 GNU 'L' 长名条目）：${name}`);
  }
  const headerName = plan.headerName;
  const prefix = plan.prefix;
  write(headerName, 0, 100);
  write('0000644\0', 100, 8);          // mode
  write('0000000\0', 108, 8);          // uid
  write('0000000\0', 116, 8);          // gid
  write(size.toString(8).padStart(11, '0') + '\0', 124, 12);
  write('00000000000\0', 136, 12);     // mtime = 0（确定性）
  write('        ', 148, 8);           // checksum 占位（8 空格）
  buf[156] = typeflag.charCodeAt(0);
  write('ustar\0', 257, 6);
  write('00', 263, 2);
  if (prefix.length > 0) write(prefix, 345, 155);
  let sum = 0;
  for (const byte of buf) sum += byte;
  write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return buf;
}

function padTo512(size) {
  const remainder = size % 512;
  return remainder === 0 ? 0 : 512 - remainder;
}

/**
 * 按 UTF-8 **字节**上限截断，且不把多字节字符切成半个（回退到完整字符边界）。
 * 用途：GNU 'L' 长名条目的本体头需要一个「放得下的占位名」。
 */
function truncateUtf8Bytes(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  for (const char of text) {
    if (Buffer.byteLength(out + char, 'utf8') > maxBytes) break;
    out += char;
  }
  return out;
}

/** 流式写 tar.gz（逐文件 pipe，不把大文件读进内存） */
async function writeTarGz(rootDir, outPath, opts) {
  const files = walkTree(rootDir).filter((f) => f.error === undefined).sort((a, b) => a.rel.localeCompare(b.rel));
  const dirs = new Set();
  for (const file of files) {
    const segments = file.rel.split('/');
    for (let i = 1; i < segments.length; i += 1) dirs.add(segments.slice(0, i).join('/'));
  }

  const dirList = [...dirs].sort();

  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const gz = createGzip({ level: 9 });
  const out = fs.createWriteStream(outPath);
  gz.pipe(out);
  // 错误监听只挂一次（每次 write 都挂会触发 MaxListenersExceededWarning：27086 个文件 = 27086 个监听器）
  let gzipError = null;
  gz.on('error', (err) => {
    gzipError = err;
  });
  const write = (chunk) => new Promise((resolve, reject) => {
    if (gzipError !== null) {
      reject(gzipError);
      return;
    }
    if (gz.write(chunk)) resolve();
    else gz.once('drain', resolve);
  });

  for (const dir of dirList) {
    await write(ustarHeader(`${dir}/`, 0, '5'));
  }
  for (const file of files) {
    const rel = file.rel;
    // GNU 长名条目（库侧 tar-extract 支持 typeflag 'L'，契约 §3.7）：
    // 判据是「ustar 头能不能**完整**表达这个名字」，不是「路径有没有超过 255 字节」——
    // 后者会漏掉「长目录 + 长文件名」这一族（实测过：会被静默改名）。
    const needsLongName = splitUstarName(rel) === null;
    if (needsLongName) {
      const longName = Buffer.from(rel, 'utf8');
      await write(ustarHeader('././@LongLink', longName.length + 1, 'L'));
      await write(Buffer.concat([longName, Buffer.from([0])]));
      await write(Buffer.alloc(padTo512(longName.length + 1)));
    }
    // 本体头：名字超长时按 GNU tar 的口径写**截断占位名**（真实名字由上面的 'L' 条目承载，
    // 读取方会用它覆盖；这里绝不能因为「名字太长」就抛错 —— 那会把整卷归档卡死）。
    await write(ustarHeader(needsLongName ? truncateUtf8Bytes(rel, 100) : rel, file.size, '0'));
    if (file.size > 0) {
      await new Promise((resolve, reject) => {
        const source = fs.createReadStream(file.abs);
        source.on('error', reject);
        source.on('end', resolve);
        source.pipe(gz, { end: false });
      });
    }
    const padding = padTo512(file.size);
    if (padding > 0) await write(Buffer.alloc(padding));
    if (!opts.quiet) await Promise.resolve();
  }
  // tar 结束：两个全零块
  await write(Buffer.alloc(1024));
  await new Promise((resolve, reject) => {
    gz.end((err) => (err ? reject(err) : resolve()));
  });
  await new Promise((resolve, reject) => {
    out.on('close', resolve);
    out.on('error', reject);
  });
  return files;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

// ── 目标合法性（绝不偷偷写到项目外） ─────────────────────────────────────────────

function assertWritableTarget(target, explicit) {
  const resolved = path.resolve(target);
  const inside = resolved === PROJECT_ROOT || resolved.startsWith(PROJECT_ROOT + path.sep);
  if (!inside && explicit === '') {
    throw new Error(`拒绝写到项目目录之外：${resolved}（要用外部路径请显式给 --out）`);
  }
  if (!inside) {
    console.log(`⚠️ 输出目标在项目目录之外（你显式指定了 --out）：${resolved}`);
  }
  return resolved;
}

async function assertEmptyOrForce(dir, force) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  if (entries.length === 0) return;
  if (!force) {
    throw new Error(`目标已存在且非空：${dir}（确认可以覆盖后加 --force；本脚本不会默默清空目录）`);
  }
  console.log(`--force：清空 ${dir}（${entries.length} 个顶层条目）`);
  await fsp.rm(dir, { recursive: true, force: true });
}

// ── 路线 ①：只读直读的说明文件 ─────────────────────────────────────────────────

function payloadReadme(route, sourceFiles, afterBytes) {
  const lines = [
    '# 应用载荷（pi-web + pi）—— 由 scripts/assemble-payload.mjs 生成',
    '',
    `> 路线：**${route === 'readonly' ? '① 只读直读（零解压）' : '② tar.gz + Node 自解包'}**`,
    `> 生成时间：${new Date().toISOString()}`,
    `> 文件数：${sourceFiles}｜裁剪后字节数：${afterBytes}`,
    '',
    '## ArkTS 侧怎么把它交给库',
    '',
    '```ts',
    "// 路线 ①（本目录就是 Node 的运行根）",
    "runtime.start(context, {",
    "  readonlyRoot: context.resourceDir,        // 安装目录下的 resources/resfile",
    `  entry: 'pi-web/${ENTRY_REL}',               // 相对 readonlyRoot`,
    "  payloadRoot: context.filesDir + '/payload',",
    "});",
    '```',
    '',
    '`context.resourceDir` 指向安装包的 `resources/resfile/`，因此 `pi-web/` 这一层与 HAP 内一致；',
    '**不要**用 `process.cwd()` 拼路径（真机 `cwd = /`，库会把 cwd 设成运行根）。',
    '',
    '## 目录约定（本目录内）',
    '',
    `- ${ENTRY_REL} —— Node 侧入口（库的 bootstrap 会 require 它）；`,
    '- env.js —— 环境契约的唯一事实源（应用语义变量的名字与语义都在这里）；',
    '- pi-web-launch.js 同级还可以放 pi 的预置资源：config/（settings.json、mcp.json）、extensions/（同名顶替 bash/find/grep 等）；',
    '- 其余内容就是 `pi-dist` 裁剪后的原样产物（next + node_modules + public + .next）。',
    '',
    '## 裁剪',
    '',
    '四项裁剪规则与证据等级见 `scripts/crop-rules.mjs`（每条带 `planRef` 指回工程规划 §7.2）。',
    '其中 `.nft.json` 与原生 SWC 两项在规划里是 ⬜ 待真机验证（O1/O2）—— '
    + '本文件只如实转述，不代表已验证。',
    ''
  ];
  return lines.join('\n');
}

// ── 库自带 Node 侧载荷（bootstrap/host/tar-extract；不在 HAR 里）────────────────

/**
 * 校验库 `payload/` 三件是否存在（F4）。
 * @returns {{ root: string, files: Array<{rel: string, abs: string, bytes: number}>, missing: string[] }}
 */
function collectBridgeFiles(bridgeDir) {
  const root = path.join(bridgeDir, 'payload');
  const files = [];
  const missing = [];
  for (const rel of BRIDGE_PAYLOAD_FILES) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      files.push({ rel, abs, bytes: fs.statSync(abs).size });
    } else {
      missing.push(abs);
    }
  }
  return { root, files, missing };
}

/** 复制三件到目标树，保留 lib 层级（bootstrap 以相对路径 require 同级 host.js 与 ./lib/tar-extract.js） */
async function stageBridgeFiles(files, targetDir, label) {
  for (const file of files) {
    const dest = path.join(targetDir, file.rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(file.abs, dest);
    console.log(`  + ${label}：${file.rel}（${file.bytes} B）`);
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return 0;
  }

  const keepProblems = assertKeepSound();
  if (keepProblems.length > 0 && !opts.quiet) {
    for (const problem of keepProblems) console.log(`· 规则自审：${problem}`);
  }

  if (!fs.existsSync(opts.from)) {
    console.error(`✗ 源目录不存在：${opts.from}`);
    console.error('  用 --from <pi-dist 路径> 指定；旧壳的产物默认在 ../pi-desktop-hos/pi-dist。');
    return 2;
  }
  const fromStat = fs.statSync(opts.from);
  if (!fromStat.isDirectory()) {
    console.error(`✗ --from 不是目录：${opts.from}`);
    return 2;
  }

  // F4 预检：库的 Node 侧载荷**不在 HAR 里**，缺失必须硬失败（exit 2）——
  // 否则产出的包会在真机上以「引导器缺失、什么都没解包」的形式暴露，且看不出是谁的错。
  const bridge = collectBridgeFiles(opts.bridge);
  if (bridge.missing.length > 0) {
    console.error('✗ 库载荷缺失（HAR 不含 payload/，必须由本脚本投放）：');
    for (const missing of bridge.missing) console.error(`    ${missing}`);
    console.error('  用 --bridge <ohos-node-bridge 目录> 指定库路径（默认 ../ohos-node-bridge）。');
    return 2;
  }

  const sourceFiles = walkTree(opts.from).filter((f) => f.error === undefined);
  const plan = planCrop(sourceFiles);
  const totals = printPlan(opts, sourceFiles, plan);

  const stageDir = opts.out === '' ? DEFAULT_STAGE : path.resolve(opts.out);
  const readonlyDir = opts.out === '' ? DEFAULT_OUT_READONLY : path.resolve(opts.out);

  if (!opts.apply) {
    console.log('（dry run：未写任何文件。确认无误后加 --apply）');
    return 0;
  }

  const report = {
    at: new Date().toISOString(),
    from: opts.from,
    route: opts.route,
    source: { files: sourceFiles.length, bytes: totals.beforeBytes },
    crops: CROP_RULES.map((rule) => ({
      id: rule.id,
      pattern: rule.pattern,
      files: plan.perRule.get(rule.id).files.length,
      bytes: plan.perRule.get(rule.id).bytes,
      evidence: rule.evidence,
      planRef: rule.planRef
    })),
    keptByWhitelist: plan.kept.map((k) => ({ rule: k.rule.id, path: k.file.rel })),
    target: {}
  };

  if (opts.route === 'readonly') {
    const target = assertWritableTarget(readonlyDir, opts.out);
    await assertEmptyOrForce(target, opts.force);
    console.log(`→ 复制（裁剪在复制过程中执行）：${opts.from} → ${target}`);
    const stats = await copyCropped(opts.from, target, opts);
    await stageBridgeFiles(bridge.files, target, '投放库载荷');
    console.log(`库载荷三件  : 已投放 ${bridge.files.length} 个（${BRIDGE_PAYLOAD_FILES.join(' / ')}）`);
    const readmePath = path.join(target, 'PAYLOAD_README.md');
    await fsp.writeFile(readmePath, payloadReadme(opts.route, stats.copiedFiles, stats.copiedBytes), 'utf8');
    const resultFiles = walkTree(target).filter((f) => f.error === undefined);
    console.log('── 结果 ─────────────────────────────────────────────────────────────────');
    console.log(`复制文件    : ${stats.copiedFiles} / ${human(stats.copiedBytes)}`);
    console.log(`裁剪文件    : ${stats.skippedFiles} 文件 + ${stats.skippedDirs} 个整目录 / ${human(stats.skippedBytes)}`);
    console.log(`白名单保住  : ${stats.keptFiles} 文件`);
    console.log(`目标实测    : ${resultFiles.length + 1} 文件（含 PAYLOAD_README.md）/ ${human(totalBytes(resultFiles) + Buffer.byteLength(payloadReadme(opts.route, 0, 0)))}`);
    console.log(`说明文件    : ${readmePath}`);
    console.log(`入口        : ${path.join(target, ENTRY_REL)}（${fs.existsSync(path.join(target, ENTRY_REL)) ? '存在' : '缺失！载荷里必须带它'}）`);
    console.log(`库引导器    : ${path.join(target, BRIDGE_PAYLOAD_FILES[0])}`
      + `（${fs.existsSync(path.join(target, BRIDGE_PAYLOAD_FILES[0])) ? '存在' : '缺失！路线 ① 会判定失败'}）`);
    report.target = {
      kind: 'readonly',
      dir: target,
      files: stats.copiedFiles,
      bytes: stats.copiedBytes,
      entry: path.join(target, ENTRY_REL),
      entryPresent: fs.existsSync(path.join(target, ENTRY_REL)),
      bridgeStaged: bridge.files.map((f) => f.rel),
      bootstrap: path.join(target, BRIDGE_PAYLOAD_FILES[0]),
      bootstrapPresent: fs.existsSync(path.join(target, BRIDGE_PAYLOAD_FILES[0]))
    };
  } else {
    const stage = assertWritableTarget(stageDir, opts.out);
    await assertEmptyOrForce(stage, opts.force);
    console.log(`→ 暂存复制（裁剪在复制过程中执行）：${opts.from} → ${stage}`);
    const stats = await copyCropped(opts.from, stage, opts);
    await stageBridgeFiles(bridge.files, stage, '入归档');
    console.log(`→ 打包 tar.gz：${stage} → ${DEFAULT_TAR}`);
    const tarFiles = await writeTarGz(stage, DEFAULT_TAR, opts);
    const sha = await sha256File(DEFAULT_TAR);
    const shaShort = sha.slice(0, 12);
    const tarBytes = fs.statSync(DEFAULT_TAR).size;
    const shaPath = `${DEFAULT_TAR}.sha256`;
    await fsp.writeFile(
      shaPath,
      `${sha}\n# pi-web.tar.gz sha256=${sha} first12=${shaShort} bytes=${tarBytes} files=${tarFiles.length} at=${new Date().toISOString()} route=tar\n`,
      'utf8'
    );
    console.log('── 结果 ─────────────────────────────────────────────────────────────────');
    console.log(`暂存文件    : ${stats.copiedFiles} / ${human(stats.copiedBytes)}`);
    console.log(`裁剪文件    : ${stats.skippedFiles} 文件 + ${stats.skippedDirs} 个整目录 / ${human(stats.skippedBytes)}`);
    console.log(`归档        : ${DEFAULT_TAR}`);
    console.log(`归档大小    : ${human(tarBytes)}`);
    console.log(`SHA-256     : ${sha}`);
    console.log(`前 12 位    : ${shaShort}   ← 幂等键（NodeRuntimeOptions.archiveSha256 / 契约 §3.2）`);
    console.log(`哈希旁文件  : ${shaPath}`);
    if (!opts.keepStaging) {
      await fsp.rm(stage, { recursive: true, force: true });
      console.log(`暂存目录已删除（--keep-staging 可保留）：${stage}`);
    }
    report.target = {
      kind: 'tar',
      archive: DEFAULT_TAR,
      archiveBytes: tarBytes,
      sha256: sha,
      sha256Short: shaShort,
      sha256Sidecar: shaPath,
      files: tarFiles.length,
      staging: opts.keepStaging ? stage : null,
      bridgeStaged: bridge.files.map((f) => f.rel)
    };
  }

  // F4：把引导器三件投放到 rawfile（**默认开**；`--skip-rawfile` 可关）。
  // 应用侧用 `getRawFileContentSync` 物化它们 —— 路线 ② 的 bootstrap.js 必须在解包**之前**就可执行，
  // 而 HAR 不带 payload/，rawfile 是唯一随包通道（`rawfile/lib/tar-extract.js` 保留 lib 层级）。
  if (opts.skipRawfile) {
    console.log('· --skip-rawfile：未投放引导器三件到 rawfile（路线 ② 将无法物化 bootstrap）');
  } else {
    console.log(`→ rawfile 投放（应用物化引导器用）：${opts.rawfile}`);
    await fsp.mkdir(opts.rawfile, { recursive: true });
    await stageBridgeFiles(bridge.files, opts.rawfile, 'rawfile');
    report.rawfile = { dir: opts.rawfile, files: bridge.files.map((f) => f.rel) };
  }
  if (opts.json !== '') {
    await fsp.mkdir(path.dirname(opts.json), { recursive: true });
    await fsp.writeFile(opts.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`报告已写入  : ${opts.json}`);
  }
  console.log('✓ 组装完成');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`✗ 组装失败：${err && err.message ? err.message : String(err)}`);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  });
