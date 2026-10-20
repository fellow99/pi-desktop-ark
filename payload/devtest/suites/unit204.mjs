/**
 * payload/devtest/suites/unit204.mjs —— 204 Git 插件**单元用例的设备侧执行器**。
 *
 * 断言本身不在这里：语例是扩展自带的 `tests/*.test.mjs`（`node:test` + `node:assert`），
 * 装机后物化在 `<filesDir>/pi-agent/extensions/harmony-git/tests/`。本文件只负责把它们
 * **在应用自己的 Node 里**跑起来并计数。
 *
 * 真机实测过的约束（决定了下面为什么这么写，改之前先读）：
 *   ① 设备上没有可执行的 `node` ⇒ 不能用 `node --test` 命令行；只能同进程跑
 *      （`run({ isolation: 'none' })`），子进程要靠 `process.execPath` 再拉起应用；
 *   ② `files` 必须给**绝对路径** —— 给 `file://` URL 会被当相对路径拼到 cwd 上
 *      （`ERR_MODULE_NOT_FOUND …/payload/<sha>/file:/…`）；
 *   ③ `run()` 返回的 stream **不会**发 `end`/`close`（PC 与本机同样现象：顶层 await 会挂成
 *      "unsettled top-level await"）。唯一可靠的完成信号是 `beforeExit`（事件循环收干）；
 *   ④ 显式 `reporter: 'tap'` 时一条用例都不跑；默认 reporter 也不往 stdout 写东西，
 *      事件里的 `data` 是空对象 ⇒ **只能按事件计数**，拿不到用例名。
 *      因此改成**一次跑一个文件**：用文件名换来「哪个文件几过几败」这层可证伪的粒度。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** 等事件循环收干（`run()` 的完成信号；见文件头 ③） */
function drained() {
  return new Promise((resolve) => process.once('beforeExit', resolve));
}

/**
 * @param {{ agentDir: string, env: Record<string, string>, log: Function, report: Function }} ctx
 */
export default async function run204Unit(ctx) {
  const testsDir = path.join(ctx.agentDir, 'extensions', 'harmony-git', 'tests');
  if (!fs.existsSync(testsDir)) {
    throw new Error('语例目录不存在（扩展是否已物化？）：' + testsDir);
  }
  const files = fs.readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.join(testsDir, name));
  if (files.length === 0) {
    throw new Error('没有找到 *.test.mjs：' + testsDir);
  }
  ctx.log('[devtest] 204 单元：' + files.length + ' 个语例文件（同进程，按事件计数）');
  for (const file of files) ctx.log('  - ' + path.basename(file));

  const { run } = await import('node:test');
  let pass = 0;
  let fail = 0;
  const failures = [];
  // ⚠️ `run()` 在一个进程里只能有效地跑**一次**：第二次调用后事件循环不再被它驱动
  //    （实测：第二个文件永远等不到完成，最后挂成 unsettled top-level await）。
  //    所以这里一次把 5 个文件都交给它，粒度落在「总体通过数」上，不按文件拆。
  const stream = run({ files, isolation: 'none', concurrency: 1, timeout: 120000 });
  stream.on('test:pass', (ev) => {
    if (ev && ev.details && ev.details.type === 'test') pass += 1;
  });
  stream.on('test:fail', (ev) => {
    if (!ev || !ev.details || ev.details.type !== 'test') return;
    fail += 1;
    const err = ev.data && ev.data.details ? ev.data.details.error : undefined;
    if (err && err.message) failures.push(String(err.message).slice(0, 200));
  });
  await drained();
  for (const f of failures) ctx.log('[FAIL] ' + f);

  // 说明：`node:test` 的事件里**区分不出** skip（跳过的子用例同样发 test:pass），
  // 因此 skipped 恒报 0 并注明口径限制；PC 侧同一批语例是 25 过 / 1 跳过 = 26 条事件，
  // 设备侧若也是 26 条即与 PC 等价（这一条对照写进测试报告）。
  const summary = { pass, fail, skipped: 0, failures, detail: failures };
  if (ctx.report) ctx.report(summary);
  return summary;
}
