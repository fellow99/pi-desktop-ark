#!/usr/bin/env node
/**
 * assemble-payload.mjs —— 把 `pi-dist` 组装成**可投放的载荷**（零依赖，ESM）。
 *
 * 目的（工程规划 §7 / Phase 1 第 1 条）：一条命令完成「复制 → 按规则裁剪 → 投放/打包」，
 * 并且**每一步都可审计**：默认是 dry run，只报告「会删掉什么、会得到多大」，
 * 不动任何文件、更不动源目录。
 *
 * 两条投放路线（§7.1 二选一）：
 *   ② `--route tar`（**默认，也是本应用实际使用的产品路线**）：把裁剪后的树复制到暂存目录，
 *      打成单个 `tar.gz`（`--format=ustar` 同级的确定性 ustar 写入器，见下），投放到
 *      `entry/src/main/resources/resfile/pi-web/pi-web.tar.gz`，并写同目录的
 *      `pi-web.version`（首行 = 归档的 sha256，形状镜像 pi-desktop-hos/pi-dist.version）。
 *      运行期：`PiDesktopRuntime` 用 **fs 实检 resfile** 判路线，把归档路径 + sha256 交给库，
 *      由 `bootstrap.js` 解包到 `<filesDir>/payload/<sha256[:12]>/`（幂等：marker 命中即跳过）。
 *   ① `--route readonly`（**诊断/演进用，当前不发**）：载荷**原样**放进 `resfile/pi-web/`，
 *      Node 从只读安装目录直读 ⇒ 零解压。⚠️ 它会把 2.7 万文件塞进 resfile，hvigor 打包会
 *      明显变慢甚至中止（`pi-desktop-hos/scripts/collect-pi.mjs:7` 的实测结论），因此不是默认。
 *
 * 为什么归档必须落 **resfile** 而不是 rawfile：HAP 里只有 resfile 是安装后落盘的**真实目录**，
 * rawfile 只能经 `resourceManager` 读 —— Node 侧的 `fs` 打不开它（`scriptPath` / 归档都必须是
 * 真实文件路径）。pi-desktop-hos 同形：`resfile/resources/app/pi-dist.tar.gz`（collect-app.mjs:5-14）。
 *
 * 纪律：
 *   · **源目录只读**：裁剪发生在**复制过程中**（fs.cp 的 filter），不是「先拷完再删」——
 *     源目录必须保持原样，随时可以重跑；
 *   · 默认 **dry run**；只有显式 `--apply` 才写盘；
 *   · 绝不写到项目目录之外，除非 `--out` 明确指到外面（此时会警告）；
 *   · 每个被跳过/保留的项都打印出来，供评审逐条核对（裁剪是删东西，不能只报总计）。
 *
 * 用法：
 *   node scripts/assemble-payload.mjs                       # dry run，路线 ②，报告裁剪明细
 *   node scripts/assemble-payload.mjs --apply               # 产出 resfile/pi-web/{pi-web.tar.gz,pi-web.version}
 *   node scripts/assemble-payload.mjs --route readonly --apply   # 诊断用：整树投放（慢，勿入库）
 *   node scripts/assemble-payload.mjs --from <pi-dist> --out <dir> --json report.json --force
 */

import { createHash } from 'node:crypto';
import { createGunzip, createGzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CROP_RULES,
  assertKeepSound,
  firstMatchingRule,
  isExpectedOverlap,
  patternHits,
  ruleMatchesDir,
  ruleMatchesFile
} from './crop-rules.mjs';

import { applyJitlessShape } from './jitless-shape.mjs';


const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 项目根 = scripts/ 的上一级 */
const PROJECT_ROOT = path.resolve(HERE, '..');
const DEFAULT_FROM = path.resolve(PROJECT_ROOT, '..', 'pi-desktop-hos', 'pi-dist');
/** 载荷投放目录 = HAP 的 `resources/resfile/pi-web/`（**安装后落盘的真实目录**，Node 的 fs 可读） */
const RESFILE_PAYLOAD_DIR = path.join(PROJECT_ROOT, 'entry', 'src', 'main', 'resources', 'resfile', 'pi-web');
/** 路线 ①（诊断用）：整棵树原样投放；路线 ② 完全不碰这个形态 */
const DEFAULT_OUT_READONLY = RESFILE_PAYLOAD_DIR;
/** 路线 ② 的暂存目录（默认在项目的 build/ 下，已被 .gitignore 的 `/**\/build/` 覆盖） */
const DEFAULT_STAGE = path.join(PROJECT_ROOT, 'build', 'payload-stage');
/** 归档产物（resfile 内；与 `PiDesktopRuntime` 的 `ARCHIVE_REL = 'pi-web/pi-web.tar.gz'` 一一对应） */
const DEFAULT_TAR = path.join(RESFILE_PAYLOAD_DIR, 'pi-web.tar.gz');
/** 归档的 sha256 版本文件（resfile 内；对应 `ARCHIVE_VERSION_REL = 'pi-web/pi-web.version'`） */
const DEFAULT_VERSION = path.join(RESFILE_PAYLOAD_DIR, 'pi-web.version');

/**
 * 库自带 Node 侧载荷目录（vendored：`vendor/node-bridge-payload/`）。
 *
 * ⚠️ F4：`payload/` 三件**不在 HAR 里**（已知打包缺口：HAR 只带 ArkTS/原生代码）—— 应用必须自己投放。
 * 路线 ② 的投放点是 **`resfile/pi-web/`**：`bootstrap.js` 是交给库的 `scriptPath`（`node::Start`
 * 实际执行的脚本），必须能被 Node 的 `fs` 直接打开 —— rawfile 做不到（那不是磁盘目录）。
 * 归档内部也带一份（`pi-web/` 层），因为 `pi-web-launch.js` 只在 `__dirname` / payloadRoot 下找 `host.js`。
 *
 * 历史：这三件原先取自旁路的 `../ohos-node-bridge/payload/`；库上架 ohpm 中心仓后
 * （`@fellow99/node-bridge@0.1.0`），payload/ 仍不随 HAR 分发 ⇒ vendored 进本工程
 * （`vendor/node-bridge-payload/`，来源与同步说明见其 README）。
 */
const DEFAULT_BRIDGE = path.join(PROJECT_ROOT, 'vendor', 'node-bridge-payload');
/** 必须随包投放的三件（保留相对路径：bootstrap 以同级 `host.js` 与 `./lib/tar-extract.js` 为依赖） */
const BRIDGE_PAYLOAD_FILES = ['bootstrap.js', 'host.js', 'lib/tar-extract.js'];
/** 入口脚本名（与 payload/ 下的文件名一致；库侧 entry 会指向它） */
const ENTRY_REL = 'pi-web-launch.js';
/**
 * 归档（路线 ②）内的根目录名。
 *
 * 为什么必须与路线 ① 的目录名一致：两条路线给库的 `entry` 都是 `pi-web/pi-web-launch.js`
 * （`PiDesktopRuntime.buildPlan` 的实际取值），路线 ② 把它解到 `<payloadRoot>/<sha256[:12]>/`
 * ⇒ 只有归档内自带 `pi-web/` 这一层，落点才会是 `<…>/pi-web/pi-web-launch.js`。
 */
