/**
 * env.js —— **应用语义环境变量**的唯一事实源（CommonJS；由 `pi-web-launch.js` require）。
 *
 * 为什么要有这个文件（工程规划 §7.4 环境契约）：
 *   库只负责「运行 Node 需要的那几个变量」（`HOME`/`USERPROFILE`/`TMPDIR`/`TMP`/`TEMP`/
 *   `NODE_ENV`/`NODE_OPTIONS`/`UV_USE_IO_URING`），**不认识也不解释** `PI_*`（宪法 C1）。
 *   本工程负责的是**应用语义**那一半：pi 的数据落点、离线策略、代理绕过、工作区主目录、
 *   pi-web 的监听与鉴权。这一半的名字与语义**只写在这里**；ArkTS 侧（`PiDesktopRuntime`)
 *   按同一份名字装配 `options.env`，两边不一致时以本文件为准（并在 `[env]` 日志里可见）。
 *
 * 纯函数：`buildEnv(base, options)` —— 不读 `process.env`（由调用方传入），不写任何东西，
 * 因此可以在宿主机上直接断言（见 `DEV_CHECKLIST.md` 的复现命令）。
 *
 * ⚠️ 本文件**刻意不设**的变量（那是库的活）：
 *   `HOME` / `USERPROFILE` / `TMPDIR` / `TMP` / `TEMP` / `NODE_ENV` / `NODE_OPTIONS`。
 *   重复设置只会掩盖库的行为（`NODE_OPTIONS` 甚至必须被清空）。
 */

'use strict';

const path = require('node:path');

/**
 * 变量名清单（**契约表**）。ArkTS 侧用的是同一批字面量；改名字必须两处同时改，
 * 否则 `[env]` 日志会立刻显示「谁没给」。
 */
const KEYS = Object.freeze({
  agentDir: 'PI_CODING_AGENT_DIR',
  offline: 'PI_OFFLINE',
  noProxy: 'NO_PROXY',
  noProxyLower: 'no_proxy',
  roots: 'PI_HOS_ROOTS',
  skipVersionCheck: 'PI_WEB_SKIP_VERSION_CHECK',
  appName: 'PI_WEB_APP_NAME',
  webHostname: 'PI_WEB_HOSTNAME',
  webPort: 'PI_WEB_PORT',
  webPassword: 'PI_WEB_PASSWORD'
});

/** pi 默认的工作目录名（与 `PI_CODING_AGENT_DIR` 的区别：前者是默认 cwd，后者是数据/扩展根） */
const DEFAULT_CWD_DIRNAME = 'pi-cwd';
/** 数据与扩展根目录名 */
const AGENT_DIRNAME = 'pi-agent';
/** 沙箱工作区根（选择工作区目录对话框的第一个 Tab；旧壳 `installWorkspaceRoots` 同口径） */
const SANDBOX_DIRNAME = 'workspace';
/** 鸿蒙 2in1 的固定用户目录挂载点（设备实测存在；未授权时读目录 EPERM） */
const USER_HOME = '/storage/Users/currentUser';

