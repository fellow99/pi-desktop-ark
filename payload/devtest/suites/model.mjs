/**
 * payload/devtest/suites/model.mjs —— **设备侧真实模型调用**（DeepSeek，非流式 + 流式 SSE）。
 *
 * 为什么放在设备上跑：这条用例要证明的不是「模型能回答」，而是**设备进程里的 fetch/undici 面
 * 能不能承接一个真实的 https + SSE 请求**（compat 形态下由 `payload/jitless` 兼容层接管，
 * jit 形态下走 Node 原生）。PC 侧的同一脚本只能证明代码逻辑，证明不了设备形态。
 *
 * 密钥只从**环境文件**读（`DEEPSEEK_KEY`），不打印、不落结果文件；结果里只留 HTTP 状态、
 * 耗时、块数与首块延迟这些可证伪的事实。
 */

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

/** @param {{ env: Record<string,string>, log: Function }} ctx */
export default async function runModel(ctx) {
  const key = ctx.env.DEEPSEEK_KEY || '';
  if (key.length === 0) {
    ctx.log('（跳过：环境文件未给出 DEEPSEEK_KEY）');
    return { pass: 0, fail: 0, skipped: 1, detail: [{ name: 'model', status: 'skip' }] };
  }
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    ctx.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + name + ' :: ' + detail);
  };
  ctx.log('[devtest] fetch 实现：' + (typeof fetch === 'function' ? String(fetch.name || 'fetch') : '缺失')
    + '，WebAssembly=' + typeof WebAssembly);

  // ── ① 非流式 ──
  try {
    const t0 = Date.now();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: '只回复两个字：收到' }],
        stream: false,
        max_tokens: 16
      })
    });
    const elapsed = Date.now() - t0;
    const text = await res.text();
    let content = '';
    try {
      const json = JSON.parse(text);
      content = json && json.choices && json.choices[0] && json.choices[0].message
        ? String(json.choices[0].message.content || '')
        : '';
    } catch (_) {
      content = '';
    }
    record('model-non-stream', res.status === 200 && content.length > 0,
      'status=' + res.status + ' elapsed=' + elapsed + 'ms content=' + JSON.stringify(content.slice(0, 40)));
  } catch (e) {
    record('model-non-stream', false, '异常：' + (e && e.message ? e.message : String(e)));
  }

  // ── ② 流式（SSE）──
  try {
    const t0 = Date.now();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: '用一句话说明你在哪台设备上运行。' }],
        stream: true,
        max_tokens: 64
      })
    });
    if (res.status !== 200 || !res.body) {
      record('model-stream', false, 'status=' + res.status + ' body=' + (res.body ? '有' : '无'));
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      let chunks = 0;
      let events = 0;
      let content = '';
      let firstChunkMs = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks += 1;
        if (firstChunkMs === 0) firstChunkMs = Date.now() - t0;
        const piece = decoder.decode(value, { stream: true });
        raw += piece;
        for (const line of piece.split('\n')) {
          if (!line.startsWith('data:')) continue;
          events += 1;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices && json.choices[0] && json.choices[0].delta
              ? json.choices[0].delta.content
              : '';
            if (delta) content += delta;
          } catch (_) {
            // 跨块截断的 data 行会被跳过：计数仍然有效（事件数来自原样文本）
          }
        }
      }
      const elapsed = Date.now() - t0;
      record('model-stream', events >= 2 && content.length > 0,
        'status=200 chunks=' + chunks + ' sseEvents=' + events + ' firstChunk=' + firstChunkMs
        + 'ms elapsed=' + elapsed + 'ms text=' + JSON.stringify(content.slice(0, 60)));
    }
  } catch (e) {
    record('model-stream', false, '异常：' + (e && e.message ? e.message : String(e)));
  }

  const failed = results.filter((r) => !r.ok).length;
  const summary = { pass: results.length - failed, fail: failed, skipped: 0, detail: results };
  if (ctx.report) ctx.report(summary);
  return summary;
}
