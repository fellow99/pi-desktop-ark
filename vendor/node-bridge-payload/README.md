# vendor/node-bridge-payload

`@fellow99/node-bridge` 的 Node 侧载荷三件（**随库仓库分发，不随 HAR**），自本工程 vendored：

- `bootstrap.js` —— 库引导器（交给 `NodeRuntime.start()` 的 `scriptPath`）
- `host.js` —— bootstrap 同级依赖（关停钩子注册源）
- `lib/tar-extract.js` —— bootstrap 的解包实现（`require('./lib/tar-extract.js')`）

来源：[ohos-node-bridge/payload](https://github.com/fellow99/ohos-node-bridge/tree/main/payload)
（`@fellow99/node-bridge@0.1.0` 对应版本，与 `resfile/pi-web/` 内已投放副本逐字一致）。
`scripts/assemble-payload.mjs` 从本目录取这三件随包投放（resfile + 归档内各一份）。

**升级库版本时**：从库仓库对应 tag 同步这三件，并同步核对 `resfile/pi-web/` 副本。
