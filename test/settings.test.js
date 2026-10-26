'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadYco } = require('./helpers');

const { settingsStore, constants } = loadYco();

test('normalize(): 保存されていない項目は既定値で補う', () => {
  assert.deepEqual(settingsStore.normalize({ fontSize: 40 }), { ...constants.DEFAULT_SETTINGS, fontSize: 40 });
});

test('normalize(): 選べない翻訳先(古い版・手書きの値)は既定値に戻す', () => {
  for (const bad of ['xx', '', null, 42, undefined]) {
    assert.equal(settingsStore.normalize({ targetLang: bad }).targetLang, constants.DEFAULT_SETTINGS.targetLang, String(bad));
  }
  assert.equal(settingsStore.normalize({ targetLang: 'ko' }).targetLang, 'ko');
});

test('isSupportedLanguage(): LANGUAGES にあるコードだけ true', () => {
  for (const { code } of constants.LANGUAGES) assert.equal(settingsStore.isSupportedLanguage(code), true, code);
  assert.equal(settingsStore.isSupportedLanguage('klingon'), false);
  assert.equal(settingsStore.isSupportedLanguage(undefined), false);
});

test('LANGUAGES: コードが重複せず、既定の翻訳先を含む', () => {
  const codes = constants.LANGUAGES.map((language) => language.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.includes(constants.DEFAULT_SETTINGS.targetLang));
});
