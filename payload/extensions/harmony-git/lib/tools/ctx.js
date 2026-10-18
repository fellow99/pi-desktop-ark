/**
 * ctx.js — 工具共享上下文：装载 runtime、解析仓库根、构造 fs/http、auth、围栏提示、错误归因。
 * 每个工具的 execute 以此取得 { git, http, fs, dir, root, auth, hint }。
 */
import path from 'node:path';
import { loadGitRuntime } from '../runtime.js';
import { createRepositoryFs } from '../fs-adapter.js';
import { resolveRepoRoot, fenceHint, hasGitDir, FenceError } from '../fence.js';
import { makeAuth, missingCredentialMessage, rethrowAuthError } from '../auth.js';
import { toHttpsUrl } from '../url.js';

/** 装载 git runtime（单例）。 */
export function gitRuntime() { return loadGitRuntime(); }

/** 解析仓库根（dir 相对会话 cwd）。返回 { root, outsideRoot, hint }。 */
export function repoRoot(params, ctx) {
  const cwd = (ctx && typeof ctx.cwd === 'string' && ctx.cwd) || process.cwd() || '/';
  const { root, roots, outsideRoot } = resolveRepoRoot(params.dir, cwd);
  return { root, outsideRoot, hint: fenceHint(root, roots, outsideRoot) };
}

/** 构造 isomorphic-git 调用上下文：{ fs }（chroot 适配器）。 */
export function fsFor(root) { return createRepositoryFs(root); }

/** 网络操作上下文：fs + http + onAuth（url 已转 https）。 */
export function netFor(root, url) {
  const { http } = loadGitRuntime();
  const httpsUrl = toHttpsUrl(url).url;
  return { fs: fsFor(root), http, url: httpsUrl, auth: makeAuth(httpsUrl) };
}

/** 解析任意引用（分支/tag/HEAD/完整或缩写 SHA）：先 resolveRef，失败再 expandOid。 */
export async function resolveAny(git, fs, root, ref) {
  try {
    return await git.resolveRef({ fs, dir: root, ref });
  } catch (e) {
    if (/^[0-9a-f]{4,39}$/i.test(ref) && typeof git.expandOid === 'function') {
      return await git.expandOid({ fs, dir: root, oid: ref });
    }
    throw e;
  }
}

/** 断言是 git 仓库；否则给清晰错误（不静默创建）。 */
export function assertIsRepo(root) {
  if (!hasGitDir(root)) {
    throw new FenceError(
      `${root} 不是 git 仓库（缺少 .git）。请先 git_init 初始化，或用 git_clone 克隆一个仓库。`,
      'GIT_NOT_A_REPO',
    );
  }
}

/** 网络错误统一归因：认证类 → 缺凭据指引；其余原样抛出。 */
export function rethrowNet(err, url) {
  rethrowAuthError(err, url);
}

export { missingCredentialMessage };
