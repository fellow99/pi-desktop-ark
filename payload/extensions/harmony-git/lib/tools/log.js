import { gitRuntime, fsFor, repoRoot, assertIsRepo } from './ctx.js';
import { renderCommit } from '../report.js';

export default {
  name: 'git_log',
  label: 'git_log',
  description: 'Show commit history (newest first).',
  promptSnippet: 'Show git commit history',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: '仓库目录（默认会话当前目录）' },
      depth: { type: 'number', description: 'Max commits to show (default 20)' },
      ref: { type: 'string', description: 'Starting ref (branch/tag/HEAD/oid, default HEAD)' },
    },
      },
  annotations: { readOnlyHint: true },
  async execute(_id, params, _signal, _onUpdate, ctx) {
    try {
      const { git } = gitRuntime();
      const { root } = repoRoot(params, ctx);
      assertIsRepo(root);
      const fs = fsFor(root);
      const commits = await git.log({ fs, dir: root, depth: params.depth ?? 20, ref: params.ref });
      if (commits.length === 0) return { content: [{ type: 'text', text: 'No commits yet.' }], details: {} };
      const text = commits.map(renderCommit).join('\n');
      return { content: [{ type: 'text', text }], details: { count: commits.length, commits: commits.map((c) => ({ oid: c.oid, message: (c.commit.message || '').trim().split('\n')[0] })) } };
    } catch (e) {
      return { content: [{ type: 'text', text: `git_log 失败：${e.message}` }], details: {}, isError: true };
    }
  },
};
