import { gitRuntime, fsFor, repoRoot, assertIsRepo, resolveAny } from './ctx.js';
import { twoFilePatch, isBinary } from '../diff.js';

const MAX_PATCH_CHARS_DEFAULT = 60000;
const MAX_FILE_BYTES = 512 * 1024; // 单文件超此大小只给 stat，不出补丁

/** 读某 ref 下文件内容；不存在返回 null。 */
async function readAtRef(fs, dir, ref, filepath) {
  const { git } = gitRuntime();
  try {
    const oid = await resolveAny(git, fs, dir, ref);
    const { blob } = await git.readBlob({ fs, dir, oid, filepath });
    return Buffer.from(blob);
  } catch {
    return null;
  }
}

async function readWorkdir(fs, dir, filepath) {
  try {
    return Buffer.from(await fs.promises.readFile(`${dir}/${filepath}`));
  } catch {
    return null;
  }
}

/** 收集差异文件清单：{ filepath, status }[] */
async function collectFiles({ fs, dir, type, base, head, filepathFilter }) {
  const { git } = gitRuntime();
  const rows = [];
  if (type === 'range') {
    // 两棵树 walk 对比
    const baseOid = await resolveAny(git, fs, dir, base);
    const headOid = await resolveAny(git, fs, dir, head);
    const changes = new Map();
    await git.walk({
      fs, dir,
      trees: [git.TREE({ ref: baseOid }), git.TREE({ ref: headOid })],
      map: async (filepath, [a, b]) => {
        if (filepath === '.') return undefined;
        const aType = a && (await a.type());
        const bType = b && (await b.type());
        if (aType === 'tree' || bType === 'tree') return undefined; // 目录递归交给 walk
        if (aType !== 'blob' && bType !== 'blob') return undefined;
        const aOid = a && (await a.oid());
        const bOid = b && (await b.oid());
        if (aOid === bOid) return undefined;
        changes.set(filepath, { filepath, status: aOid ? (bOid ? 'M' : 'D') : 'A', aOid, bOid, baseOid, headOid });
        return undefined;
      },
    });
    for (const v of changes.values()) {
      if (!filepathFilter || v.filepath === filepathFilter) rows.push(v);
    }
    return rows;
  }

  // unstaged / staged 用 statusMatrix
  const matrix = await git.statusMatrix({ fs, dir, filepaths: filepathFilter ? [filepathFilter] : undefined });
  for (const [fp, headV, workdirV, stageV] of matrix) {
    if (type === 'unstaged') {
      // 工作区 ↔ 暂存区
      if (headV === 1 && workdirV === 2 && stageV !== 0) rows.push({ filepath: fp, status: 'M' });
      else if (headV === 1 && workdirV === 0) rows.push({ filepath: fp, status: 'D' });
      else if (headV === 0 && workdirV === 2 && stageV === 0) rows.push({ filepath: fp, status: 'A', untracked: true });
      else if (headV === 1 && workdirV === 2 && stageV === 0) rows.push({ filepath: fp, status: 'M' });
    } else {
      // staged：HEAD ↔ 暂存区（stage 与工作区一致时，以工作区内容为暂存内容的近似）
      if (headV === 0 && stageV === 2) rows.push({ filepath: fp, status: 'A' });
      else if (headV === 1 && stageV === 2 && workdirV === 1) rows.push({ filepath: fp, status: 'M' });
      else if (headV === 1 && stageV === 0 && workdirV === 1) rows.push({ filepath: fp, status: 'D' });
      else if (headV === 1 && workdirV === 2 && stageV === 2) rows.push({ filepath: fp, status: 'M', partiallyStaged: true });
    }
  }
  return rows;
}

