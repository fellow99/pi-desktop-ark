/*
 * ⚠️ 模块格式：本文件是 **ESM**（`export default`），与 payload 根下的 CJS 装载链（bootstrap → require）不同。
 * 依据：pi 的扩展加载走 **jiti**（扩展名表含 .js/.mjs/.cjs/.ts），ESM 形态已在旧壳真机验证；
 * 形态沿用 `pi-desktop-hos/extensions/harmony-workspace-roots.js`（工程规划 §8.3「原样搬」），
 * 但**根清单不同**：ark 不含 `desktop`（桌面目录的 system_basic ACL 本版不申请），
 * V2 差异：`PI_HOS_ROOTS` 仍由宿主装配（现在来自 `payload/env.js` 的契约、由 ArkTS 侧 options.env 传入）；
 * 旧壳的 `globalThis.__PI_HOS_PERMISSION__`（Electron 主进程桥）在 V2 **不存在** ——
 * 本扩展会如实显示「不可判定（权限桥不可用）」，而不是猜一个值（Phase 2 再接到库的宿主桥）。
 */
/**
 * harmony-workspace-roots.js — 壳专用扩展（Pi Desktop / HarmonyOS，需求 203）
 *
 * 本扩展是**根级单文件扩展**，由 pi 的扩展自动发现扫描拾取（落点
 * `<userData>/pi-agent/extensions/harmony-workspace-roots.js`），无需在 settings.json 里声明。
 * 它同时充当「PL1 插件机制是否生效」在**主目录解析**这一侧的探针（工程规划 §5.4）。
 *
 * 提供的能力：
 *   `/roots` 命令 —— 打印工作区主目录（本版只有「沙箱」）的解析结果：
 *     绝对路径、是否存在、是否可读。
 *
 * 为什么需要它（specs/203-plugin-workspace-picker/ FR-203-019）：
 *   「选择工作区目录」对话框的主目录来自主进程写入的环境变量 `PI_HOS_ROOTS`
 *   （`src-main/main.js#installWorkspaceRoots`）。真机上这一链路一旦断掉，
 *   表现是「对话框里少了一个 Tab」而不是报错，很难归因。本命令把解析结果、
 *   可读性与授权状态一次性摊开，让排障者与模型都能自查。
 *
 * 数据来源与边界：
 *   - 主目录：`process.env.PI_HOS_ROOTS`（只读）；
 *   - 授权状态：V2 应走库的 ArkTS `HostBridge` 注册表（Node 侧经 `payload/host.js` 的
 *     `invoke('perm.check', …)` 调用），但该**传输在 Phase 1 未接线** ⇒ 本扩展读旧壳全局
 *     `globalThis.__PI_HOS_PERMISSION__`（V2 中不存在），读不到就**显式报「桥不可达」**，不猜。
 *
 * 刻意不做的事（与工程规划 §5.1 的权限模型一致）：不在工厂里启动进程、socket、watcher 或定时器 ——
 * pi 有不启会话就加载扩展的调用路径（`pi --help` 等），在工厂里起长驻资源会在那些路径上泄漏。
 * 本扩展无 `session_start` 钩子：主目录解析由主进程在启动期完成，扩展只在被调用时读取。
 */

import { readdirSync, statSync } from "node:fs";

/**
 * 旧壳主进程安装的桥的全局名（`src-main/main.js#installPermissionBridge`）。
 * ⚠️ V2 里这个全局**不存在**：宿主桥是库的 ArkTS `HostBridge` 注册表，Node 侧经
 * `payload/host.js` 的 `invoke('perm.check', …)` 抵达 —— 而该传输 **Phase 1 未接线**。
 * 所以下面读它是「探测式」的：读不到就明确报「桥不可达（Phase 1：库传输层未接线）」，
 * 绝不把 `undefined` 当成授权结论（C2：不隐藏平台真相）。
 */
const PERMISSION_BRIDGE = "__PI_HOS_PERMISSION__";

/** 主进程写入的根清单环境变量名。 */
const ROOTS_ENV = "PI_HOS_ROOTS";

/** 每个主目录的期望 id（顺序即对话框 Tab 顺序）。 */
const EXPECTED_IDS = ["sandbox"];

function lines(...parts) {
  return parts.filter((p) => p !== undefined && p !== null).join("\n");
}

