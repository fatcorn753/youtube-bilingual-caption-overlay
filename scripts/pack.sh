#!/bin/sh
# Chrome ウェブストアへ提出する zip を dist/ に作る。
# 使い方: npm run pack   (または sh scripts/pack.sh)
set -eu

cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")
out="dist/bilingual-caption-overlay-${version}.zip"

mkdir -p dist
rm -f "$out"
# 拡張の実行に必要なものだけを入れる(テスト・ドキュメントは含めない)
zip -qr "$out" manifest.json src popup icons _locales

echo "作成しました: $out"
unzip -l "$out"
