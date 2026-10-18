# 204-plugin-git 技术方案（pi-desktop-ark）

> **Module:** 204-plugin-git ｜ **Last Updated:** 2026-10-18
> **对应规格:** [spec.md](./spec.md) ｜ **单一事实源:** `pi-desktop-hos/specs/204-plugin-git/`
> **设计文档:** [`../../docs/204-插件-GIT.md`](../../docs/204-插件-GIT.md)

## 1. 总体思路

ark **不写 git 领域逻辑**：把 `pi-desktop-hos/extensions/harmony-git/` 经 `scripts/sync-git-extension.mjs` 幂等拷贝为 `payload/extensions/harmony-git/`（+ V2 头注），由既有 payload 装配/物化链上设备。

## 2. 同步脚本（FR-ARK-204-002）

`scripts/sync-git-extension.mjs`（幂等，零依赖 ESM）：
- 源 `../pi-desktop-hos/extensions/harmony-git/` → 目标 `payload/extensions/harmony-git/`；
- 递归拷贝 `index.js`、`package.json`、`lib/**`、`vendor/**`、`tests/**`、`README*`；
- 对 `*.js`/`*.cjs`/`*.md` 头部加 V2 注记（沿用现有 4 扩展约定）；
- 逐文件内容比对，无变化则跳过（幂等）；打印新增/覆盖/跳过计数；
- 设备端永不执行本脚本。

## 3. 装配链（FR-ARK-204-003/004）

```
hos 源 extensions/harmony-git/**
  │ sync-git-extension.mjs（拷贝 + 头注）
  ▼
ark payload/extensions/harmony-git/**     ← 入 git
  │ assemble-payload.mjs（APP_PAYLOAD_ENTRIES 含 'extensions'，walkTree 递归）
  ▼
build/payload-stage/pi-web/extensions/harmony-git/**
  │ tar → entry/src/main/resources/resfile/pi-web/pi-web.tar.gz + .version
  ▼
hvigor assembleHap → entry-default-signed.hap
  ▼ 运行期
bootstrap.js 解包 → <filesDir>/payload/<sha12>/pi-web/extensions/harmony-git/**
  │ pi-web-launch.js#materializeAgentResources（copy extensions/**，原子 tmp+rename）
  ▼
<filesDir>/pi-agent/extensions/harmony-git/**   ← pi 自动扫描 index.js → jiti 加载 → 注册 21+1 工具
```

**不改 `assemble-payload.mjs`、`pi-web-launch.js`、`bootstrap.js`。**

## 4. 验证（无真机）

1. 主机 `node --test`（对 ark 副本跑 hos 的 tests/）。
2. **Node v24 + jiti 2.7.0** 加载 `payload/extensions/harmony-git/index.js`，mock pi 捕获 22 注册，临时仓库跑 init/add/commit/log/diff/本地 file 远端 clone/push（AC-ARK-2）。
3. `node scripts/assemble-payload.mjs` dry/--apply 核对扩展+vendor 入 tar（AC-ARK-3）。
4. hvigor HAP 编译（工具链 `D:\oh-workspace\command-line-tools-6` + `deveco-studio-6\jbr`）。
