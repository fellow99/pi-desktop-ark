#!/usr/bin/env node
/**
 * sync-git-extension.mjs — 把 pi-desktop-hos 的 harmony-git 扩展同步为 ark payload。
 *
 * 单源原则：pi-desktop-hos/extensions/harmony-git/ 是唯一权威源码；
 * 本脚本复制到 pi-desktop-ark/payload/extensions/harmony-git/，并在 index.js 头部
 * 插入 V2 标记（// synced-from: pi-desktop-hos@<sha>），禁止在 ark 侧直接改实现。
 *
 * 用法：node scripts/sync-git-extension.mjs [--check]
 *   --check  只比对差异不写文件（CI 用）；有差异时退出码 1。
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARK_ROOT = path.resolve(HERE, '..');
const HOS_EXT = path.resolve(ARK_ROOT, '..', 'pi-desktop-hos', 'extensions', 'harmony-git');
const ARK_EXT = path.resolve(ARK_ROOT, 'payload', 'extensions', 'harmony-git');
const CHECK_ONLY = process.argv.includes('--check');

/** 递归收集文件相对路径。 */
function collect(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(p, base));
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function hosHeadSha() {
  try {
    return execSync('git -C ' + JSON.stringify(path.resolve(HOS_EXT, '..', '..')) + ' log -1 --format=%h -- extensions/harmony-git', { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function main() {
  if (!fs.existsSync(HOS_EXT)) {
    console.error(`源不存在：${HOS_EXT}`);
    process.exit(2);
  }
  const marker = `// synced-from: pi-desktop-hos@${hosHeadSha()}（单源：pi-desktop-hos/extensions/harmony-git；请勿在 ark 侧直接修改）\n`;
  const files = collect(HOS_EXT);
  const diffs = [];

  for (const rel of files) {
    const src = fs.readFileSync(path.join(HOS_EXT, rel));
    const content = rel === 'index.js' ? Buffer.concat([Buffer.from(marker, 'utf8'), src]) : src;
    const dst = path.join(ARK_EXT, rel);
    if (!fs.existsSync(dst) || sha(fs.readFileSync(dst)) !== sha(content)) {
      diffs.push(rel);
      if (!CHECK_ONLY) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, content);
      }
    }
  }
  // 目标侧多出（源已删除）的文件
  if (fs.existsSync(ARK_EXT)) {
    for (const rel of collect(ARK_EXT)) {
      if (!files.includes(rel)) {
        diffs.push(`${rel}（ark 侧多余，已删除）`);
        if (!CHECK_ONLY) fs.rmSync(path.join(ARK_EXT, rel));
      }
    }
  }

  if (CHECK_ONLY) {
    if (diffs.length) {
      console.error(`未同步（${diffs.length} 个文件有差异）：\n  ${diffs.join('\n  ')}\n运行 node scripts/sync-git-extension.mjs`);
      process.exit(1);
    }
    console.log('harmony-git 已同步（无差异）。');
    return;
  }
  console.log(`已同步 ${files.length} 个文件 → ${path.relative(ARK_ROOT, ARK_EXT)}（变更 ${diffs.length} 个）`);
  if (diffs.length) console.log(`  ${diffs.join('\n  ')}`);
}

main();