const TAR_ROOT = 'pi-web';
/**
 * 应用自己的载荷覆盖层（本工程 `payload/`）：启动器 + 环境契约 + 预置扩展/配置。
 *
 * 为什么由本脚本投放：这三类文件**不在 pi-dist 里**（它们属于本工程），缺了启动器
 * `entry` 直接缺失、缺了 `env.js` 启动器 `require('./env.js')` 立刻失败（实测缺陷）。
 * `payload/README.md` 刻意不投放（文档不进载荷）。
 */
const APP_PAYLOAD_DIR = path.join(PROJECT_ROOT, 'payload');
const APP_PAYLOAD_ENTRIES = ['pi-web-launch.js', 'env.js', 'extensions', 'skills', 'config', 'jitless'];

// ── 命令行解析 ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    from: DEFAULT_FROM,
    out: '',
    route: 'tar',
    apply: false,
    force: false,
    keepStaging: false,
    json: '',
    quiet: false,
    bridge: DEFAULT_BRIDGE,
    piWeb: DEFAULT_PI_WEB,
    patchDir: DEFAULT_PATCH_DIR,
    piWebNode: process.execPath,
    skipPatches: false,
    keepPatches: false
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
      case '--apply': opts.apply = true; break;
      case '--force': opts.force = true; break;
      case '--pi-web': opts.piWeb = path.resolve(next()); break;
      case '--patch-dir': opts.patchDir = path.resolve(next()); break;
      case '--pi-web-node': opts.piWebNode = path.resolve(next()); break;
      case '--skip-patches': opts.skipPatches = true; break;
      case '--keep-patches': opts.keepPatches = true; break;
      case '--keep-staging': opts.keepStaging = true; break;
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
    '  --out <dir>       路线 ① = 投放目录；路线 ② = 暂存目录（归档永远写到 resfile/pi-web/）',
    '  --route <r>       tar（默认，单个 tar.gz + pi-web.version，发版用）| readonly（诊断用，整树投放）',
    '  --apply           真正写盘（默认只做 dry run 并打印计划）',
    '  --force           目标已存在且非空时也继续（会先清空目标）',
    '  --keep-staging    路线 ②：保留暂存目录（默认打完包就删）',
    '  --bridge <dir>    库载荷三件目录（默认 vendor/node-bridge-payload/）；随包投放（resfile + 归档内各一份）',
    '  --pi-web <dir>    被 patch 的上游工作树（默认 ../pi-web；其 HEAD 必须正好是 --patch-tag 那个 tag）',
    '  --patch-dir <dir> 上游补丁目录（默认 patches/v0.12.1/，按被 patch 的上游 tag 命名）',
    '  --pi-web-node <p> 重新编译 pi-web 用的 node（默认当前 node；必须与装 node_modules 的那个一致）',
    '  --skip-patches    不应用上游补丁（诊断用；载荷因此带着未打补丁的语义）',
    '  --keep-patches    跑完不还原 pi-web（默认还原成 pristine）',
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
    // 逐文件判定（**不再**排除「父目录被整目录裁掉」的文件）：整目录裁掉的文件同样是「会被删掉的文件」，
    // 排除它们会让计划数比实际少（实测差 4 个文件：node_modules/node-pty 顶层文件按目录裁剪走）。
    const matches = CROP_RULES.filter((rule) => ruleMatchesFile(file.rel, rule));
    if (matches.length === 0) {
      // 白名单保住的也会走到这里（matchesFileForRule 已排除），用一次额外判定把「被保留」单独记录
      const keptBy = CROP_RULES.find((rule) => patternHits(rule.pattern, file.rel));
      if (keptBy) kept.push({ rule: keptBy, file });
      else survivors.push(file);
      continue;
    }
    // 预期重叠（规则自己声明了 expectOverlapWith）不算告警，但仍计入「实际重叠」以便评审核对。
    if (matches.length > 1) {
      const first = matches[0].id;
      const unexpected = matches.slice(1).filter((rule) => !isExpectedOverlap(first, rule.id));
      if (unexpected.length > 0) overlaps.push({ file, rules: matches.map((r) => r.id) });
    }
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
  if (opts.route === 'tar') console.log(`归档目标    : ${DEFAULT_TAR}（+ ${DEFAULT_VERSION}）`);
  console.log(`库载荷三件  : ${opts.bridge}/payload → ${BRIDGE_PAYLOAD_FILES.join(' / ')}（投放 resfile/pi-web/ + 归档内各一份）`);
  console.log(`应用载荷覆盖: ${APP_PAYLOAD_ENTRIES.join(' / ')}（同上，缺失则 entry/env 契约都不成立）`);
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
 * 去掉 Windows 扩展长度路径前缀（`\\?\` / `\\?\UNC\`）。
 *
 * 为什么必须有这一步（**实测根因**，见 DEV_CHECKLIST）：
 * `fs.cp` 把 filter 的 `src` 参数交给回调时，**Node 18 会带上 `\\?\C:\…` 前缀，Node 24 不带**。
 * 于是 `path.relative(fromDir, src)` 在 Node 18 下算出 `..\..\?\C:\…` 这类**垃圾相对路径**，
 * 所有裁剪规则都失配 ⇒ filter 对每个条目都返回 true ⇒ **整树被静默原样复制**（实测：
 * `--apply` 产出 27,232 文件 / 884,167,367 B = 源树原样，而 dry run 报告「应裁 142 文件」）。
 * 判据两端都先归一化，两种 Node 行为就一致了。
 */
function stripLongPathPrefix(text) {
  const value = String(text);
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  if (value.startsWith('\\\\?\\')) return value.slice(4);
  if (value.startsWith('//?/UNC/')) return `//${value.slice(8)}`;
  if (value.startsWith('//?/')) return value.slice(4);
  return value;
}

/**
 * 用 `fs.cp(..., { filter })` 做**流式**复制，并在 filter 里执行裁剪：
 * 被裁掉的文件**根本不复制**（源目录保持原样，也就不存在「拷完再删」的中间态）。
 * @returns {{ copiedFiles: number, copiedBytes: number, skippedFiles: number, skippedBytes: number, keptFiles: number }}
 */
