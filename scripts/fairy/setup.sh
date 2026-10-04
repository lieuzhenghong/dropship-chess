#!/bin/sh
# Builds Fairy-Stockfish with the patch dropship.ini needs, for
# `npm run ai:match -- fairy ...`. Output: node_modules/.cache/fairy-stockfish
set -e
COMMIT=9f778da667f6e07dae1e85d3e2ea204fc6dee94d
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../../node_modules/.cache"
SRC="$OUT/fairy-stockfish-src"
mkdir -p "$OUT"
if [ ! -d "$SRC" ]; then
  git clone -q https://github.com/fairy-stockfish/Fairy-Stockfish "$SRC"
fi
cd "$SRC"
git checkout -q "$COMMIT"
git apply --check "$HERE/pawn-drop-region.patch" 2>/dev/null && git apply "$HERE/pawn-drop-region.patch"
cd src
make -j"$(nproc)" build ARCH="${ARCH:-x86-64-modern}"
cp stockfish "$OUT/fairy-stockfish"
echo "Built $OUT/fairy-stockfish"
