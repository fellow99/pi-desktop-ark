import { gitRuntime, fsFor, repoRoot, assertIsRepo } from './ctx.js';

const ALLOWED_KEYS = new Set(['user.name', 'user.email']);

export default {
  name: 'git_config',
  label: 'Git 配置',
  description: '读取/设置仓库级 git 配置。出于安全仅允许 user.name 与 user.email。action=get|set（默认 get）。',
  promptSnippet: '查看或设置提交作者信息（user.name / user.email）。',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: '仓库目录（默认会话当前目录）' },
      action: { type: 'string', enum: ['get', 'set'], description: '默认 get' },
      key: { type: 'string', description: '配置键（仅 user.name / user.email）' },
      value: { type: 'string', description: 'set 时的值' },
    },
    required: ['key'],
  },
  executionMode: 'sequential',
  async execute(_id, params, _signal, _onUpdate, ctx) {
    try {
      const { root, outsideRoot, hint } = repoRoot(params, ctx);
      if (outsideRoot) return { content: [{ type: 'text', text: hint }], isError: true };
      if (!ALLOWED_KEYS.has(params.key)) {
        return {
          content: [{ type: 'text', text: `不允许的键：${params.key}。仅支持 ${[...ALLOWED_KEYS].join('、')}。` }],
          isError: true,
        };
      }
      const { git } = gitRuntime();
      const fs = fsFor(root);
      await assertIsRepo(root);
      const action = params.action || 'get';
      if (action === 'get') {
        const value = await git.getConfig({ fs, dir: root, path: params.key });
        return {
          content: [{ type: 'text', text: value == null ? `${params.key} 未设置。` : `${params.key} = ${value}` }],
          details: { ok: true, key: params.key, value: value ?? null },
        };
      }
      if (typeof params.value !== 'string' || !params.value) {
        return { content: [{ type: 'text', text: 'set 需要非空 value。' }], isError: true };
      }
      await git.setConfig({ fs, dir: root, path: params.key, value: params.value });
      return { content: [{ type: 'text', text: `已设置 ${params.key} = ${params.value}` }], details: { ok: true, key: params.key, value: params.value } };
    } catch (e) {
      return { content: [{ type: 'text', text: `git_config 失败：${e.message}` }], details: { ok: false, message: e.message }, isError: true };
    }
  },
};