async function copyCropped(fromDir, toDir, opts) {
  const fromNorm = stripLongPathPrefix(fromDir);
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
      const rel = path.relative(fromNorm, stripLongPathPrefix(src)).split(path.sep).join('/');
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
 *
 * ⚠️ 目录条目（名字以 `/` 结尾）必须先摘掉结尾的 `/` 再拆分：直接按最后一个 `/` 拆会得到
 * `name=''` + `prefix=<整条路径>`，而**空名字的头块首字节是 0** —— 读端（库的
 * `lib/tar-extract.js`）会把它当成「归档结束块」，于是整卷解包在第一个长目录处硬失败
 * （实测：`FATAL tar: malformed end block ... at offset 3072`，27k 文件一个都没解出来）。
 */
function splitUstarName(name) {
  const bytes = (text) => Buffer.byteLength(text, 'utf8');
  const isDir = name.endsWith('/');
  // 目录名去掉结尾 '/' 后再算长度；能整体放进 100 字节就保持原样（含结尾 '/'）
  const core = isDir ? name.slice(0, -1) : name;
  if (bytes(name) <= 100) {
    return { headerName: name, prefix: '' };
  }
  const slash = core.lastIndexOf('/');
  if (slash > 0) {
    const prefix = core.slice(0, slash);
    const base = core.slice(slash + 1);
    const headerName = isDir ? `${base}/` : base;
    if (bytes(headerName) <= 100 && bytes(prefix) <= 155) {
      return { headerName, prefix };
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
    const dirName = `${dir}/`;
    const dirNeedsLongName = splitUstarName(dirName) === null;
    if (dirNeedsLongName) {
      const longDir = Buffer.from(dirName, 'utf8');
      await write(ustarHeader('././@LongLink', longDir.length + 1, 'L'));
      await write(Buffer.concat([longDir, Buffer.from([0])]));
      await write(Buffer.alloc(padTo512(longDir.length + 1)));
    }
    await write(ustarHeader(dirNeedsLongName ? truncateUtf8Bytes(dirName, 100) : dirName, 0, '5'));
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

// ── 上游补丁（pi-web）：应用到载荷组装里，**不靠手改工作树** ────────────────────
/**
 * 本工程的上游补丁纪律（与 `pi-desktop-hos/patches/README.md` §「新增补丁时必须遵守的规则」
 * 及 `pi-desktop-hos/scripts/prepare-next.mjs` 阶段 1b 同一条）：
 *   ① **幂等**：先 `git apply --reverse --check`，命中即视为「已应用」→ 跳过（no-op）；
 *   ② **冲突即终止**：绝不 `--3way`，绝不覆盖上游工作树里的用户改动；
 *   ③ **可往返**：应用 → 反向 → 断言受影响文件的 SHA-256 逐条还原；
 *   ④ **按上游 tag 组织**：`patches/<pi-web tag>/NNNN-name.patch`；
 *   ⑤ **收尾还原**：默认跑完把 pi-web 还原成 pristine（`--keep-patches` 可留）。
 *
 * 为什么补丁要参与**载荷组装**而不是「构建前手工 apply 一下」：载荷（`--from`，默认
 * `../pi-desktop-hos/pi-dist`）是**已编译的 Next 产物** —— `.next/server/app/api/terminal/route.js`
 * 是 webpack 打包后的 JS，源码补丁不重新编译就不会生效。因此本脚本按「补丁 → 编译 → 打包」
 * 的顺序自己把这件事做完，并在打包前用**标记串**断言产物真的换了，否则 exit 2：
 * 组装结果因此不再依赖「某个人记得在本地先 apply」，也不会静默产出旧载荷。
 */
const PI_WEB_PATCH_TAG = 'v0.12.1';
/** 被 patch 的上游工作树（与 prepare-next.mjs 同一个：`../pi-web`） */
const DEFAULT_PI_WEB = path.resolve(PROJECT_ROOT, '..', 'pi-web');
/** 补丁目录：按**被 patch 的上游 tag** 命名，与 pi-desktop-hos/patches/ 同构 */
const DEFAULT_PATCH_DIR = path.join(PROJECT_ROOT, 'patches', PI_WEB_PATCH_TAG);
/**
 * 载荷里必须出现的标记（每条补丁一个）—— 用来识别「pi-dist 还是旧编译产物」。
 *
 * 为什么是**一张表**而不是一个常量：编译产物是 webpack 打出来的，源码补丁只有
 * 重新编译才会生效。以前只认终端补丁的标记，于是「只有终端补丁变了」能触发重编，
 * 而新加的 cwd 补丁不会 —— 载荷会安静地带着旧语义发出去。每条补丁都必须能被
 * 自己的标记断言到，否则整体判为「未重编」。
 *
 * 标记都取自**路由 bundle 里必然出现的字面量**（Next 会把 `@/lib/*` 内联进
 * `route.js`，终端补丁的 `terminal.pty` 就是这样被断言到的）：
 *   · `PI_HOS_ROOTS`         —— `lib/directory-browser.ts` 读宿主声明的工作区根；
 *   · `pi-hos-sandbox-alias` —— `lib/hos-sandbox-path.ts` 的编译期标记（写在 hint 里）；
 *   · `pi-hos-picker-contract` —— 选择器契约（E14）的编译期标记：`app/api/cwd/browse/route.ts`
 *     的每个响应都带 `contract` 字段，字面量来自 `lib/directory-browser.ts`
 *     `PICKER_CONTRACT_MARKER`（前端组件里的字面量**不会**进这个 server bundle）。
 */
const PI_WEB_PATCH_MARKERS = [
  { rel: '.next/server/app/api/terminal/route.js', marker: 'terminal.pty' },
  { rel: '.next/server/app/api/cwd/browse/route.js', marker: 'PI_HOS_ROOTS' },
  { rel: '.next/server/app/api/cwd/validate/route.js', marker: 'pi-hos-sandbox-alias' },
  { rel: '.next/server/app/api/sessions/[id]/export/route.js', marker: 'pi-hos-export-runtime-guard' },
  { rel: '.next/server/app/api/cwd/browse/route.js', marker: 'pi-hos-picker-contract' },
  { rel: '.next/server/app/api/host/perm/route.js', marker: 'pi-hos-perm-manual' }
];

/** 补丁阶段的失败（main 捕获后 exit 2：这是「输入不满足」，不是脚本 bug） */
class PatchStageError extends Error {}

function runGit(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return {
    ok: !res.error && res.status === 0,
    out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
    error: res.error
  };
}

function sha256Sync(absPath) {
  try {
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;   /* 补丁新增的文件：应用前不存在 ⇒ null（往返后必须仍是 null） */
  }
}

/** 从补丁里取受影响文件（`+++ b/<rel>`；`/dev/null` 表示新增/删除） */
function patchAffectedFiles(patchPath) {
  const text = fs.readFileSync(patchPath, 'utf8');
  const seen = new Set();
  for (const line of text.split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m && m[1] !== '/dev/null') seen.add(m[1].replace(/\r$/, ''));
  }
  return [...seen];
}

/** 载荷里缺少的补丁标记（空数组 = 已是最新编译产物；非空 ⇒ 需要重新编译） */
function missingPatchMarkers(fromDir) {
  const missing = [];
  for (const { rel, marker } of PI_WEB_PATCH_MARKERS) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(fromDir, rel), 'utf8');
    } catch {
      text = '';
    }
    if (!text.includes(marker)) missing.push(`${rel}（缺「${marker}」）`);
  }
  return missing;
}

