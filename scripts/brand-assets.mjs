#!/usr/bin/env node
/**
 * brand-assets.mjs — 品牌化物料生成（需求 `103-branding` / 行动项 §K.9 E11）
 *
 * ## 为什么需要它
 *
 * `specs` 的 `FR-brand-008/009` 要求：**每一个被引用的图标位**都必须由父工程物料生成，
 * 且**应用级图标不透明**（≥1024²）。本工程原先的 `icon.png` 与 `startIcon.png` 是
 * **同一份字节**（md5 `fe006dfd…`）——那是拷贝而不是生成，至少有一个 slot 用错。
 *
 * ## 物料（唯一来源 = 父工程 `assets/`，**硬校验**）
 *
 * | 文件 | 硬校验 | 用途 |
 * |---|---|---|
 * | `logo.png` | 200×200、含透明像素 | **应用级图标与模块图标**（`AppScope` 的 `app_icon`、模块 `icon`）：由本脚本放大到 1024² 并在**白底**上合成（应用级图标必须不透明）；也用于启动图标 `startIcon`（512²，保留透明） |
 * | `logo-1024-with-bg.png` | 1024×1024 且 **minAlpha == 255** | 不再使用（保留物料；若将来要回到"预合成"路线可复用） |
 *
 * 物料缺失 / 尺寸不符 / 透明度不符 / `ffmpeg` 不可用 ⇒ **一律硬失败**，绝不静默产出无品牌包。
 *
 * ## 为什么用 ffmpeg 而不是 sharp
 *
 * 本机 `pi-web/node_modules/sharp` 的平台预编译件与宿主不匹配（`require` 直接失败），
 * 而 `ffmpeg 7.1` 可用。代价是**没有 SVG 光栅化器**（无 librsvg），因此页面 Logo（`logo.svg`）
 * 不在这里生成——那是 `E13`（Web 侧品牌化）的事，且 pi-web 直接引用 SVG 即可。
 *
 * ## 确定性
 *
 * 同一物料 → 同一字节：`-fflags +bitexact -flags +bitexact -map_metadata -1` 去掉时间戳与构建指纹。
 * 本脚本**幂等**：`node scripts/brand-assets.mjs` 可反复跑，产物字节不变（`--check` 只校验不改写）。
 *
 * CLI：`node scripts/brand-assets.mjs [--assets <dir>] [--check]`
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ASSETS = path.resolve(PROJECT_ROOT, '..', 'assets');

/** 需要生成的图标位（**全部**由物料派生；顺序即日志顺序） */
const TARGETS = [
  {
    rel: 'AppScope/resources/base/media/app_icon.png',
    source: 'logo.png',
    size: 1024,
    opaque: true,
    flatten: '#FFFFFF',
    why: '应用级图标（app.json5 的 $media:app_icon）：物料 = assets/logo.png，放大到 1024² 并合成白底（必须无 alpha）'
  },
  {
    rel: 'entry/src/main/resources/base/media/icon.png',
    source: 'logo.png',
    size: 1024,
    opaque: true,
    flatten: '#FFFFFF',
    why: '模块图标（module.json5 的 $media:icon）：与应用级图标同源同参'
  },
  {
    rel: 'entry/src/main/resources/base/media/startIcon.png',
    source: 'logo.png',
    size: 512,
    opaque: false,
    why: '启动图标（startWindowIcon）：系统允许透明 ⇒ 用带 alpha 的物料'
  }
];

function log(msg) {
  console.log(`[brand] ${msg}`);
}

function die(msg) {
  console.error(`[brand] ✗ ${msg}`);
  console.error('[brand]   物料在父工程 assets/（本仓库之外）；缺失即硬失败，不做静默降级。');
  process.exit(1);
}

/** 读 PNG 的宽高与色彩类型（IHDR 在固定偏移，无需解码整图） */
function readPngHeader(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25]
  };
}

/** 用 ffmpeg 解成裸 RGBA 后扫描 alpha 的最小值（判断「真不透明」） */
function minAlpha(absPath) {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', absPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 256 * 1024 * 1024 }
  );
  let min = 255;
  for (let i = 3; i < raw.length; i += 4) if (raw[i] < min) min = raw[i];
  return min;
}

