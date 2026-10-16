/*
 * selfcheck.js —— 骨架期载荷（随包 rawfile，启动时由 ArkTS 物化到沙箱）。
 *
 * 目的：一次问清「这个进程里的 Node 到底能不能用」，特别是 **JIT 是否真生效**
 * （也就是 ALLOW_WRITABLE_CODE_MEMORY 是否真的批下来了）：
 *
 *   无 ACL  → 不带 --jitless 启动即 SIGTRAP（node.log 里出现 CRASH sig=5），进程判 Cpp Crash
 *   有 ACL  → 本脚本正常跑完，且 `WebAssembly` 可用、热循环走 JIT（毫秒级）
 *   --jitless（兜底） → 本脚本能跑，但 `WebAssembly is not defined` 且热循环约 300 ms/2e6 次
 *
 * 取证通道：hdc fport tcp:15577 tcp:15577 && curl -s http://127.0.0.1:15577/facts
 */
'use strict';

const http = require('http');
const os = require('os');

const PORT = Number(process.env.SELFCHECK_PORT || 15577);
const HOME = process.env.HOME || '';
const LOG_PATH = HOME + '/payload/node.log';
const checks = {};

function safe(key, fn) {
  try {
    checks[key] = fn();
  } catch (e) {
    checks[key] = 'ERR:' + (e && e.message ? e.message : String(e));
  }
}

safe('node', () => process.version);
safe('platform', () => process.platform);
safe('arch', () => process.arch);
safe('execArgv', () => process.execArgv);
safe('versions', () => process.versions);
safe('homedir', () => os.homedir());
safe('tmpdir', () => os.tmpdir());
safe('netifaces', () => Object.keys(os.networkInterfaces() || {}));
safe('cpus', () => os.cpus().length);

// WebAssembly 存在与否 = JIT 路径开没开（--jitless 下 V8 直接不暴露 WebAssembly）
safe('wasm.available', () => typeof WebAssembly !== 'undefined');
safe('wasm.validate', () => WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])));

// 热循环：JIT 生效时应远低于解释器基线（探针实测 --jitless 下约 300 ms / 2e6 次）
safe('hotloop_ms_2e6', () => {
  const t0 = Date.now();
  let acc = 0;
  for (let i = 0; i < 2000000; i++) {
    acc += (i * 31) % 7;
  }
  return Date.now() - t0;
});

process.stdout.write('[selfcheck] node=' + process.version + ' platform=' + process.platform +
  ' argv=' + JSON.stringify(process.execArgv) + '\n');
process.stdout.write('[selfcheck] wasm.available=' + checks['wasm.available'] +
  ' hotloop_ms_2e6=' + checks['hotloop_ms_2e6'] + '\n');

const server = http.createServer((req, res) => {
  if (req.url === '/facts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ at: new Date().toISOString(), checks: checks }));
    return;
  }
  if (req.url === '/log') {
    let text = '';
    try {
      text = require('fs').readFileSync(LOG_PATH, 'utf8').slice(-16384);
    } catch (e) {
      text = '(read failed: ' + e.message + ')';
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(text);
    return;
  }
  res.writeHead(404);
  res.end('not found; try /facts or /log');
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('[selfcheck] listening 127.0.0.1:' + PORT + '\n');
});
