'use strict';

/**
 * テスト用の共通処理。
 *
 * 拡張のソースは、ブラウザでは manifest.json の content_scripts.js に書かれた順に
 * 読み込まれ、`globalThis.YCO` に部品を登録していく。テストでも同じ順序で読み込んで、
 * 本番と同じ経路で部品を取り出す。
 */

const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = require(path.join(ROOT, 'manifest.json'));

/** ページ全体に依存する本体(content.js)は、テストでは読み込まない */
const ENTRY_POINT = 'src/content.js';

/** manifest の順にソースを読み込み、`globalThis.YCO` を返す */
function loadYco() {
  for (const file of manifest.content_scripts[0].js) {
    if (file === ENTRY_POINT) continue;
    require(path.join(ROOT, file));
  }
  return globalThis.YCO;
}

module.exports = { loadYco, ROOT };
