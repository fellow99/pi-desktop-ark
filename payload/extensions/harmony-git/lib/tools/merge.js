import { gitRuntime, fsFor, repoRoot, assertIsRepo } from './ctx.js';
import { renderConflicts } from '../report.js';

export default {
  name: 'git_merge',
  label: 'Git 合并',
  description:
    'git merge <theirs>：将指定分支/提交合并进当前分支。失败时返回结构化冲突清单（conflicts[].path），不会写入坏状态。',
  promptSnippet: '合并前先 git_status 确认工作区干净；冲突时向用户展示冲突文件并建议处理方式。',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: '仓库目录（默认会话当前目录）' },
      theirs: { type: 'string', description: '要合并进来的分支名或提交' },
      authorName: { type: 'string', description: '合并提交作者名' },
      authorEmail: { type: 'string', description: '合并提交作者邮箱' },
      message: { type: 'string', description: '合并提交信息（默认自动生成）' },
    },
    required: ['theirs'],
  },
  executionMode: 'sequential',
  async execute(_id, params, _signal, _onUpdate, ctx) {
    try {
      const { root, outsideRoot, hint } = repoRoot(params, ctx);
      if (outsideRoot) return { content: [{ type: 'text', text: hint }], isError: true };
      const { git } = gitRuntime();
      const fs = fsFor(root);
      await assertIsRepo(root);
      const author = {
        name: params.authorName || 'yourname',
        email: params.authorEmail || 'yourname@somehost',
      };
      try {
        const res = await git.merge({
          fs, dir: root, ours: 'HEAD', theirs: params.theirs, author,
          message: params.message, fastForward: true,
        });
        const kind = res.fastForward ? 'fast-forward' : (res.alreadyMerged ? '已是最新（无需合并）' : '合并提交');
        return {
          content: [{ type: 'text', text: `合并完成（${kind}）：${(res.oid || '').slice(0, 7) || '—'}` }],
          details: { ok: true, ...res },
        };
      } catch (e) {
        if (e && e.data && Array.isArray(e.data.filepaths)) {
          const conflictText = renderConflicts(e.data.filepaths);
          return {
            content: [{ type: 'text', text: `合并发生冲突（isomorphic-git 未写入工作区）：\n${conflictText}` }],
            details: { ok: false, conflicts: e.data.filepaths },
            isError: true,
          };
        }
        throw e;
      }
    } catch (e) {
      return { content: [{ type: 'text', text: `git_merge 失败：${e.message}` }], details: { ok: false, message: e.message }, isError: true };
    }
  },
};
