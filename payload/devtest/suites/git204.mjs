/**
 * payload/devtest/suites/git204.mjs —— 204 Git 插件的**设备侧端到端**（本地仓库链 + 远端仓库链）。
 *
 * 与 PC 侧脚本的差别只有两点，都是设备事实决定的：
 *   ① 工具从**已物化到设备**的扩展里加载（`<filesDir>/pi-agent/extensions/harmony-git/lib/tools/`），
 *      也就是说测的是装机后真正会被模型调用的那份代码，不是仓库里的源；
 *   ② 工作目录放在应用沙箱内（`<filesDir>/devtest-work/`），跑完删干净 —— 不碰用户的 workspace。
 *
 * 远端相关的地址/账号/口令一律来自**环境文件**（`PI_DEVICE_TEST_ENV` 指向的 JSON，由电脑侧推送、
 * 跑完删除），本文件不写、不打印它们的值；结果里只出现主机名是否给出的布尔事实。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REL_LIB = path.join('extensions', 'harmony-git', 'lib', 'tools');

/** 加载一个工具（ESM 动态 import；路径来自设备上的扩展目录） */
async function loadTool(agentDir, name) {
  const abs = path.join(agentDir, REL_LIB, name + '.js');
  const mod = await import(pathToFileURL(abs).href);
  return mod.default;
}

