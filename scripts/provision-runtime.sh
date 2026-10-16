#!/usr/bin/env bash
# provision-runtime.sh —— 把 Node 运行时（libnode.so + libc++_shared.so）投放进 entry/libs/<abi>/
#
# 自本工程起，投放**只有一份实现**：ohos-node-bridge/tools/provision.mjs
#（版本与 SHA-256 固化在 ohos-node-bridge/runtime.lock.json，投放前跑七项 ELF 门禁，任一不过硬失败）。
#
# 用法：
#   ./scripts/provision-runtime.sh                 # 用本地运行时目录（<父工程>/ohos-node-runtime）
#   OHOS_NODE_RUNTIME_DIR=<dir> ./scripts/provision-runtime.sh
#   ./scripts/provision-runtime.sh --check         # 只校验，不投放
#   ./scripts/provision-runtime.sh --download      # 本地没有时联网取（国内需代理，见下）
#
# 环境变量：
#   BRIDGE   ohos-node-bridge 仓库路径（默认 ../ohos-node-bridge）
#   NODE     node 可执行文件（默认 PATH 里的 node）
#   ABI      目标 ABI（默认 arm64-v8a）
#
# 联网时注意：Node 内置 fetch **默认不读**代理环境变量，国内网络须显式开启——
#   export HTTPS_PROXY=http://127.0.0.1:7890
#   NODE_USE_ENV_PROXY=1 ./scripts/provision-runtime.sh --download
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ABI="${ABI:-arm64-v8a}"
DEST="$HERE/entry/libs/$ABI"
BRIDGE="${BRIDGE:-$HERE/../ohos-node-bridge}"
NODE_BIN="${NODE:-node}"

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "✗ 找不到 node（$NODE_BIN）。本脚本委托 $BRIDGE/tools/provision.mjs，需要 Node ≥ 18。" >&2
  exit 2
fi
if [ ! -f "$BRIDGE/tools/provision.mjs" ]; then
  echo "✗ 找不到 $BRIDGE/tools/provision.mjs —— 请把 ohos-node-bridge 放在同级目录，或用 BRIDGE=<路径> 指定。" >&2
  exit 2
fi

echo "→ 委托 $BRIDGE/tools/provision.mjs（锁文件 runtime.lock.json）"
"$NODE_BIN" "$BRIDGE/tools/provision.mjs" --out "$DEST" "$@"

echo
echo "投放结果："
ls -la "$DEST"
echo
echo "提示：libnode.so 必须与 libnode_bridge.so 一起进 HAP —— 后者随"
echo "      @fellow99/node-bridge（HAR）由 hvigor 打包，本脚本不用管。"
