# 文档

| 想了解 | 看哪里 |
| --- | --- |
| **本工程的完整规划**（目标形态、ArkTS 宿主 16 项能力、载荷与裁剪、鉴权、ACL、里程碑、风险、上架清单） | **[`000-工程规划.md`](000-工程规划.md)** ← **权威** |
| **能力复刻评估**（对标 `pi-desktop-hos`：33 项逐条判定、清单外 5 项差距、前置/难度/依赖、不可实现项） | **[`001-能力复刻评估.md`](001-能力复刻评估.md)** |
| ACL 落点、两次装机实测、两条设计规则（端口冲突 / 异常兜底） | [`ACL配置.md`](ACL配置.md) |
| **零 ACL 评估**（只保留 JIT 那 1 项 ACL 的依据；零 ACL 的两道硬门、8 个 `.wasm` 与 JS 替代、dshm 对照、P0–P5 路线） | [`ACL-无ACL评估.md`](ACL-无ACL评估.md) |
| **cwd / 沙箱路径的已知坑**（基座只有 `filesDir`、el2 别名 vs `hdc` 写法、「沙箱」入口从哪来） | [`已知坑-cwd与沙箱路径.md`](已知坑-cwd与沙箱路径.md) |
| 真机证据（原始 JSON + 复现命令） | `docs/evidence/`（本地留存，不入库） |
| 运行时形态与硬约束（为什么必须 `dlopen` + detached 线程、JIT↔ACL↔WASM 链条、16 条实现要点 + ⑰⑱） | `ohos-node-bridge/docs/000-工程规划.md` **§4.7 / §5.10 / §D.10** |
| 库对消费方的**对接契约**（承诺/责任/共享事实/章节映射） | 同文件 **§6** |
| 真机实测结论（SIGTRAP、`--jitless` 代价、`spawn` 可用性、实现偏差） | 同文件 **§D.8 / §D.9 / §D.10** |
| 运行时产物如何引入（`runtime.lock.json` + `tools/provision.mjs`，二进制不入库） | 同文件 **附录 G** |
| 本工程自身的构建/签名/装机步骤 | 仓库根 `README.md` + 本目录 `000-工程规划.md` **附录 A** |

## 说明（2026-10-16 文档拆分）

本工程**已有自己的规划文档**：原先写在库那份文档里的消费方内容（旧 §6 全部小节 + 附录 F 的 ACL 申报文本 +
§9.5 的上架清单 + 附录 C 的载荷体积账 + 部分风险/开放问题）**已整体迁入**
[`000-工程规划.md`](000-工程规划.md)。库那份文档收敛为**只讲 Node.js 运行时库本身**，
并在其 §6 保留「对接契约摘要」与 §6.4 的**章节映射表**（旧引用可据此对照）。

## 待补（Phase 1+）

- `specs/`：本工程自己的规格目录（编号见规划文档 §14.2，如 `101-runtime-integration`）；
- ~~与 `pi-desktop-hos` 的能力对齐矩阵（§8.1）落地成可验收清单~~ → ✅ 已落地：[`001-能力复刻评估.md`](001-能力复刻评估.md)（as-built 判定 + 未实现项前置/难度 + 不可实现项）
- 鉴权路线的最终选型（loopback 免密 vs 局域网 + 密码 + Cookie 注入，§6.2）；
- ArkWeb 探针结论（P0-3）与载荷路线定稿（P0-13，`resfile` 直读 vs `tar.gz` 自解包）。

---

## 附录：ohos-node-bridge → ohpm 双包迁移说明（2026-10-22）

> 本文档正文保留写作时的历史口径（旁路同级目录、手工投放等描述**不逐处改写**），迁移变动以本附录为准：

1. **库与运行时已上架 OpenHarmony ohpm 中心仓**（2026-10-22）：`@fellow99/node-bridge@0.1.0`（ArkTS API + NAPI 引导件）
   与 `@fellow99/node-runtime@24.2.0`（`libnode.so` + `libc++_shared.so`，版本 = Node 版本）。库源码仓库：
   [github.com/fellow99/ohos-node-bridge](https://github.com/fellow99/ohos-node-bridge)。
2. **`pi-desktop-ark` 改为常规 ohpm 版本号依赖**（`oh-package.json5`），父工程已移除 `ohos-node-bridge` submodule；
   历史的 `file:./libs/@fellow99/node-bridge.har` 本地旁路与 `scripts/build-bridge-har.sh` **退役**。
3. **运行时不再手工投放**：`scripts/provision-runtime.sh`（委托 `tools/provision.mjs`）退役，
   `libnode.so`/`libc++_shared.so` 由 `@fellow99/node-runtime` 的 HAR 经 hvigor 随 HAP 合并
   （`libnode.so` SHA-256 = `3019bf5f…51a1`，与锁值逐字一致，HAP 解包实测）。
4. **库载荷三件 vendored**：`bootstrap.js` / `host.js` / `lib/tar-extract.js` 不随 HAR 分发，
   已自持到 `vendor/node-bridge-payload/`（与原 `ohos-node-bridge/payload/` 逐字一致），
   `scripts/assemble-payload.mjs` 默认源改指该目录。
5. **相对路径引用失效**：正文中指向 `../ohos-node-bridge/` 的运行时契约 / 冻结契约链接，一律改为 GitHub 仓库对应路径。
6. **迁移后真机复测通过**（2026-10-22，HUAWEI MateBook Pro `3QC0226526001227`）：
   构建 → 安装 → Node v24.2.0 进程内就绪 → `GET /` 200（pi-web SPA）→ `/api/web-auth` 免密放行。

