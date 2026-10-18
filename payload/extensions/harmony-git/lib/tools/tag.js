import { gitRuntime, fsFor, repoRoot, assertIsRepo } from './ctx.js';

export default {
  name: 'git_tag',
  label: 'Git 标签',
  description: 'git tag：list（默认）| create <name> [--ref] [--annotate] | delete <name>。',
  promptSnippet: '列出、创建或删除标签。annotated 标签需要 tagger 信息。',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: '仓库目录（默认会话当前目录）' },
      action: { type: 'string', enum: ['list', 'create', 'delete'], description: '默认 list' },
      name: { type: 'string', description: '标签名（create/delete 必填）' },
      ref: { type: 'string', description: 'create 时指向的提交，默认 HEAD' },
      annotate: { type: 'boolean', description: '创建附注标签' },
      message: { type: 'string', description: '附注标签信息' },
      taggerName: { type: 'string' },
      taggerEmail: { type: 'string' },
      force: { type: 'boolean', description: '覆盖同名标签' },
    },
  },
  executionMode: 'sequential',
  async execute(_id, params, _signal, _onUpdate, ctx) {
    try {
      const { root, outsideRoot, hint } = repoRoot(params, ctx);
      if (outsideRoot) return { content: [{ type: 'text', text: hint }], isError: true };
      const { git } = gitRuntime();
      const fs = fsFor(root);
      await assertIsRepo(root);
      const action = params.action || 'list';

      if (action === 'list') {
        const tags = await git.listTags({ fs, dir: root });
        const text = tags.length ? tags.join('\n') : '（无标签）';
        return { content: [{ type: 'text', text }], details: { ok: true, count: tags.length, tags } };
      }
      if (!params.name) return { content: [{ type: 'text', text: '缺少 name 参数。' }], isError: true };

      if (action === 'create') {
        await git.tag({
          fs, dir: root, ref: params.name, object: params.ref || 'HEAD',
          force: params.force === true,
          ...(params.annotate ? {
            message: params.message || params.name,
            tagger: { name: params.taggerName || 'yourname', email: params.taggerEmail || 'yourname@somehost' },
          } : {}),
        });
        return { content: [{ type: 'text', text: `已创建标签 ${params.name}${params.annotate ? '（附注）' : ''}。` }], details: { ok: true, name: params.name } };
      }
      if (action === 'delete') {
        await git.deleteRef({ fs, dir: root, ref: `refs/tags/${params.name}` });
        return { content: [{ type: 'text', text: `已删除标签 ${params.name}。` }], details: { ok: true, name: params.name } };
      }
      return { content: [{ type: 'text', text: `未知 action：${action}` }], isError: true };
    } catch (e) {
      return { content: [{ type: 'text', text: `git_tag 失败：${e.message}` }], details: { ok: false, message: e.message }, isError: true };
    }
  },
};
