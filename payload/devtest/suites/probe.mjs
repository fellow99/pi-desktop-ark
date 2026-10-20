/**
 * payload/devtest/suites/probe.mjs —— **设备侧网络可达性探针**（给远端仓库用例做前置事实）。
 *
 * 为什么单独一支：远端用例失败时，"代码坏了" 与 "从设备这个网络到不了那台主机" 是两件事。
 * 这一支只回答后者：对给定 URL 做一次 GET（带 20 s 超时），记录状态码、耗时或**错误码原文**
 * （DNS 失败会如实回 `getaddrinfo ENOTFOUND <host>`，不猜成"网络不好"）。
 *
 * URL 列表来自环境文件（`PROBE_URLS`，逗号分隔）——测试态地址因此不落仓库。
 */

/**
 * @param {{ env: Record<string,string>, log: Function, report: Function }} ctx
 */
export default async function runProbe(ctx) {
  const raw = ctx.env.PROBE_URLS || '';
  const urls = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (urls.length === 0) {
    ctx.log('（跳过：环境文件未给出 PROBE_URLS）');
    const skipped = { pass: 0, fail: 0, skipped: 1 };
    if (ctx.report) ctx.report(skipped);
    return skipped;
  }
  const results = [];
  for (const url of urls) {
    const t0 = Date.now();
    let status = 'n/a';
    let error = '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'manual' });
      clearTimeout(timer);
      status = String(res.status);
      // 只读一小段，避免把整页拉下来；这里要的是"能不能连上"
      try {
        await res.body?.cancel?.();
      } catch (_) {
        // 忽略
      }
    } catch (e) {
      error = e && (e.cause && e.cause.message ? e.cause.message : e.message) ? (e.cause && e.cause.message) || e.message : String(e);
    }
    const elapsed = Date.now() - t0;
    const ok = error === '';
    // 只打印主机名（URL 的用户名/口令部分永远不进日志，哪怕给了也不打）
    let host = url;
    try {
      host = new URL(url).host;
    } catch (_) {
      // 保留原样
    }
    results.push({ host, status, elapsed, error });
    ctx.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + host + ' :: status=' + status + ' elapsed=' + elapsed + 'ms'
      + (error ? ' error=' + error : ''));
  }
  const failed = results.filter((r) => r.error !== '').length;
  const summary = { pass: results.length - failed, fail: failed, skipped: 0, detail: results };
  if (ctx.report) ctx.report(summary);
  return summary;
}
