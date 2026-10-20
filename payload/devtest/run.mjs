#!/usr/bin/env node
/**
 * payload/devtest/run.mjs —— **设备侧**用例统一入口（`specs/overall-test-cases.md` §3 取证通道）。
 *
 * 【为什么需要它】本工程的用例有一大半是纯 JS 断言（108 兼容层、204 工具链、真实模型调用）。
 * 设备上没有可执行的 `node` 二进制（`libnode.so` 只能被应用进程 `dlopen`），PC 上跑同样的脚本
 * 也证明不了设备事实（真实沙箱路径、真实网络、真实 `--jitless` 形态）。因此把语例脚本随 HAP
 * 装进 `resfile/devtest/`，再由 ArkTS 的调试参数 `piTestScript` 把 Node 入口覆盖成本文件
 * （见 `entry/src/main/ets/common/DeviceTest.ets`）—— 跑的就是应用自己的那个 Node。
 *
 * 【一次一个形态】`--jitless` 与 jit 是**进程级**形态，两个形态必须分别启动应用各跑一遍；
 * 且 108 的 selftest 会 `process.exit()`，所以 108 的两支各自单独启动。
 *
 * 【结果怎么回传】设备上没有 shell 可写的共享目录，所以：
 *   ① 结构化结果写 `<HOME>/devtest-results/<suite>-<ts>.json`（HOME = 应用 filesDir，hdc 可读）；
 *   ② 同时把一行 `[devtest] SUMMARY {…}` 打进 stdout（→ `payload/node.log`）。
 *
 * 【环境来源】测试态主机/账号/口令/API Key **不落设备**：电脑侧起一次性 HTTP 端点、
 * `hdc rport` 反代到设备 loopback，本入口在启动时取一次（`PI_DEVICE_TEST_ENV` 给 URL）；
 * 也支持本地文件路径（仅调试设备上应用可读的目录才成立）。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // <resfile>/devtest
const HOME = process.env.HOME || '';
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || (HOME ? path.join(HOME, 'pi-agent') : '');
const RESULT_DIR = HOME ? path.join(HOME, 'devtest-results') : '';
const ENV_SOURCE = process.env.PI_DEVICE_TEST_ENV || '/data/local/tmp/pi-devtest-env.json';
const startedAt = new Date().toISOString();
const t0 = Date.now();

/** 结果行（同时 tee 到 stdout：设备侧的第一手证据在 node.log） */
const captured = [];
const realLog = console.log.bind(console);
function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}
console.log = (...args) => {
  const line = args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ');
  if (captured.length < 1500) captured.push(line);
  realLog(...args);
};

/** compat 形态下把兼容层装上（与 `pi-web-launch.js` 同一条启动路径）；jit 形态它是空操作 */
function installCompatLayer() {
  const entry = path.join(HERE, '108', 'index.js');
  if (!fs.existsSync(entry)) {
    console.log('[devtest] 兼容层副本缺失（不影响本 suite）：' + entry);
    return 'missing';
  }
  try {
    const require = createRequire(import.meta.url);
    const facts = require(entry).installIfNeeded((line) => console.log('[jitless] ' + line));
    return facts && typeof facts === 'object' ? 'active=' + String(facts.active) : 'installed';
  } catch (e) {
    console.log('[devtest] 兼容层安装失败：' + (e && e.message ? e.message : String(e)));
    return 'failed';
  }
}

/** 取环境：URL 或本地文件；**不打印内容** */
let ENVV = {};
async function loadEnv() {
  try {
    if (/^https?:/i.test(ENV_SOURCE)) {
      // 必须**无条件**装兼容层：`--jitless` 下原生 fetch 存在但内部 undici 依赖 WASM，调用即失败
      // （K1 的同源事实）。jit 形态它是不做任何事的空操作。
      installCompatLayer();
      const res = await fetch(ENV_SOURCE);
      ENVV = JSON.parse(await res.text());
      return;
    }
    ENVV = JSON.parse(fs.readFileSync(ENV_SOURCE, 'utf8'));
  } catch (e) {
    ENVV = { __loadError: e && e.message ? e.message : String(e) };
  }
}

function suiteName() {
  // 优先级：ArkTS 直给的 `PI_DEVICE_TEST_SUITE` > 环境文件里的 SUITE > all。
  // 单独给一份的原因：108 的两支语例要**自己**安装兼容层并断言安装日志，
  // 若执行器为了取环境先装一遍，那条断言会看到「已安装过（幂等）」而误判失败。
  return process.env.PI_DEVICE_TEST_SUITE || ENVV.SUITE || 'all';
}

function writeResult(extra) {
  const payload = Object.assign(
    {
      suite: suiteName(),
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      webAssembly: typeof WebAssembly,
      home: HOME,
      agentDir: AGENT_DIR,
      envSource: ENV_SOURCE,
      envKeys: Object.keys(ENVV).filter((k) => !/PASS|KEY|TOKEN|SECRET/i.test(k)),
      envLoadError: ENVV.__loadError || ''
    },
    extra || {}
  );
  const line = '[devtest] SUMMARY ' + safeJson({
    suite: payload.suite,
    pass: payload.pass,
    fail: payload.fail,
    skipped: payload.skipped,
    exitCode: payload.exitCode,
    elapsedMs: payload.elapsedMs
  });
  captured.push(line);
  if (RESULT_DIR) {
    try {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
      const file = path.join(RESULT_DIR, suiteName() + '-' + Date.now() + '.json');
      fs.writeFileSync(file, JSON.stringify(Object.assign({ log: captured.slice(-800) }, payload), null, 2));
      realLog('[devtest] 结果文件：' + file);
    } catch (e) {
      realLog('[devtest] 结果文件写入失败：' + (e && e.message ? e.message : String(e)));
    }
  }
  realLog(line);
  return payload;
}

