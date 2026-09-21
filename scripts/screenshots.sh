#!/bin/sh
# README 用のスクリーンショットを docs/images/ に作る(macOS の Chrome が必要)。
# 使い方: sh scripts/screenshots.sh
# 表示するのは test/manual/demo.html の例文だけで、実際の動画は使わない。
set -eu

cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${PORT:-8765}"

python3 -m http.server "$PORT" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
sleep 1

for theme in dark light; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=760,500 --force-device-scale-factor=2 --virtual-time-budget=8000 \
    --screenshot="docs/images/overlay-$theme.png" \
    "http://localhost:$PORT/test/manual/demo.html?theme=$theme" >/dev/null 2>&1
  echo "作成しました: docs/images/overlay-$theme.png"
done
