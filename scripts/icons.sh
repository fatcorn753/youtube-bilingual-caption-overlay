#!/bin/sh
# scripts/icon.svg から icons/ の PNG(16・48・128)を作る(macOS の Chrome が必要)。
# 使い方: sh scripts/icons.sh
set -eu

cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for size in 16 48 128; do
  cat > "$tmp/icon.html" <<HTML
<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style>
<img src="file://$PWD/scripts/icon.svg">
HTML
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --allow-file-access-from-files --window-size="$size,$size" --force-device-scale-factor=1 \
    --screenshot="icons/icon$size.png" "file://$tmp/icon.html" >/dev/null 2>&1
  echo "作成しました: icons/icon$size.png"
done
