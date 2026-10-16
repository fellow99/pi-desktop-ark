#!/usr/bin/env bash
# build-bridge-har.sh —— 构建 @fellow99/node-bridge 的 HAR 并放到本工程 libs/ 下
#
# 为什么需要它（关键，别绕开）：
#   pi-desktop-ark 通过 `oh-package.json5` 的
#       "@fellow99/node-bridge": "file:./libs/@fellow99/node-bridge.har"
#   依赖**构建好的 HAR**，而不是 ohos-node-bridge/library 的**源码目录**。
#   原因：本工程开着 `useNormalizedOHMUrl: true`，在该模式下**不允许**跨工程以
#   相对路径导入外部模块的源码（hvigor 报 00309001：Cannot import files from an
#   external module using relative paths）。而 HAR 是已编译产物，不受此限，
#   也更贴近真实消费方式（从 ohpm 拿到的就是 HAR）。
#
# 用法：
#   ./scripts/build-bridge-har.sh            # 构建 + 拷贝
#   BRIDGE=<路径> ./scripts/build-bridge-har.sh
#
# 前置：DEVECO_SDK_HOME / hvigorw / node 与构建 ohos-node-bridge 时相同。
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="${BRIDGE:-$HERE/../ohos-node-bridge}"
HVIGORW="${HVIGORW:-/d/oh-workspace/command-line-tools/bin/hvigorw.bat}"
OUT_DIR="$HERE/libs/@fellow99"
HAR_SRC="$BRIDGE/library/build/default/outputs/default/library.har"

[ -d "$BRIDGE/library" ] || { echo "✗ 找不到库工程：$BRIDGE/library（用 BRIDGE=<路径> 指定）" >&2; exit 2; }
[ -x "$HVIGORW" ] || [ -f "$HVIGORW" ] || { echo "✗ 找不到 hvigorw：$HVIGORW（用 HVIGORW=<路径> 指定）" >&2; exit 2; }

echo "→ 构建库 HAR：$BRIDGE"
cd "$BRIDGE"
cmd //c "$(cygpath -w "$HVIGORW" 2>/dev/null || echo "$HVIGORW") --mode module -p module=library@default assembleHar --no-daemon"

[ -f "$HAR_SRC" ] || { echo "✗ 构建后仍找不到 $HAR_SRC" >&2; exit 2; }

mkdir -p "$OUT_DIR"
cp -f "$HAR_SRC" "$OUT_DIR/node-bridge.har"
echo
echo "✓ HAR 就位：$OUT_DIR/node-bridge.har"
ls -la "$OUT_DIR"
echo
echo "下一步：ohpm install（把 file: 依赖链进 oh_modules）→ hvigorw assembleHap"