export default {
  name: 'git_diff',
  label: 'Git 差异',
  description:
    'git diff：输出 unified diff 文本。type=unstaged（默认，工作区↔HEAD/暂存）| staged（暂存区↔HEAD，近似）| range（base↔head 两提交/分支/tag）。新增/删除/修改均覆盖；二进制文件只标注差异。',
  promptSnippet: '查看修改内容。range 模式比较两个提交（如 base=main head=HEAD）。',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: '仓库目录（默认会话当前目录）' },
      type: { type: 'string', enum: ['unstaged', 'staged', 'range'], description: '默认 unstaged' },
      base: { type: 'string', description: 'range 模式起点（SHA/分支/tag）' },
      head: { type: 'string', description: 'range 模式终点，默认 HEAD' },
      filepath: { type: 'string', description: '只看某个文件' },
      maxPatchChars: { type: 'number', description: '补丁文本总上限（默认 60000）' },
    },
  },
  annotations: { readOnlyHint: true },
  async execute(_id, params, _signal, _onUpdate, ctx) {
    try {
      const { root, outsideRoot, hint } = repoRoot(params, ctx);
      if (outsideRoot) return { content: [{ type: 'text', text: hint }], isError: true };
      const { git } = gitRuntime();
      const fs = fsFor(root);
      await assertIsRepo(root);
      const type = params.type || 'unstaged';
      if (type === 'range' && !params.base) {
        return { content: [{ type: 'text', text: 'range 模式需要 base 参数。' }], isError: true };
      }
      const head = params.head || 'HEAD';
      const maxPatchChars = typeof params.maxPatchChars === 'number' ? params.maxPatchChars : MAX_PATCH_CHARS_DEFAULT;

      const rows = await collectFiles({ fs, dir: root, type, base: params.base, head, filepathFilter: params.filepath });
      if (!rows.length) {
        return { content: [{ type: 'text', text: '（无差异）' }], details: { ok: true, type, fileCount: 0, files: [] } };
      }

      const parts = [];
      const files = [];
      let used = 0;
      let truncated = false;
      let omittedLargeBinary = 0;

      for (const row of rows) {
        let oldBuf = null;
        let newBuf = null;
        let oldLabel = `a/${row.filepath}`;
        let newLabel = `b/${row.filepath}`;

        if (type === 'range') {
          oldBuf = row.aOid ? await readAtRef(fs, root, params.base, row.filepath) : null;
          newBuf = row.bOid ? await readAtRef(fs, root, head, row.filepath) : null;
          oldLabel = `${params.base}:${row.filepath}`;
          newLabel = `${head}:${row.filepath}`;
        } else if (type === 'unstaged') {
          oldBuf = await readAtRef(fs, root, 'HEAD', row.filepath);
          newBuf = await readWorkdir(fs, root, row.filepath);
          oldLabel = `HEAD:${row.filepath}`;
        } else {
          // staged：HEAD ↔ 工作区（暂存内容的最近似公开读法）
          oldBuf = await readAtRef(fs, root, 'HEAD', row.filepath);
          newBuf = await readWorkdir(fs, root, row.filepath);
          oldLabel = `HEAD:${row.filepath}`;
          newLabel = `INDEX≈WORKDIR:${row.filepath}`;
        }

        const statOnly = (oldBuf && oldBuf.length > MAX_FILE_BYTES) || (newBuf && newBuf.length > MAX_FILE_BYTES);
        let patch;
        if (statOnly || isBinary(oldBuf) || isBinary(newBuf)) {
          patch = `Binary/Large files ${oldLabel} and ${newLabel} differ`;
          omittedLargeBinary++;
        } else {
          patch = twoFilePatch(oldLabel, newLabel, oldBuf, newBuf);
        }
        files.push({ filepath: row.filepath, status: row.status, bytes: { old: oldBuf ? oldBuf.length : 0, new: newBuf ? newBuf.length : 0 } });

        if (!patch) continue;
        if (used + patch.length > maxPatchChars) { truncated = true; continue; }
        used += patch.length;
        parts.push(patch.endsWith('\n') ? patch : patch + '\n');
      }

      const summary = `共 ${rows.length} 个文件有差异（type=${type}）`
        + (omittedLargeBinary ? `，其中 ${omittedLargeBinary} 个二进制/超大文件仅标注` : '')
        + (truncated ? '，补丁过长已截断（可用 filepath 或调大 maxPatchChars）' : '');
      const text = parts.length ? `${summary}\n\n${parts.join('\n')}` : summary;
      return {
        content: [{ type: 'text', text }],
        details: { ok: true, type, fileCount: rows.length, files, truncated, omittedLargeBinary },
      };
    } catch (e) {
      return { content: [{ type: 'text', text: `git_diff 失败：${e.message}` }], details: { ok: false, message: e.message }, isError: true };
    }
  },
};