let finished = false;
function finish(extra) {
  if (finished) return;
  finished = true;
  writeResult(extra);
}

process.on('exit', (code) => {
  finish({ exitCode: typeof code === 'number' ? code : -1 });
});
process.on('uncaughtException', (e) => {
  realLog('[devtest] 未捕获异常：' + (e && e.stack ? e.stack : String(e)));
  finish({ exitCode: 70, error: e && e.message ? e.message : String(e) });
  process.exit(70);
});
process.on('unhandledRejection', (e) => {
  realLog('[devtest] 未处理的 rejection：' + (e && e.stack ? e.stack : String(e)));
});

/** 跑 108 的两支 selftest（它们自己安装兼容层、自己 exit；因此各自单独启动应用） */
async function run108(name) {
  // ⚠️ 这里**不能**预装兼容层：selftest 会断言安装日志里的结构化事实，
  //    预装会让它走「已安装过（幂等）」分支而误判失败（真机上就是这么发现的）。
  const rel = name === 'photon' ? '108/selftest/photon.mjs' : '108/selftest/fetch-undici.mjs';
  const abs = path.join(HERE, rel);
  if (!fs.existsSync(abs)) {
    console.log('[devtest] 语例缺失：' + abs);
    finish({ exitCode: 90, pass: 0, fail: 1, skipped: 0, missing: abs });
    process.exit(90);
  }
  console.log('[devtest] 形态：WebAssembly=' + typeof WebAssembly + '，执行 ' + abs);
  await import(pathToFileURL(abs).href);
  const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
  finish({ exitCode: code, pass: code === 0 ? 'suite-ok' : 0, fail: code === 0 ? 0 : 'suite-failed' });
  process.exit(code);
}

/**
 * 语例自报结果（**必须由 suite 自己调用**）：`node:test` 的 `run()` 结束时会收干事件循环，
 * 上层的收尾语句可能来不及跑（真机实测：等到 exit 事件写文件时，统计数还没算出来）。
 */
const report = (r) => finish(Object.assign({ exitCode: r && r.fail ? 1 : 0 }, r || {}));

const SUITES = {
  '108-fetch': () => run108('fetch'),
  '108-photon': () => run108('photon'),
  '204-unit': async () => {
    const mod = await import(pathToFileURL(path.join(HERE, 'suites', 'unit204.mjs')).href);
    return mod.default({ agentDir: AGENT_DIR, env: ENVV, log: console.log, report });
  },
  '204-e2e': async () => {
    installCompatLayer();
    const mod = await import(pathToFileURL(path.join(HERE, 'suites', 'git204.mjs')).href);
    return mod.default({ agentDir: AGENT_DIR, home: HOME, env: ENVV, log: console.log, report });
  },
  '204-remote': async () => {
    installCompatLayer();
    const mod = await import(pathToFileURL(path.join(HERE, 'suites', 'git204.mjs')).href);
    return mod.default({ agentDir: AGENT_DIR, home: HOME, env: ENVV, log: console.log, report, remoteOnly: true });
  },
  model: async () => {
    installCompatLayer();
    const mod = await import(pathToFileURL(path.join(HERE, 'suites', 'model.mjs')).href);
    return mod.default({ env: ENVV, log: console.log, report });
  },
  probe: async () => {
    installCompatLayer();
    const mod = await import(pathToFileURL(path.join(HERE, 'suites', 'probe.mjs')).href);
    return mod.default({ env: ENVV, log: console.log, report });
  }
};

async function main() {
  // 108 的语例不需要环境文件（也不许预装兼容层）⇒ 只有其他 suite 才取环境
  const wanted = process.env.PI_DEVICE_TEST_SUITE || '';
  if (!wanted.startsWith('108')) {
    await loadEnv();
  }
  const suite = suiteName();
  const list = suite === 'all'
    ? ['204-unit', '204-e2e', 'model']
    : suite.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  console.log('[devtest] 环境来源=' + ENV_SOURCE + '，suite=' + list.join(',')
    + '，env 键=' + Object.keys(ENVV).join(','));
  const unknown = list.filter((s) => !SUITES[s]);
  if (unknown.length > 0) {
    console.log('[devtest] 未知 suite：' + unknown.join(', ') + '；可用：' + Object.keys(SUITES).join(', ') + ', all');
    finish({ exitCode: 91, pass: 0, fail: 1, skipped: 0, unknown });
    process.exit(91);
  }
  const totals = { pass: 0, fail: 0, skipped: 0 };
  const perSuite = [];
  for (const name of list) {
    console.log('\n[devtest] ===== suite ' + name + ' (' + new Date().toISOString() + ') =====');
    let r = {};
    try {
      r = (await SUITES[name]()) || {};
    } catch (e) {
      console.log('[devtest] suite ' + name + ' 异常：' + (e && e.stack ? e.stack : String(e)));
      r = { pass: 0, fail: 1, skipped: 0, error: e && e.message ? e.message : String(e) };
    }
    perSuite.push({ suite: name, pass: r.pass || 0, fail: r.fail || 0, skipped: r.skipped || 0 });
    totals.pass += typeof r.pass === 'number' ? r.pass : 0;
    totals.fail += typeof r.fail === 'number' ? r.fail : 0;
    totals.skipped += typeof r.skipped === 'number' ? r.skipped : 0;
  }
  const exitCode = totals.fail === 0 ? 0 : 1;
  finish(Object.assign({ exitCode }, totals, { perSuite }));
  process.exit(exitCode);
}

await main();