/** @param {{ agentDir: string, home: string, env: Record<string,string>, log: Function, remoteOnly?: boolean }} ctx */
export default async function run204E2E(ctx) {
  const results = [];
  const step = async (name, tool, params, toolCtx, expectError) => {
    const t = await loadTool(ctx.agentDir, tool);
    const r = await t.execute('t-' + name, params, undefined, undefined, toolCtx);
    const text = (r.content || []).map((c) => c.text || '').join('\n');
    // `expectError`：**期望被拒绝**的用例（越界路径等）。期望与事实一致的才算过 —— 否则
    // 「围栏按设计拒绝」会被记成失败，那是把正确行为当缺陷。
    const ok = expectError ? r.isError === true : !r.isError;
    results.push({ name, ok, text: text.slice(0, 300), expectError: !!expectError });
    ctx.log('[' + (ok ? 'OK' : 'FAIL') + '] ' + name + (ok ? '' : ' :: ' + text.slice(0, 300)));
    return r;
  };

  const work = path.join(ctx.home, 'devtest-work');
  fs.mkdirSync(work, { recursive: true });
  const localRoot = path.join(work, 'repo');
  fs.rmSync(localRoot, { recursive: true, force: true });
  fs.mkdirSync(localRoot, { recursive: true });
  const ctxLocal = { cwd: localRoot };

  if (!ctx.remoteOnly) {
    ctx.log('\n[devtest] ── 本地仓库链（TC-L02 / TC-L03）──');
    await step('init', 'init', { dir: '.' }, ctxLocal);
    await step('config-name', 'config', { action: 'set', key: 'user.name', value: 'pi-devtest' }, ctxLocal);
    await step('config-email', 'config', { action: 'set', key: 'user.email', value: 'pi-devtest@example.invalid' }, ctxLocal);
    fs.writeFileSync(path.join(localRoot, 'a.txt'), 'hello\n');
    await step('add', 'add', { filepath: 'a.txt' }, ctxLocal);
    await step('commit', 'commit', { message: 'test: 初始提交' }, ctxLocal);
    await step('log', 'log', { depth: 5 }, ctxLocal);
    await step('status', 'status', {}, ctxLocal);
    fs.writeFileSync(path.join(localRoot, 'a.txt'), 'hello world\n');
    await step('diff', 'diff', { filepath: 'a.txt' }, ctxLocal);
    await step('branch-create', 'branch', { action: 'create', name: 'feat/x', checkout: true }, ctxLocal);
    await step('checkout', 'checkout', { ref: 'feat/x' }, ctxLocal);
    fs.writeFileSync(path.join(localRoot, 'b.txt'), 'b\n');
    await step('add-b', 'add', { filepath: 'b.txt' }, ctxLocal);
    await step('commit-b', 'commit', { message: 'test: 分支提交' }, ctxLocal);
    await step('tag', 'tag', { name: 'v1.0.0' }, ctxLocal);
    fs.writeFileSync(path.join(localRoot, 'c.txt'), 'c\n');
    await step('stash-push', 'stash', { op: 'push' }, ctxLocal);
    await step('stash-list', 'stash', { op: 'list' }, ctxLocal);
    // 默认分支名由 isomorphic-git 决定（main / master 都可能）：先试 main，失败再试 master，
    // **只计成功的那一次**（把「分支叫什么」当缺陷是错的判据）。
    const backMainFirst = await step('checkout-default', 'checkout', { ref: 'main' }, ctxLocal);
    if (backMainFirst.isError) await step('checkout-default-alt', 'checkout', { ref: 'master' }, ctxLocal);
    // 围栏：越界路径必须被**结构化拒绝**（TC-H02/H04 的设备侧对照）⇒ `expectError=true`
    await step('fence-outside', 'add', { filepath: '../../escape.txt' }, ctxLocal, true);
  }

  const PUB = ctx.env.PUB_URL || '';
  const AUTH = ctx.env.AUTH_URL || '';
  const USER = ctx.env.AUTH_USER || '';
  const PASS = ctx.env.AUTH_PASS || '';
  ctx.log('\n[devtest] ── 远端仓库链（TC-D02…D06）──');
  ctx.log('给出公开仓库=' + (PUB.length > 0) + '，给出带账号仓库=' + (AUTH.length > 0)
    + '，给出账号=' + (USER.length > 0) + '，给出凭据口令=' + (PASS.length > 0));

  if (PUB.length > 0) {
    const dir = 'pub';
    fs.rmSync(path.join(work, dir), { recursive: true, force: true });
    await step('D02-clone-public', 'clone', { url: PUB, dir: dir, depth: 1 }, { cwd: work });
    await step('D02-status', 'status', { dir: dir }, { cwd: work });
    const lg = await step('D02-log', 'log', { dir: dir, depth: 2 }, { cwd: work });
    ctx.log('   D02 log 首行：' + (lg.content && lg.content[0] ? String(lg.content[0].text).split('\n')[0].slice(0, 120) : ''));
  } else {
    ctx.log('（跳过公开仓库用例：环境文件未给出 PUB_URL）');
  }

  if (AUTH.length > 0) {
    // TC-D05：先删凭据 ⇒ 必须**结构化失败**（且不是 ReferenceError 之类的代码缺陷）
    await step('D05-credentials-unset', 'credentials', { action: 'unset', url: AUTH }, { cwd: work });
    fs.rmSync(path.join(work, 'priv-nocred'), { recursive: true, force: true });
    const noCred = await step('D05-clone-without-credential', 'clone', { url: AUTH, dir: 'priv-nocred', depth: 1 }, { cwd: work });
    const noCredText = (noCred.content || []).map((c) => c.text || '').join('\n');
    results.push({
      name: 'D05-结构化失败（非 ReferenceError）',
      ok: noCred.isError === true && !/ReferenceError/.test(noCredText),
      text: noCredText.slice(0, 200)
    });

    // TC-D03/D06：设凭据 + 列表脱敏
    if (USER.length > 0 && PASS.length > 0) {
      await step('D03-credentials-set', 'credentials', { action: 'set', url: AUTH, username: USER, password: PASS }, { cwd: work });
      const list = await step('D06-credentials-list', 'credentials', { action: 'list' }, { cwd: work });
      const listText = (list.content || []).map((c) => c.text || '').join('\n');
      const leaked = PASS.length > 0 && listText.includes(PASS);
      results.push({ name: 'D06-口令不出现明文', ok: !leaked, text: 'leaked=' + leaked });

      // TC-D04：带账号克隆 + 基本读操作（+ 可选的测试分支 push）
      fs.rmSync(path.join(work, 'priv'), { recursive: true, force: true });
      const cloned = await step('D04-clone-private', 'clone', { url: AUTH, dir: 'priv', depth: 1 }, { cwd: work });
      if (!cloned.isError) {
        await step('D04-status', 'status', { dir: 'priv' }, { cwd: work });
        await step('D04-log', 'log', { dir: 'priv', depth: 2 }, { cwd: work });
        if (String(ctx.env.PUSH || '') === '1') {
          const branch = 'pi-devtest-' + Date.now();
          await step('D04-branch', 'branch', { dir: 'priv', action: 'create', name: branch, checkout: true }, { cwd: work });
          fs.writeFileSync(path.join(work, 'priv', 'pi-devtest.txt'), 'devtest ' + new Date().toISOString() + '\n');
          await step('D04-add', 'add', { dir: 'priv', filepath: 'pi-devtest.txt' }, { cwd: work });
          await step('D04-commit', 'commit', { dir: 'priv', message: 'test: 设备侧自检提交' }, { cwd: work });
          await step('D04-push', 'push', { dir: 'priv' }, { cwd: work });
          ctx.log('   ⚠️ 已按 PUSH=1 推送测试分支到远端，需人工删除');
        } else {
          ctx.log('（跳过 push：环境文件未给 PUSH=1，避免在远端留下测试分支）');
        }
      }
    } else {
      ctx.log('（跳过带账号用例：环境文件未同时给出账号与口令）');
    }
  } else {
    ctx.log('（跳过带账号仓库用例：环境文件未给出 AUTH_URL）');
  }

  fs.rmSync(work, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  ctx.log('\n[devtest] 204 e2e：' + results.length + ' 步，失败 ' + failed.length
    + (failed.length > 0 ? '（' + failed.map((f) => f.name).join(', ') + '）' : ''));
  const summary = { pass: results.length - failed.length, fail: failed.length, skipped: 0, detail: results };
  // 立刻上报：不依赖上层 main() 的收尾（真机上事件循环可能先被收干）
  if (ctx.report) ctx.report(summary);
  return summary;
}