/** 取环境值（空串按「未设置」对待：空串更可能是误置） */
function read(base, key) {
  if (base === null || base === undefined) return undefined;
  const value = base[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 拼绝对路径（一律 `/` 分隔；真机 cwd 是 `/`，相对路径没有意义） */
function joinPath(...parts) {
  return path.posix.join(...parts.filter((part) => typeof part === 'string' && part.length > 0));
}

/**
 * 代理绕过清单：保留继承值，追加 loopback 与本机地址（旧壳 `main.js:274-282` 同口径）。
 * 为什么必须做：本工程的一切请求都是**本机**同源请求，走代理等于把服务端请求送出去。
 */
function buildNoProxy(base, extra) {
  const current = read(base, KEYS.noProxy) || read(base, KEYS.noProxyLower) || '';
  const items = new Set(
    current
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  );
  for (const host of ['127.0.0.1', 'localhost', '::1']) items.add(host);
  for (const host of extra) if (typeof host === 'string' && host.length > 0) items.add(host);
  return [...items].join(',');
}

/**
 * 宿主声明的沙箱根 id（与 ArkTS 侧 `declaredRoots()` 的第一项、pi-web 补丁里的
 * `WORKSPACE_ROOT_ID_SANDBOX` 同一个字面量）。
 */
const SANDBOX_ROOT_ID = 'sandbox';

/** 词法「在根之内」判定（相等或以 `根/` 为前缀；带分隔符边界） */
function isInsideRoot(rootPath, targetPath) {
  const root = String(rootPath).replace(/\/+$/, '');
  if (!root) return false;
  return targetPath === root || targetPath.startsWith(`${root}/`);
}

/**
 * C2：**沙箱根必须落在 HOME 之内**。
 *
 * HOME 是应用自己的沙箱根（库注入的 `filesDir`）。真机上出现过的缺陷是基座少一层
 * （`…/el2/base/files/workspace`，缺了 `haps/<module>`）：它仍然「看起来像」沙箱路径，
 * 但既不在 HOME 之内、目录也不存在，表现为目录选择器的「沙箱」入口 404。
 * 因此这里做的是**基座一致性检查**，而不是可读性检查（可读性属宿主/ACL 的事）。
 *
 * 只查 sandbox 一项：桌面/文档/下载三个根本来就在 `/storage/Users/currentUser/…`，
 * 落在 HOME 之外是设计使然。
 */
function sandboxRootOutsideHome(roots, home) {
  const sandbox = roots.find((root) => root && root.id === SANDBOX_ROOT_ID);
  if (!sandbox) return `缺少 id=${SANDBOX_ROOT_ID} 的根`;
  const path = typeof sandbox.path === 'string' ? sandbox.path : '';
  if (!path) return `id=${SANDBOX_ROOT_ID} 的 path 为空`;
  if (!isInsideRoot(home, path)) return `${SANDBOX_ROOT_ID}=${path}（不在 HOME=${home} 之内）`;
  return null;
}

/**
 * 工作区主目录清单（host 已给出就原样保留 —— 选择器的结果是权威来源）。
 *
 * F2：清单缺失/非法时构造的兜底四项**不是用户的选择**，必须能被程序分辨：
 *   · 保留原来的 warn；
 *   · 每个兜底项带 `"fallback": true`（机器可读标记，写在产物值里）；
 *   · 返回值改为 `{ value, fallback }`，调用方按 `fallback` 布尔分流（env 键集不变）。
 * 选这个形态的理由：`PI_HOS_ROOTS` 的消费者要求它是**数组**且元素带 `id/label/path/permType`，
 * 多一个属性向后兼容；另加一个环境变量则会改掉 env 契约的键集（F2 要求最小改动）。
 */
function buildRoots(base, home, warn) {
  const inherited = read(base, KEYS.roots);
  if (inherited !== undefined) {
    try {
      const parsed = JSON.parse(inherited);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // C2：沙箱根必须与 HOME（应用沙箱）同基座，否则当场说出来（不静默、不改写）
        const outside = sandboxRootOutsideHome(parsed, home);
        if (outside !== null) {
          warn(`${KEYS.roots} 的沙箱根与 HOME 不同基座：${outside}`
            + '；沙箱根必须由宿主按 context.filesDir 派生（形如 …/haps/<module>/files/workspace）');
        }
        return { value: inherited, fallback: false };
      }
      warn(`${KEYS.roots} 不是非空数组，改用沙箱兜底清单`);
    } catch (err) {
      warn(`${KEYS.roots} 不是合法 JSON（${err && err.message}），改用沙箱兜底清单`);
    }
  }
  // 兜底：沙箱 + 文档 + 下载（**不含 desktop**：system_basic + ACL，本版不申请）。
  // 两个用户目录是 user_grant，未授权时 browse 会回 403 + permission，前端据此弹授权窗。
  const fallbackRoots = [
    { id: 'sandbox', label: '沙箱', path: joinPath(home, SANDBOX_DIRNAME), permType: null, fallback: true },
    { id: 'documents', label: '文档', path: `${USER_HOME}/Documents`, permType: 'directory_document', fallback: true },
    { id: 'download', label: '下载', path: `${USER_HOME}/Download`, permType: 'directory_download', fallback: true }
  ];
  return { value: JSON.stringify(fallbackRoots), fallback: true };
}

/**
 * 装配应用语义环境。
 *
 * @param {Record<string, string|undefined>} base 继承来的环境（通常是 `process.env`）
 * @param {{ route?: 'loopback'|'lan', lanIp?: string, warn?: (msg: string) => void, defaultCwd?: string }} [options]
 *   - `route`：`loopback`（默认，只监听 127.0.0.1 + **免密**）| `lan`（绑局域网 + 必须给密码）
 *   - `lanIp`：本机在局域网上的地址。路线 ② 在未显式给 `PI_WEB_HOSTNAME` 时**必须**提供它，
 *     且不能是 `0.0.0.0`；缺失/非法 ⇒ 抛错（不让服务悄悄绑到所有网卡）
 *   - `warn`：warn 通道（默认 `console.warn`；由调用方接进自己的日志）
 * @returns {Record<string, string>} 只含**本工程负责**的变量（可直接 `Object.assign(process.env, …)`）
 */
function buildEnv(base, options) {
  const opts = options === undefined || options === null ? {} : options;
  const warn = typeof opts.warn === 'function' ? opts.warn : (msg) => console.warn(`[env] ${msg}`);
  const route = opts.route === 'lan' ? 'lan' : 'loopback';
  const source = base === undefined || base === null ? {} : base;

  const home = read(source, 'HOME') || read(source, 'USERPROFILE');
  if (home === undefined) {
    // 不静默：HOME 由库注入，缺了说明启动参数装配有问题，后面所有路径都会错。
    warn('HOME/USERPROFILE 未设置（库应注入）；路径类变量将退化为相对路径，请检查 NodeRuntime.start 的 homeDir');
  }
  const homeRoot = home === undefined ? '.' : home;

  const env = {};
  env[KEYS.offline] = read(source, KEYS.offline) || '1';                 // 设备无 npm/git ⇒ 只走本地源
  env[KEYS.agentDir] = read(source, KEYS.agentDir) || joinPath(homeRoot, AGENT_DIRNAME);
  env[KEYS.noProxy] = buildNoProxy(source, [opts.lanIp]);
  env[KEYS.noProxyLower] = env[KEYS.noProxy];
  const roots = buildRoots(source, homeRoot, warn);
  env[KEYS.roots] = roots.value;
  if (roots.fallback) {
    // F2：兜底清单必须显式可见 —— warn 给人看，`"fallback": true` 给程序看（不许把兜底当用户选择）
    warn(`${KEYS.roots} 产自**兜底清单**（不是选择器结果）：每一项都带 "fallback": true 机器可读标记`);
  }
  // 品牌化与「不检查更新」（上游有运行时开关，见旧壳 main.js:265-272；零上游改动）
  env[KEYS.skipVersionCheck] = read(source, KEYS.skipVersionCheck) || '1';
  env[KEYS.appName] = read(source, KEYS.appName) || 'Pi Desktop';

  // ── pi-web 监听与鉴权（**路线相关**，工程规划 §6.2）────────────────────────────
  if (route === 'lan') {
    const password = read(source, KEYS.webPassword);
    if (password === undefined) {
      // 路线 ② 没有密码等于把服务端裸奔在局域网上：必须显式失败，不降级。
      throw new Error(`${KEYS.webPassword} 缺失：路线 ②（局域网）必须由宿主应用生成强密码后再设置该变量`);
    }
    // F1：`0.0.0.0` 会把服务绑到**所有**网卡（连同鉴权面）—— 显式给了 hostname 才允许绕过；
    // 否则必须给出具体网卡地址，缺失/非法时抛错（与上面缺密码同一条纪律：不降级、不静默）。
    const inheritedHostname = read(source, KEYS.webHostname);
    if (inheritedHostname !== undefined) {
      env[KEYS.webHostname] = inheritedHostname;
    } else {
      const lanIp = typeof opts.lanIp === 'string' ? opts.lanIp.trim() : '';
      if (lanIp.length === 0 || lanIp === '0.0.0.0') {
        throw new Error(`${KEYS.webHostname} 缺失且 lanIp 不可用（${lanIp === '' ? '未给/空串' : `= ${lanIp}`}）：`
          + '路线 ②（局域网）必须给出具体网卡地址；`0.0.0.0` 会绑到所有网卡，已拒绝');
      }
      env[KEYS.webHostname] = lanIp;
    }
    env[KEYS.webPort] = read(source, KEYS.webPort) || '0';
    env[KEYS.webPassword] = password;
  } else {
    // 路线 ①（首选）：只监听 loopback、**不设密码**（源码事实：未设密码 ⇒ 认证整体关闭，
    // 且 loopback 主机名直接放行，见 `pi-web/lib/request-security.ts:90-102` 与 `proxy.ts`）。
    env[KEYS.webHostname] = read(source, KEYS.webHostname) || '127.0.0.1';
    // 端口交给 Node 侧随机取（硬约束 ⑰：固定端口一旦被占 ⇒ EADDRINUSE ⇒ 整个 App 进程 abort）。
    env[KEYS.webPort] = read(source, KEYS.webPort) || '0';
    const inheritedPassword = read(source, KEYS.webPassword);
    if (inheritedPassword !== undefined) {
      // 显式给了密码就尊重它（调试/回退路线用），但必须说出来 —— 否则「为什么弹登录页」无从查起。
      warn(`${KEYS.webPassword} 在 loopback 路线下被显式设置（长度 ${inheritedPassword.length}），将启用密码闸门`);
      env[KEYS.webPassword] = inheritedPassword;
    }
  }
  return env;
}

/** 人读报告（**密码只报长度**；旧壳 `main.js:303-306` 同口径） */
function formatReport(env) {
  const password = env[KEYS.webPassword];
  return [
    `${KEYS.agentDir} = ${env[KEYS.agentDir]}`,
    `${KEYS.offline} = ${env[KEYS.offline]}`,
    `${KEYS.roots} = ${env[KEYS.roots]}`,
    `${KEYS.noProxy} = ${env[KEYS.noProxy]}`,
    `${KEYS.webHostname} = ${env[KEYS.webHostname]}｜${KEYS.webPort} = ${env[KEYS.webPort]}`,
    `${KEYS.webPassword} = ${password === undefined ? '(未设置 ⇒ 免密)' : `${password.length} 字符（不回显）`}`,
    `${KEYS.appName} = ${env[KEYS.appName]}｜${KEYS.skipVersionCheck} = ${env[KEYS.skipVersionCheck]}`
  ].join('\n  ');
}

module.exports = { KEYS, buildEnv, formatReport, DEFAULT_CWD_DIRNAME, AGENT_DIRNAME, SANDBOX_DIRNAME };