/** @returns {{ roots: Array, error: string|null }} */
function readRoots() {
  const raw = process.env[ROOTS_ENV];
  if (!raw) {
    return { roots: [], error: `${ROOTS_ENV} 未设置：主进程的 installWorkspaceRoots() 未执行或失败` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { roots: [], error: `${ROOTS_ENV} 不是合法 JSON：${err && err.message}` };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { roots: [], error: `${ROOTS_ENV} 不是非空数组` };
  }
  return { roots: parsed, error: null };
}

/** 探测单个根：存在性 + 可读性（readdir 一次），不抛错。 */
function probeRoot(root) {
  const path = String(root && root.path ? root.path : "");
  if (!path) return { exists: false, readable: false, detail: "路径为空" };
  try {
    if (!statSync(path).isDirectory()) return { exists: true, readable: false, detail: "存在但不是目录" };
  } catch (err) {
    return { exists: false, readable: false, detail: `不可访问：${err && err.code}` };
  }
  try {
    readdirSync(path);
    return { exists: true, readable: true, detail: "可读" };
  } catch (err) {
    const code = err && err.code;
    // EPERM/EACCES 在真机上就是「用户目录未授权」的典型表现，给出可行动的解释。
    const hint = code === "EPERM" || code === "EACCES"
      ? "（未授权：需在 设置 → 应用 → Pi Desktop → 允许访问 中开启，并重启应用）"
      : "";
    return { exists: true, readable: false, detail: `存在但不可读：${code}${hint}` };
  }
}

/**
 * 经宿主桥取授权状态；不可判定时明确返回字符串而不是 false。
 *
 * F1：桥读不到（V2 常态：旧壳全局不存在、库的 HostBridge 传输在 Phase 1 未接线）时必须
 * **显式说出原因**，而不是把 `undefined` 静默当成一个授权结果。
 */
function permissionStatus(permType) {
  if (!permType) return "不适用（沙箱内，无 OS 权限门槛）";
  const bridge = globalThis[PERMISSION_BRIDGE];
  if (!bridge || bridge.available !== true || typeof bridge.check !== "function") {
    return "不可判定（桥不可达：Phase 1 库传输层未接线）";
  }
  const granted = bridge.check(permType);
  if (granted === undefined) return "不可判定（桥返回未知值）";
  // ⚠️ 真机实测：授予权限后实际读写成功，checkPermission 仍可能返回 false（假阴性）。
  // 所以这里报的是**预检意见**，不是结论 —— 判断「能不能用」请看上面的「状态」行（真实 readdir）。
  return granted ? "已授权" : "未授权（预检意见；若「状态」为可读则以此为准）";
}

function buildReport() {
  const { roots, error } = readRoots();
  const heading = "工作区主目录（需求 203 · 选择工作区目录）";

  if (error) {
    return lines(
      heading,
      `  ⚠ ${error}`,
      "",
      "  期望的主目录：沙箱（本版不声明任何用户目录根）。",
      "  对话框顶部缺失 Tab 时先查这里。",
    );
  }

  const ids = roots.map((r) => r && r.id);
  const missing = EXPECTED_IDS.filter((id) => !ids.includes(id));
  const table = roots.map((root) => {
    const probe = probeRoot(root);
    return lines(
      `  · ${root.label || root.id}（id=${root.id}）`,
      `      路径：${root.path}`,
      `      状态：${probe.detail}`,
      `      授权：${permissionStatus(root.permType)}`,
    );
  });

  return lines(
    heading,
    `  来源：环境变量 ${ROOTS_ENV}（主进程 installWorkspaceRoots 写入）`,
    `  数量：${roots.length} / 期望 ${EXPECTED_IDS.length}`,
    missing.length ? `  ⚠ 缺少主目录：${missing.join(", ")}` : "  ✓ 主目录齐备",
    "",
    ...table,
    "",
    "  说明：",
    "    · 沙箱根 = <filesDir>/workspace（V2：目录从库持有的 filesDir 派生，不再有 userData）。",
    "    · 本版**不声明任何用户目录根**：桌面（system_basic + ACL）/ 文档 / 下载 三项权限已全部撤销，",
    "      所以选择器里只有「沙箱」一个 Tab。外部文件请用「附加文件 / 选择器」（fs.pickFolder，",
    "      返回 URI、仅本会话有效——`FILE_ACCESS_PERSIST` 也已撤销，见 docs/ACL-无ACL评估.md）。",
    "    · 对话框内的「主动弹出授权窗」尚未通过 PoC（FR-203-017）。",
    "    · checkPermission 有假阴性（授予后仍可能报 false）；请以「状态」行的真实读目录结果为准。",
  );
}

export default function harmonyWorkspaceRoots(pi) {
  pi.registerCommand("roots", {
    description: "显示工作区主目录（本版只有沙箱）的解析结果与可读性",
    handler: async (_args, ctx) => {
      const report = buildReport();
      // 命令结果的主要通道是 UI；没有 UI 的模式（json/print）下退化为控制台。
      if (ctx.hasUI) {
        ctx.ui.notify(report, "info");
      } else {
        console.log(report);
      }
    },
  });
}
