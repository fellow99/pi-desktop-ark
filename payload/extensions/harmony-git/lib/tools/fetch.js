import { gitRuntime, repoRoot, assertIsRepo, netFor, rethrowNet, fsFor } from './ctx.js';

export default {
  name: 'git_fetch',
  label: 'Git 抓取',
  description: 'git fetch：从远端抓取更新（不改动当前工作区）。需要网络与凭据（git_credentials 管理）。',
  promptSnippet: '同步远端信息；合并到本地请用 git_pull 或 git_merge。',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: '仓库目录（默认会话当前目录）' },
      remote: { type: 'string', description: '远端名，默认 origin' },
      url: { type: 'string', description: '显式远端 URL（可选，优先于 remote 配置）' },
      ref: { type: 'string', description: '只抓取指定分支' },
      depth: { type: 'number', description: '浅抓取深度' },
    },
  },
  executionMode: 'sequential',
  async execute(_id, params, _signal, _onUpdate, ctx) {
    try {
      const { root, outsideRoot, hint } = repoRoot(params, ctx);
      if (outsideRoot) return { content: [{ type: 'text', text: hint }], isError: true };
      const { git } = gitRuntime();
      await assertIsRepo(root);
      const remote = params.remote || 'origin';
      let url = params.url;
      if (!url) {
        const remotes = await git.listRemotes({ fs: fsFor(root), dir: root });
        const hit = remotes.find((r) => r.remote === remote);
        if (!hit) return { content: [{ type: 'text', text: `远端 ${remote} 不存在，先用 git_remote add 添加。` }], isError: true };
        url = hit.url;
      }
      const { fs, http, auth } = netFor(root, url);
      try {
        const res = await git.fetch({
          fs, http, dir: root, url, remote,
          ref: params.ref, depth: params.depth,
          ...auth,
        });
        return {
          content: [{ type: 'text', text: `fetch 完成：${url}${params.ref ? `（${params.ref}）` : ''}` }],
          details: { ok: true, url, remote, fetchHead: res.fetchHead || null, pruned: res.pruned || [] },
        };
      } catch (e) {
        rethrowNet(e, url);
      }
    } catch (e) {
      return { content: [{ type: 'text', text: `git_fetch 失败：${e.message}` }], details: { ok: false, message: e.message }, isError: true };
    }
  },
};