/**
 * 幂等应用 `patches/<tag>/*.patch`（按文件名排序 ⇒ 确定性）。
 * 返回 `{ applied: [name], skipped: [name] }`；任何一步不符合纪律 ⇒ 抛 PatchStageError。
 */
function applyPiWebPatches(opts) {
  const dir = opts.patchDir;
  if (!fs.existsSync(dir)) return { applied: [], skipped: [], present: false };
  const patches = fs.readdirSync(dir).filter((n) => n.endsWith('.patch')).sort();
  if (patches.length === 0) return { applied: [], skipped: [], present: false };

  const head = runGit(['rev-parse', 'HEAD'], opts.piWeb);
  if (!head.ok) throw new PatchStageError(`pi-web 不是可用的 git 工作树：${opts.piWeb}（${head.out}）`);
  const describe = runGit(['describe', '--tags', '--exact-match', 'HEAD'], opts.piWeb);
  if (!describe.ok || describe.out !== PI_WEB_PATCH_TAG) {
    throw new PatchStageError(
      `pi-web HEAD 不在被 patch 的上游 tag 上：期望 ${PI_WEB_PATCH_TAG}，`
      + `实测 ${describe.ok ? describe.out : `(无 tag) ${head.out.slice(0, 12)}`}`
      + '（补丁按上游 tag 组织，别在错误基线上打）',
    );
  }

  const applied = [];
  const skipped = [];
  for (const name of patches) {
    const patchPath = path.join(dir, name);
    if (runGit(['apply', '--reverse', '--check', patchPath], opts.piWeb).ok) {
      skipped.push(name);   /* 幂等：已应用 ⇒ 跳过 */
      continue;
    }
    const check = runGit(['apply', '--check', patchPath], opts.piWeb);
    if (!check.ok) {
      throw new PatchStageError(`补丁与当前 pi-web 工作树冲突，中止（不得 --3way）：${name}\n  ${check.out}`);
    }
    const files = patchAffectedFiles(patchPath);
    const before = files.map((rel) => [rel, sha256Sync(path.join(opts.piWeb, rel))]);
    if (!runGit(['apply', patchPath], opts.piWeb).ok) {
      throw new PatchStageError(`补丁应用失败：${name}`);
    }
    if (!runGit(['apply', '--reverse', patchPath], opts.piWeb).ok) {
      throw new PatchStageError(`补丁反向应用失败（可往返性被破坏）：${name}`);
    }
    for (const [rel, sha] of before) {
      const now = sha256Sync(path.join(opts.piWeb, rel));
      if (now !== sha) {
        throw new PatchStageError(`补丁往返校验失败：${rel} 未还原（${sha} → ${now}）：${name}`);
      }
    }
    if (!runGit(['apply', patchPath], opts.piWeb).ok) {
      throw new PatchStageError(`补丁正式应用失败：${name}`);
    }
    console.log(`上游补丁    : ${name} → pi-web@${PI_WEB_PATCH_TAG}`
      + `（往返校验通过：${files.length} 文件 SHA-256 还原）`);
    applied.push(name);
  }
  return { applied, skipped, present: true };
}

/** 还原本次应用的全部补丁（pi-web 收尾必须是 pristine） */
function revertPiWebPatches(opts, names) {
  const failed = [];
  for (const name of [...names].reverse()) {
    const r = runGit(['apply', '--reverse', path.join(opts.patchDir, name)], opts.piWeb);
    if (!r.ok) failed.push(`${name}: ${r.out}`);
  }
  return failed;
}

/**
 * 用**打了补丁的源码**重新编译 pi-web，并把 `.next` 镜像进载荷源目录。
 *
 * 只镜像 `.next`（不跑 collect-pi）：`pi-dist` 的其余部分（node_modules / public / package.json）
 * 与源码无关；`.next/cache`、`.next/dev` 与 `*.nft.json` 一律不拷（后者由 crop-rules 裁掉，
 * 拷了也只是白搬 348 MB）。
 */
