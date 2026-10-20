#!/usr/bin/env node
/**
 * scripts/stage-devtests.mjs —— 把**设备侧用例脚本**投放进 HAP 的 `resfile/devtest/`。
 *
 * 为什么需要这一层：设备上没有可执行的 `node` 二进制，语例只能由**应用自己的 Node**执行，
 * 而它读得到的位置只有 `resfile`（安装后的真实目录）与沙箱。所以：
 *
 *   payload/devtest/**            → resfile/devtest/**             （执行器与 suite）
 *   payload/jitless/*.js + vendor → resfile/devtest/108/**          （兼容层副本：selftest 约定 `HERE/..`）
 *   payload/jitless/selftest/*.mjs→ resfile/devtest/108/selftest/**  （108 的断言本身）
 *
 * 与 `assemble-payload.mjs` 的分工：那边负责**产品的**载荷归档（`resfile/pi-web/pi-web.tar.gz`，
 * 30+ 分钟），这边只搬**测试用的**几十 KB 脚本（秒级）。二者互不影响：`--clean` 只删本目录。
 *
 * 用法：
 *   node scripts/stage-devtests.mjs            # 投放（幂等；内容一致则跳过写盘）
 *   node scripts/stage-devtests.mjs --clean    # 撤掉（发布前必做）
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC_DEVTEST = path.join(ROOT, 'payload', 'devtest');
const SRC_JITLESS = path.join(ROOT, 'payload', 'jitless');
const DEST = path.join(ROOT, 'entry', 'src', 'main', 'resources', 'resfile', 'devtest');

let written = 0;
let skipped = 0;

function copyFile(from, to) {
  const buf = fs.readFileSync(from);
  if (fs.existsSync(to)) {
    const old = fs.readFileSync(to);
    if (old.length === buf.length && old.equals(buf)) {
      skipped += 1;
      return;
    }
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, buf);
  written += 1;
}

function copyTree(fromDir, toDir, filter) {
  if (!fs.existsSync(fromDir)) return;
  for (const name of fs.readdirSync(fromDir)) {
    const from = path.join(fromDir, name);
    const to = path.join(toDir, name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      copyTree(from, to, filter);
    } else if (!filter || filter(from, name)) {
      copyFile(from, to);
    }
  }
}

/** 只搬运行期需要的文件：排除 selftest（单独放 108/selftest）与任何说明性文本 */
const isJitlessRuntimeFile = (abs, name) => name.endsWith('.js') || name.endsWith('.json');

function stage() {
  fs.rmSync(DEST, { recursive: true, force: true });
  copyTree(SRC_DEVTEST, DEST);
  for (const name of fs.readdirSync(SRC_JITLESS)) {
    const abs = path.join(SRC_JITLESS, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      if (name === 'selftest' || name === 'vendor') {
        copyTree(abs, path.join(DEST, '108', name));
      }
      continue;
    }
    if (isJitlessRuntimeFile(abs, name)) {
      copyFile(abs, path.join(DEST, '108', name));
    }
  }
  console.log('resfile/devtest 已投放：写入 ' + written + ' 个、未变 ' + skipped + ' 个 → ' + DEST);
}

function clean() {
  fs.rmSync(DEST, { recursive: true, force: true });
  console.log('已删除 ' + DEST + '（发布前必须保持删除状态：调试通道脚本不得进正式包）');
}

const argv = process.argv.slice(2);
if (argv.includes('--clean')) clean();
else stage();
