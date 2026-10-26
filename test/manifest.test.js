'use strict';

/**
 * manifest.json と翻訳メッセージ(_locales)の整合性を確かめる。
 * メッセージの追加・削除や、ファイルの改名で、うっかり壊してしまうのを防ぐ。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers');

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const manifest = readJson('manifest.json');
const packageJson = readJson('package.json');

const LOCALES = fs.readdirSync(path.join(ROOT, '_locales'));
const messages = Object.fromEntries(LOCALES.map((locale) => [locale, readJson(`_locales/${locale}/messages.json`)]));

/** src/ 以下のソースを、すべてつなげた文字列 */
const sourceText = fs
  .readdirSync(path.join(ROOT, 'src'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'))
  .join('\n');

const popupHtml = fs.readFileSync(path.join(ROOT, manifest.action.default_popup), 'utf8');

/** ソースが参照している翻訳メッセージのキー: t('key')、小窓のボタン addButton(label, 'key', action)、ポップアップの data-i18n="key" */
function referencedMessageKeys() {
  const keys = new Set();
  for (const match of popupHtml.matchAll(/data-i18n="([A-Za-z]+)"/g)) keys.add(match[1]);
  for (const match of sourceText.matchAll(/\bt\('([A-Za-z]+)'\)/g)) keys.add(match[1]);
  for (const match of sourceText.matchAll(/addButton\('[^']*', '([A-Za-z]+)'/g)) keys.add(match[1]);
  return keys;
}

test('manifest と package.json のバージョンが一致している', () => {
  assert.equal(manifest.version, packageJson.version);
});

test('manifest に書かれたスクリプトとアイコンが、すべて存在する', () => {
  const files = [...manifest.content_scripts.flatMap((entry) => entry.js), ...Object.values(manifest.icons)];
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} がありません`);
  }
});

test('ポップアップの HTML が読み込むスクリプトは、すべて存在する', () => {
  const popupDir = path.dirname(path.join(ROOT, manifest.action.default_popup));
  const scripts = [...popupHtml.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.ok(fs.existsSync(path.resolve(popupDir, script)), `${script} がありません`);
  }
});

test('src/ のスクリプトは、すべて manifest に登録されている(読み込み漏れがない)', () => {
  const registered = new Set(manifest.content_scripts.flatMap((entry) => entry.js));
  for (const file of fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
    assert.ok(registered.has(`src/${file}`), `src/${file} が manifest に登録されていません`);
  }
});

test('既定の言語(default_locale)のメッセージがある', () => {
  assert.ok(LOCALES.includes(manifest.default_locale));
});

test('どの言語も、同じメッセージのキーを持っている', () => {
  const [base, ...others] = LOCALES;
  const baseKeys = Object.keys(messages[base]).sort();
  for (const locale of others) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), baseKeys, `${locale} と ${base} でキーが違います`);
  }
});

test('すべてのメッセージが、空でない文字列を持っている', () => {
  for (const [locale, table] of Object.entries(messages)) {
    for (const [key, value] of Object.entries(table)) {
      assert.ok(typeof value.message === 'string' && value.message.length > 0, `${locale}/${key} が空です`);
    }
  }
});

test('ソースが参照するメッセージは、すべて定義されている', () => {
  const defined = new Set(Object.keys(messages[manifest.default_locale]));
  for (const key of referencedMessageKeys()) {
    assert.ok(defined.has(key), `メッセージ "${key}" が _locales にありません`);
  }
});

test('定義されたメッセージは、すべてどこかで使われている(使われないメッセージが残っていない)', () => {
  const used = referencedMessageKeys();
  for (const match of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z]+)__/g)) used.add(match[1]);
  for (const key of Object.keys(messages[manifest.default_locale])) {
    assert.ok(used.has(key), `メッセージ "${key}" はどこからも使われていません`);
  }
});