async function rebuildPiWebInto(opts) {
  const nextBin = path.join(opts.piWeb, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!fs.existsSync(nextBin)) {
    throw new PatchStageError(`找不到 next 入口：${nextBin}（pi-web 依赖未安装？）`);
  }
  console.log(`载荷刷新    : pi-dist 缺少补丁标记 ⇒ 用打了补丁的源码重新编译`);
  console.log(`              缺：${missingPatchMarkers(opts.from).join('｜')}`);
  console.log(`              node = ${opts.piWebNode}`);
  console.log(`              next build --webpack（cwd=${opts.piWeb}）`);
  const started = Date.now();
  const res = spawnSync(opts.piWebNode, [nextBin, 'build', '--webpack'], {
    cwd: opts.piWeb,
    encoding: 'utf8',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    maxBuffer: 64 * 1024 * 1024
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const tail = output.trim().split('\n').slice(-12).map((l) => `              │ ${l}`).join('\n');
  if (res.error || res.status !== 0) {
    throw new PatchStageError(`next build 失败（status=${res.status ?? 'n/a'}）：\n${tail}`);
  }
  console.log(`              next build 完成：${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.log(tail);

  const srcNext = path.join(opts.piWeb, '.next');
  const dstNext = path.join(opts.from, '.next');
  /*
   * ⚠️ 必须先**清空**目标 `.next` 再镜像：增量覆盖会留下上一次构建的 chunk 与
   * `page_client-reference-manifest`/HTML 里指向的旧 chunk 名 —— 实测症状是
   * 「服务端路由已是新的，但页面加载的仍是旧 chunk」（2026-10-19，选择器补丁 0006）。
   */
  fs.rmSync(dstNext, { recursive: true, force: true });
  console.log(`              [mirror] 已清空旧目标：${dstNext}`);
  const skip = (p) => {
    const base = path.basename(p);
    if (base === 'cache' || base === 'dev') return true;
    return base.endsWith('.nft.json');
  };
  await fsp.mkdir(dstNext, { recursive: true });
  fs.cpSync(srcNext, dstNext, { recursive: true, force: true, filter: (p) => !skip(p) });
  const copied = walkTree(dstNext).filter((f) => f.error === undefined);
  console.log(`              已镜像 .next → ${dstNext}（${copied.length} 文件 / ${human(totalBytes(copied))}）`);
  const stillMissing = missingPatchMarkers(opts.from);
  if (stillMissing.length > 0) {
    throw new PatchStageError(`重新编译后载荷里仍找不到补丁标记：${stillMissing.join('｜')}`
      + ' —— 补丁没进编译产物，不能打包');
  }
  console.log(`载荷断言    : ${PI_WEB_PATCH_MARKERS.length} 条补丁标记全部命中 ✔`);
}

/**
 * 归档可读性自检（**回归检查**：写出来的 tar 必须能被读端逐块走通）。
 *
 * 起因是一次实测：名字超过 100 字节的**目录条目**被写成 `name='' + prefix=<整条路径>`，
 * 而空名字的头块首字节就是 0 ⇒ 库的 `lib/tar-extract.js` 把它当成「归档结束块」并抛
 * `malformed end block`，真机上 27k 个文件一个都没解出来（App 不崩、只是永远起不来）。
 * 这里按 ustar 规范逐块推进：名字不得为空、结束块必须整块全 0、数据必须按 size 对齐。
 * @returns {Promise<{files: number, dirs: number, longNames: number, ended: boolean}>}
 */
async function assertArchiveReadable(tarPath) {
  const BLOCK = 512;
  const counters = { files: 0, dirs: 0, longNames: 0 };
  return await new Promise((resolve, reject) => {
    const input = fs.createReadStream(tarPath);
    const gunzip = createGunzip();
    let carry = Buffer.alloc(0);
    let bufStart = 0;
    let state = 'header';
    let entry = null;
    let ended = false;
    let failed = false;
    const isZero = (block) => {
      for (let i = 0; i < block.length; i += 1) if (block[i] !== 0) return false;
      return true;
    };
    const fieldText = (buf, start, end) => buf.subarray(start, end).toString('utf8').replace(/\0+$/, '');
    const push = (chunk) => {
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      let pos = 0;
      while (pos < buf.length) {
        if (state === 'header') {
          if (buf.length - pos < BLOCK) break;
          const header = buf.subarray(pos, pos + BLOCK);
          const at = bufStart + pos;
          pos += BLOCK;
          if (header[0] === 0) {
            if (!isZero(header)) {
              throw new Error(`归档在偏移 ${at} 处的头块首字节为 0 却不是全 0 块（空名字条目会被读端当成结束标记）`);
            }
            ended = true;
            carry = Buffer.alloc(0);
            return;
          }
          const name = fieldText(header, 0, 100);
          const prefix = fieldText(header, 345, 500);
          if (name.length === 0) {
            throw new Error(`归档在偏移 ${at} 处的条目名称为空（prefix=${prefix === '' ? '(空)' : prefix}）`);
          }
          const sizeText = header.subarray(124, 136).toString('latin1').replace(/\0/g, ' ').trim();
          const size = sizeText === '' ? 0 : parseInt(sizeText, 8);
          const type = String.fromCharCode(header[156]);
          if (type === '5') counters.dirs += 1;
          else if (type === 'L') counters.longNames += 1;
          else if (type === '0' || type === '\0') counters.files += 1;
          else throw new Error(`归档含未预期的 typeflag=${JSON.stringify(type)}（${prefix === '' ? name : `${prefix}/${name}`}）`);
          entry = { size, remaining: size, padding: (BLOCK - (size % BLOCK)) % BLOCK };
          state = 'data';
          continue;
        }
        if (state === 'data') {
          const n = Math.min(entry.remaining, buf.length - pos);
          pos += n;
          entry.remaining -= n;
          if (entry.remaining === 0) {
            state = 'padding';
            continue;
          }
          break;
        }
        const n = Math.min(entry.padding, buf.length - pos);
        pos += n;
        entry.padding -= n;
        if (entry.padding === 0) {
          entry = null;
          state = 'header';
        } else {
          break;
        }
      }
      carry = pos < buf.length ? Buffer.from(buf.subarray(pos)) : Buffer.alloc(0);
      bufStart += pos;
    };
    gunzip.on('data', (chunk) => {
      if (failed) return;
      try {
        push(chunk);
      } catch (err) {
        failed = true;
        input.destroy();
        gunzip.destroy();
        reject(err);
      }
    });
    gunzip.on('end', () => {
      if (failed) return;
      if (!ended) {
        reject(new Error('归档缺少全 0 结束块（尾部残片非 0 或头部被截断）'));
        return;
      }
      resolve({ files: counters.files, dirs: counters.dirs, longNames: counters.longNames, ended });
    });
    gunzip.on('error', reject);
    input.on('error', reject);
    input.pipe(gunzip);
  });
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

/** 待还原的补丁（正常收尾 / 失败 / 异常退出都走同一个还原点，保证 pi-web 结束是 pristine） */
let g_pendingPatchRevert = null;
/** 当前运行参数（顶层 catch 里还原补丁也要用） */
let g_activeOpts = null;

function revertPiWebPatchesOnce() {
  if (!g_pendingPatchRevert || g_pendingPatchRevert.length === 0) return;
  const names = g_pendingPatchRevert;
  g_pendingPatchRevert = null;
  if (g_activeOpts && g_activeOpts.keepPatches) {
    console.log(`上游补丁    : --keep-patches ⇒ 保留在 pi-web（${names.join(', ')}）`);
    return;
  }
  const failed = revertPiWebPatches(g_activeOpts, names);
  if (failed.length > 0) {
    console.error(`✗ pi-web 还原失败（工作树不再是 pristine）：\n    ${failed.join('\n    ')}`);
  } else {
    console.log(`上游补丁    : 已还原 pi-web pristine（${names.join(', ')}）`);
  }
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

/**
 * 收集**应用自己的载荷覆盖层**（`payload/`：`pi-web-launch.js` + `env.js` + `extensions/` + `config/`）。
 *
 * 为什么不能漏：这三类文件不在 `pi-dist` 里（它们属于本工程），实测漏投的后果是
 * `report.target.entryPresent=false`、真机上启动器 `require('./env.js')` 直接失败。
 * @returns {{ root: string, files: Array<{rel: string, abs: string, bytes: number}>, missing: string[] }}
 */
function collectAppPayloadFiles(appDir) {
  const files = [];
  const missing = [];
  for (const entry of APP_PAYLOAD_ENTRIES) {
    const abs = path.join(appDir, entry);
    if (!fs.existsSync(abs)) {
      missing.push(abs);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      files.push({ rel: entry, abs, bytes: stat.size });
      continue;
    }
    for (const child of walkTree(abs).filter((f) => f.error === undefined)) {
      /*
       * 108-jitless：自检脚本**不进发布归档**。
       * 理由：它们会在临时目录里造 `node_modules`、起本地 HTTP 服务，属开发期工具；
       * 打进载荷只是把几十 KB 可执行测试代码送到用户设备（无用且扩大攻击面）。
       * 源码仍在 `payload/jitless/selftest/`（PC 侧跑 TC-108-xx 用）。
       *
       * ⚠️ `child.rel` 是**相对 entry 目录**的路径（不含 entry 名），所以这里判 `selftest/`
       * 且 entry 必须是 jitless —— 写成 `jitless/selftest/` 永远命中不了（本轮踩过）。
       */
      if (entry === 'jitless' && child.rel.startsWith('selftest/')) continue;
      files.push({ rel: `${entry}/${child.rel}`, abs: child.abs, bytes: child.size });
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { root: appDir, files, missing };
}

/**
 * 裁剪生效断言（**回归检查**：Dry run 说裁了、`--apply` 必须真的裁掉）。
 *
 * 起因是一次实测：dry run 报告「将裁剪 142 文件」，`--apply` 却产出 27,232 文件 / 884,167,367 B
 * （= 源树原样）。根因是 Node 18 给 filter 的 `src` 带 `\\?\` 前缀（见 stripLongPathPrefix）。
 * 光修那一处还不够 —— 断言必须留在流程里，否则「规则静默失配」还能再发生一次。
 * @returns {{ files: number, wasmSwcFiles: number }}
 */
function assertCropApplied(targetDir, stats, plan) {
  const files = walkTree(targetDir).filter((f) => f.error === undefined);
  // 判据**只有一份**：直接用 crop-rules.mjs 的 ruleMatchesFile（含 keepPathMarkers / skipPrefixes），
  // 不再在这里手写第二份「禁项清单」—— 两份清单迟早会不一致（上一轮就是这么漏掉 @tailwindcss 的）。
  const violations = [];
  for (const file of files) {
    for (const rule of CROP_RULES) {
      if (ruleMatchesFile(file.rel, rule)) {
        violations.push(`[${rule.id}] ${file.rel}`);
        break;
      }
    }
  }
  const wasmSwc = files.filter((f) => f.rel.startsWith('node_modules/next/wasm/@next/swc-wasm-nodejs/'));
  let plannedFiles = 0;
  if (plan) for (const bucket of plan.perRule.values()) plannedFiles += bucket.files.length;
  const croppedEntries = stats ? stats.skippedFiles + stats.skippedDirs : 0;
  if (plannedFiles > 0 && croppedEntries === 0) {
    throw new Error(`裁剪未生效：dry run 计划裁 ${plannedFiles} 个条目，实际裁掉 0 个（filter 判据与 plan 的 matcher/路径形态不一致）`);
  }
  if (violations.length > 0) {
    throw new Error(`裁剪后目标树仍含被裁项（${violations.length} 个，前 5 个）：`
      + `\n        ${violations.slice(0, 5).join('\n        ')}`);
  }
  if (wasmSwc.length === 0) {
    throw new Error('裁剪后目标树缺少 node_modules/next/wasm/@next/swc-wasm-nodejs/'
      + '（端上唯一可用的 SWC 是 WASM 版，白名单必须保住它）');
  }
  // 反向断言：@next/env 必须被保住（Next 的 next/dist 里有 14 处 require('@next/env')）
  const nextEnv = files.filter((f) => f.rel === 'node_modules/@next/env/dist/index.js');
  if (nextEnv.length === 0) {
    throw new Error('裁剪后目标树缺少 node_modules/@next/env/dist/index.js'
      + '（@next/env 是 JS 运行时模块，删掉后 Next 在真机上必然 Cannot find module）');
  }
  // 反向断言：纯 JS 依赖不许被 *.node 规则误伤（prepare-next.mjs:279-280 明示保留）
  for (const required of ['node_modules/undici/package.json', 'node_modules/@earendil-works/pi-coding-agent/package.json']) {
    if (!files.some((f) => f.rel === required)) {
      throw new Error(`裁剪后目标树缺少纯 JS 依赖：${required}（platform-native 规则必须跳过 undici/web-push/@earendil-works）`);
    }
  }
  return { files: files.length, wasmSwcFiles: wasmSwc.length, nextEnvFiles: nextEnv.length };
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
    console.error('  用 --bridge <目录> 指定库载荷三件目录（默认 vendor/node-bridge-payload/）。');
    return 2;
  }

  // 应用载荷覆盖层预检：启动器/env.js/extensions/config 由本工程提供（不在 pi-dist 里），
  // 缺失必须硬失败（否则真机上表现为「入口缺失 / require('./env.js') 抛错」）。
  const appPayload = collectAppPayloadFiles(APP_PAYLOAD_DIR);
  if (appPayload.missing.length > 0) {
    console.error('✗ 应用载荷覆盖层缺失（payload/ 下必须齐备，否则入口与 env 契约都投不进去）：');
    for (const missing of appPayload.missing) console.error(`    ${missing}`);
    return 2;
  }

  /*
   * 上游补丁阶段（**只在 --apply 时动手**，dry run 绝不碰 pi-web）：
   *   ① 幂等应用 patches/<tag>/*.patch（往返校验内建）；
   *   ② 载荷里没有补丁标记 ⇒ 用打了补丁的源码重新编译并镜像 .next（否则打出来的还是旧语义）；
   *   ③ 收尾还原 pi-web（--keep-patches 可留）。
   * 任何一步不满足 ⇒ exit 2（这是「输入不满足」，不是脚本 bug）。
   */
  let patchState = { applied: [], skipped: [], present: false };
  if (opts.apply && !opts.skipPatches) {
    try {
      g_activeOpts = opts;
      patchState = applyPiWebPatches(opts);
      g_pendingPatchRevert = patchState.applied;   /* 收尾/失败/异常都要还原 */
      if (patchState.present) {
        for (const name of patchState.skipped) console.log(`上游补丁    : ${name} 已应用 ⇒ 跳过（幂等）`);
        const missingBefore = missingPatchMarkers(opts.from);
        if (missingBefore.length > 0) {
          await rebuildPiWebInto(opts);
        } else {
          console.log(`载荷断言    : ${PI_WEB_PATCH_MARKERS.length} 条补丁标记已命中 ✔（无需重新编译）`);
        }
      }
    } catch (err) {
      if (!(err instanceof PatchStageError)) throw err;
      console.error(`✗ 上游补丁阶段失败：${err.message}`);
      console.error('  ⇒ 不产出「看起来只是没打补丁」的载荷；pi-web 还原如下：');
      revertPiWebPatchesOnce();
      return 2;
    }
  } else if (opts.apply && opts.skipPatches) {
    console.log('上游补丁    : --skip-patches ⇒ 未应用（载荷按当前 pi-dist 原样打包）');
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
    const cropCheck = assertCropApplied(target, stats, plan); // 回归检查：dry run 说裁了，这里必须真裁掉
    await stageBridgeFiles(bridge.files, target, '投放库载荷');
    console.log(`库载荷三件  : 已投放 ${bridge.files.length} 个（${BRIDGE_PAYLOAD_FILES.join(' / ')}）`);
    await stageBridgeFiles(appPayload.files, target, '投放应用载荷');
    console.log(`应用载荷覆盖: 已投放 ${appPayload.files.length} 个（${APP_PAYLOAD_ENTRIES.join(' / ')}）`);
    /*
     * 108-jitless：无 ACL 形态的载荷改造（`next.config.ts → .mjs`、`undici`/`photon` 条件入口）。
     * 放在**投放完覆盖层之后**：它要处理的是载荷树本身，与覆盖层无关；
     * 放在打包之前：改完必须被 `writeTarGz` 打进去（运行期不再改文件，否则幂等键会变）。
     */
    const jitlessReadonly = await applyJitlessShape(target, PROJECT_ROOT, opts);
    const readmePath = path.join(target, 'PAYLOAD_README.md');
    await fsp.writeFile(readmePath, payloadReadme(opts.route, stats.copiedFiles, stats.copiedBytes), 'utf8');
    const resultFiles = walkTree(target).filter((f) => f.error === undefined);
    const entryAbs = path.join(target, ENTRY_REL);
    console.log('── 结果 ─────────────────────────────────────────────────────────────────');
    console.log(`复制文件    : ${stats.copiedFiles} / ${human(stats.copiedBytes)}`);
    console.log(`裁剪文件    : ${stats.skippedFiles} 文件 + ${stats.skippedDirs} 个整目录 / ${human(stats.skippedBytes)}`);
    console.log(`裁剪断言    : 通过（0 个 *.nft.json / @next/swc-* 原生包 / @img / node-pty；WASM SWC ${cropCheck.wasmSwcFiles} 文件在位；@next/env 在位）`);
    console.log(`白名单保住  : ${stats.keptFiles} 文件`);
    console.log(`目标实测    : ${resultFiles.length + 1} 文件（含 PAYLOAD_README.md）/ ${human(totalBytes(resultFiles) + Buffer.byteLength(payloadReadme(opts.route, 0, 0)))}`);
    console.log(`说明文件    : ${readmePath}`);
    console.log(`入口        : ${entryAbs}（${fs.existsSync(entryAbs) ? '存在' : '缺失！载荷里必须带它'}）`);
    console.log(`库引导器    : ${path.join(target, BRIDGE_PAYLOAD_FILES[0])}`
      + `（${fs.existsSync(path.join(target, BRIDGE_PAYLOAD_FILES[0])) ? '存在' : '缺失！路线 ① 会判定失败'}）`);
    report.target = {
      kind: 'readonly',
      dir: target,
      files: stats.copiedFiles,
      bytes: stats.copiedBytes,
      entry: entryAbs,
      entryPresent: fs.existsSync(entryAbs),
      cropCheck,
      bridgeStaged: bridge.files.map((f) => f.rel),
      appPayloadStaged: appPayload.files.map((f) => f.rel),
      bootstrap: path.join(target, BRIDGE_PAYLOAD_FILES[0]),
      bootstrapPresent: fs.existsSync(path.join(target, BRIDGE_PAYLOAD_FILES[0])),
      jitless: jitlessReadonly
    };
  } else {
    const stage = assertWritableTarget(stageDir, opts.out);
    await assertEmptyOrForce(stage, opts.force);
    // 归档内必须自带 `pi-web/` 这一层：两条路线的 entry 都是 `pi-web/pi-web-launch.js`，
    // 路线 ② 解到 `<payloadRoot>/<sha256[:12]>/` ⇒ 落点才会是 `<…>/pi-web/pi-web-launch.js`。
    const tarRoot = path.join(stage, TAR_ROOT);
    console.log(`→ 暂存复制（裁剪在复制过程中执行）：${opts.from} → ${tarRoot}（归档内根目录 ${TAR_ROOT}/）`);
    const stats = await copyCropped(opts.from, tarRoot, opts);
    const cropCheck = assertCropApplied(tarRoot, stats, plan); // 回归检查：dry run 说裁了，这里必须真裁掉
    await stageBridgeFiles(bridge.files, tarRoot, '入归档');
    await stageBridgeFiles(appPayload.files, tarRoot, '入归档');
    applyWebBranding(tarRoot);
    console.log(`应用载荷覆盖: 已入归档 ${appPayload.files.length} 个（${APP_PAYLOAD_ENTRIES.join(' / ')}）`);
    /*
     * 108-jitless：无 ACL 形态的载荷改造（`next.config.ts → .mjs`、`undici`/`photon` 条件入口）。
     * 必须在**打包之前**（运行期不再改载荷树，否则 sha256 幂等键每次冷启都会变）：
     *   · 归档里不能有 `next.config.ts`（否则 Next 启动期走 SWC-WASM ⇒ 无 JIT 设备直接起不来）；
     *   · `undici.install()` 会覆写 `globalThis.fetch`，只能靠条件入口挡住。
     */
    const jitless = await applyJitlessShape(tarRoot, PROJECT_ROOT, opts);
    console.log(`jitless 改造 : 配置=${jitless.nextConfig.via}；undici ${jitless.undici.length} 个、`
      + `photon ${jitless.photon.length} 个包已条件化`);
    console.log(`→ 打包 tar.gz：${stage} → ${DEFAULT_TAR}`);
    const tarFiles = await writeTarGz(stage, DEFAULT_TAR, opts);
    const sha = await sha256File(DEFAULT_TAR);
    const shaShort = sha.slice(0, 12);
    const tarBytes = fs.statSync(DEFAULT_TAR).size;
    const entryAbs = path.join(tarRoot, ENTRY_REL);
    const entryPresent = fs.existsSync(entryAbs);
    // 版本文件与 pi-desktop-hos/pi-dist.version 同形：**首行 64 位 hex + \n**（65 B），
    // 前 64 hex = 幂等键（交给 options.archiveSha256）；审计信息只进控制台与 --json 报告，
    // 避免时间戳把版本文件变成非确定性产物（两次 --apply 必须得到同一个 sha256）。
    await fsp.writeFile(DEFAULT_VERSION, `${sha}\n`, 'utf8');
    const versionBytes = fs.statSync(DEFAULT_VERSION).size;
    const readable = await assertArchiveReadable(DEFAULT_TAR); // 回归检查：写出来的归档必须能被读端走通
    // 路线 ② 的**运行期依赖**也落在 resfile/pi-web/：bootstrap.js 是交给库的 scriptPath，
    // host.js / lib/tar-extract.js 是它的同级依赖 —— 三者都必须能被 Node 的 fs 直接打开。
    // ⚠️ 这里只投放**引导器三件 + 应用覆盖层**（几十 KB），绝不投放解开的 2.7 万文件树。
    console.log(`→ resfile 投放（运行期 fs 直读）：${RESFILE_PAYLOAD_DIR}`);
    await fsp.mkdir(RESFILE_PAYLOAD_DIR, { recursive: true });
    await stageBridgeFiles(bridge.files, RESFILE_PAYLOAD_DIR, 'resfile');
    const resfileBootstrap = path.join(RESFILE_PAYLOAD_DIR, BRIDGE_PAYLOAD_FILES[0]);
    const resfileHost = path.join(RESFILE_PAYLOAD_DIR, 'host.js');
    const resfileTarExtract = path.join(RESFILE_PAYLOAD_DIR, 'lib', 'tar-extract.js');
    console.log('── 结果 ─────────────────────────────────────────────────────────────────');
    console.log(`暂存文件    : ${stats.copiedFiles} / ${human(stats.copiedBytes)}`);
    console.log(`裁剪文件    : ${stats.skippedFiles} 文件 + ${stats.skippedDirs} 个整目录 / ${human(stats.skippedBytes)}`);
    console.log(`裁剪断言    : 通过（0 个 *.nft.json / @next/swc-* 原生包 / @img / @tailwindcss/oxide* / node-pty；WASM SWC ${cropCheck.wasmSwcFiles} 文件在位；@next/env 在位）`);
    console.log(`归档        : ${DEFAULT_TAR}`);
    console.log(`归档自检    : 通过（${readable.files} 文件条目 / ${readable.dirs} 目录条目 / ${readable.longNames} 个 GNU 长名条目；结束块=${readable.ended ? '在位' : '缺失'}）`);
    console.log(`归档大小    : ${human(tarBytes)}`);
    console.log(`归档内根目录: ${TAR_ROOT}/（entry 落点 = ${TAR_ROOT}/${ENTRY_REL}，与路线 ① 的 entry 同形）`);
    console.log(`SHA-256     : ${sha}`);
    console.log(`前 12 位    : ${shaShort}   ← 幂等键（NodeRuntimeOptions.archiveSha256 / 契约 §3.2）`);
    console.log(`版本文件    : ${DEFAULT_VERSION}（${versionBytes} B，首行 64 位 hex）`);
    console.log(`归档入口    : ${entryAbs}（${entryPresent ? '存在' : '缺失！载荷里必须带它'}）`);
    console.log(`scriptPath  : ${resfileBootstrap}（${fs.existsSync(resfileBootstrap) ? '存在' : '缺失！路线 ② 判定会失败'}）`);
    console.log(`引导器依赖  : ${resfileHost}（${fs.existsSync(resfileHost) ? '在位' : '缺失'}）/ ${resfileTarExtract}（${fs.existsSync(resfileTarExtract) ? '在位' : '缺失'}）`);
    // 硬断言：运行期要用的三件事必须同时在 resfile 里，否则真机会以「找不到引导器 / 归档」失败。
    if (!entryPresent) throw new Error(`归档内缺少入口：${entryAbs}（应用载荷覆盖层没进归档）`);
    if (!fs.existsSync(resfileBootstrap) || !fs.existsSync(resfileHost) || !fs.existsSync(resfileTarExtract)) {
      throw new Error('resfile 里缺少引导器三件之一（scriptPath 及其依赖必须 fs 可读）');
    }
    if (!fs.existsSync(DEFAULT_VERSION) || fs.statSync(DEFAULT_VERSION).size !== 65) {
      throw new Error(`版本文件异常（应为 64 hex + 换行 = 65 B）：${DEFAULT_VERSION}`);
    }
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
      versionFile: DEFAULT_VERSION,
      versionFileBytes: versionBytes,
      resfileDir: RESFILE_PAYLOAD_DIR,
      resfileBootstrap,
      resfileBootstrapPresent: fs.existsSync(resfileBootstrap),
      tarRoot: `${TAR_ROOT}/`,
      appPayloadStaged: appPayload.files.map((f) => f.rel),
      // NFR-108-004：报告里必须留下"哪些包被条件化、配置怎么生成的"，否则事后无法审计
      jitless,
      entryPresent,
      cropCheck,
      archiveCheck: readable,
      files: tarFiles.length,
      staging: opts.keepStaging ? stage : null,
      bridgeStaged: bridge.files.map((f) => f.rel),
      appPayloadStaged: appPayload.files.map((f) => f.rel)
    };
  }

  if (opts.json !== '') {
    await fsp.mkdir(path.dirname(opts.json), { recursive: true });
    await fsp.writeFile(opts.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`报告已写入  : ${opts.json}`);
  }
  revertPiWebPatchesOnce();   /* 收尾：pi-web 必须是 pristine（--keep-patches 可留） */
  console.log('✓ 组装完成');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`✗ 组装失败：${err && err.message ? err.message : String(err)}`);
    revertPiWebPatchesOnce();   /* 异常退出也要把 pi-web 还原（不留半打补丁的工作树） */
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  });

/**
 * Web 侧品牌化（需求 `103-branding` 的 `FR-brand-003/004` / 行动项 §K.9 E13）。
 *
 * ## 为什么只能在这里做
 *
 * 上游 `../pi-web` **一个字节都不能改**（零补丁纪律）⇒ 文案只能在**暂存副本**上换。
 * 这正是 hos `brand-assets.mjs#applyWebBranding(piDistDir)` 的位置与理由。
 *
 * ## 为什么这个替换是安全的（关键判据）
 *
 * 用户可见品牌是 **`Pi Web`（首字母大写）**；技术标识是 **`pi-web`（小写）** ——
 * 包名 `@agegr/pi-web`、localStorage key `pi-web:*`、环境变量 `PI_WEB_*` 都不含大写形式。
 * 因此**大小写敏感**的 `Pi Web` → `Pi Desktop` 替换天然不会碰 `FR-brand-005` 禁止的标识符。
 *
 * ## 判据（硬失败）
 *
 * 替换后 `node_modules/` 之外**必须为 0 处** `Pi Web`；否则抛错 —— 绝不出「半品牌化」的包。
 * `node_modules/` 例外：那是上游第三方代码，属 `FR-brand-005` 允许保留的技术面。
 *
 * ## 确定性
 *
 * 纯文本替换、无时间戳 ⇒ 同一输入两次 `--apply` 得到同一 SHA-256（与归档幂等键一致）。
 */
function applyWebBranding(tarRoot) {
  const FROM = 'Pi Web';
  const TO = 'Pi Desktop';
  /**
   * 按**内容**判「是不是可替换的文本文件」，不用扩展名白名单。
   * 理由（实测教训）：`.rsc`（React Server Component 载荷）不在任何白名单里，
   * 但它**会被发到客户端**且真的含用户可见字符串 —— 白名单会漏，判据就闭不上。
   * 二进制判据：前 8 KB 出现 NUL 字节即视为二进制，跳过；`.map` 一律跳过。
   */
  const readTextOrNull = (abs) => {
    if (abs.endsWith('.map')) return null;
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      return null;
    }
    const probe = buf.subarray(0, Math.min(8192, buf.length));
    if (probe.includes(0)) return null;
    return buf.toString('utf8');
  };
  let filesTouched = 0;
  let occurrences = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;   // 第三方代码：技术面，按 FR-brand-005 保留
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const text = readTextOrNull(abs);
      if (text === null || !text.includes(FROM)) continue;
      const hits = text.split(FROM).length - 1;
      fs.writeFileSync(abs, text.split(FROM).join(TO), 'utf8');
      filesTouched += 1;
      occurrences += hits;
    }
  };
  walk(tarRoot);
  console.log(`品牌化（Web 文案）: ${FROM} → ${TO}，命中 ${occurrences} 处 / ${filesTouched} 个文件`);

  // 终检：node_modules 之外不得残留
  const leftovers = [];
  const scan = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        scan(abs);
        continue;
      }
      const text = readTextOrNull(abs);
      if (text !== null && text.includes(FROM)) leftovers.push(path.relative(tarRoot, abs));
    }
  };
  scan(tarRoot);
  if (leftovers.length > 0) {
    throw new Error(`品牌化终检失败：node_modules 之外仍有 ${leftovers.length} 个文件含「${FROM}」`
      + `（前 3 个：${leftovers.slice(0, 3).join(', ')}）`);
  }
  console.log(`品牌化终检: node_modules 之外「${FROM}」= 0 处 ✓（硬失败判据已通过）`);
}