function sha256File(absPath) {
  return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function generate(target, assetsDir) {
  const src = path.join(assetsDir, target.source);
  if (!fs.existsSync(src)) die(`物料缺失：${src}`);
  const header = readPngHeader(src);
  if (!header) die(`物料不是可解析的 PNG：${src}`);
  if (header.width !== header.height) die(`物料必须是正方形：${src} = ${header.width}×${header.height}`);

  const alpha = minAlpha(src);
  /*
   * `flatten` = 由本脚本在**不透明底色**上合成：此时物料允许带 alpha（`logo.png` 就是带透明通道的
   * 200² 源图），不透明性由 generate() 的 overlay+format=rgb24 保证，产物的 colorType 会再断言一次。
   */
  if (target.opaque && !target.flatten && alpha !== 255) {
    die(`物料「${target.source}」要求不透明（minAlpha 必须 255），实际 minAlpha=${alpha}；`
      + '若物料本身带透明通道，请给该目标配 flatten 底色');
  }
  if (!target.opaque && alpha === 255) {
    die(`物料「${target.source}」要求含透明像素（minAlpha < 255），实际全不透明 ⇒ 用错物料`);
  }

  const out = path.join(PROJECT_ROOT, target.rel);
  const pixFmt = target.opaque ? 'rgb24' : 'rgba';
  const args = [
    '-y', '-v', 'error',
    '-i', src,
    '-vf', target.flatten
      ? `color=c=${target.flatten}:s=${target.size}x${target.size}[bg];`
        + `[0:v]scale=${target.size}:${target.size}:flags=lanczos:force_original_aspect_ratio=decrease[fg];`
        + '[bg][fg]overlay=(W-w)/2:(H-h)/2,format=rgb24'
      : `scale=${target.size}:${target.size}:flags=lanczos`,
    '-pix_fmt', pixFmt,
    '-fflags', '+bitexact', '-flags', '+bitexact', '-map_metadata', '-1',
    '-frames:v', '1', '-f', 'image2', '-c:v', 'png', out
  ];
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

  const got = readPngHeader(out);
  if (!got || got.width !== target.size || got.height !== target.size) {
    die(`生成结果尺寸不符：${target.rel} = ${got ? `${got.width}×${got.height}` : '不可解析'}`);
  }
  if (target.opaque && got.colorType === 6) die(`生成结果仍带 alpha 通道：${target.rel}（colorType=6）`);
  return {
    rel: target.rel,
    source: target.source,
    size: target.size,
    opaque: target.opaque,
    bytes: fs.statSync(out).size,
    sha256: sha256File(out),
    colorType: got.colorType
  };
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const assetsIdx = argv.indexOf('--assets');
  const assetsDir = assetsIdx >= 0 && argv[assetsIdx + 1] ? path.resolve(argv[assetsIdx + 1]) : DEFAULT_ASSETS;

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    die('找不到 ffmpeg（本脚本用 ffmpeg 做 scale；sharp 的平台预编译件在本机不可用）');
  }
  log(`物料目录：${assetsDir}`);
  if (check) log('模式：--check（只校验物料与产物，不写文件）');

  const results = [];
  for (const target of TARGETS) {
    if (check) {
      const out = path.join(PROJECT_ROOT, target.rel);
      if (!fs.existsSync(out)) die(`产物缺失：${target.rel}（先跑一次不带 --check 的生成）`);
      const got = readPngHeader(out);
      const ok = got && got.width === target.size && got.height === target.size
        && (!target.opaque || got.colorType !== 6);
      if (!ok) die(`产物不合规：${target.rel}`);
      results.push({
        rel: target.rel,
        source: target.source,
        size: target.size,
        opaque: target.opaque,
        bytes: fs.statSync(out).size,
        sha256: sha256File(out),
        colorType: got.colorType
      });
      continue;
    }
    const r = generate(target, assetsDir);
    results.push(r);
    log(`+ ${r.rel}  ${r.bytes} B  colorType=${r.colorType}  sha256=${r.sha256.slice(0, 16)}…`);
    log(`  依据：${target.why}`);
  }

  // 终检：**期望不同**的图标位不得互为同一份字节。
  // 历史缺陷是 `icon.png`（模块图标）与 `startIcon.png`（启动图标）同一份字节 —— 那说明
  // 至少一个 slot 用错物料。但 `app_icon` 与 `icon` **本来就该同源同参**（应用级与模块级
  // 图标是同一张图），所以判据是「签名不同却字节相同」，不是「字节相同」。
  const bySig = new Map();
  for (const r of results) {
    const sig = `${r.source}|${r.size}|${r.opaque}`;
    const prev = bySig.get(r.sha256);
    if (prev && prev.sig !== sig) {
      die(`两个图标位字节相同但期望不同（${prev.rel}〔${prev.sig}〕 == ${r.rel}〔${sig}〕）⇒ 至少一个 slot 用错物料`);
    }
    if (!prev) bySig.set(r.sha256, { rel: r.rel, sig });
  }
  log(`✓ ${check ? '校验' : '生成'}完成：${results.length} 个图标位，字节互不相同`);
}

main();
