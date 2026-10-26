'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT } = require('./helpers');

/**
 * page-bridge.js は document の CustomEvent で要求を受け、プレイヤーの getOption / setOption を呼ぶ。
 * ここでは偽の document と偽のプレイヤーで、その振る舞いを確かめる。
 */

let player = null; // テストごとに差し替える
const fakeDocument = new EventTarget();
fakeDocument.querySelector = (selector) => (selector === '#movie_player' ? player : null);
globalThis.document = fakeDocument;
require(path.join(ROOT, 'src/page-bridge.js'));

/** 偽のプレイヤー。字幕のトラックの一覧と、いま選ばれているトラックを持つ */
function createPlayer({ current = {}, tracklist = [] } = {}) {
  const state = { current, set: [] };
  return {
    state,
    getOption: (module, option) => {
      assert.equal(module, 'captions');
      return option === 'track' ? state.current : option === 'tracklist' ? tracklist : undefined;
    },
    setOption: (module, option, value) => {
      assert.equal(module, 'captions');
      assert.equal(option, 'track');
      state.set.push(value);
      state.current = value;
    },
  };
}

/** ブリッジに要求を送り、応答を返す */
function request(payload) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const onResponse = (event) => {
      const message = JSON.parse(event.detail);
      if (message.id !== id) return;
      fakeDocument.removeEventListener('yco:caption-response', onResponse);
      resolve(message);
    };
    fakeDocument.addEventListener('yco:caption-response', onResponse);
    fakeDocument.dispatchEvent(new CustomEvent('yco:caption-request', { detail: JSON.stringify({ id, ...payload }) }));
  });
}

const track = (languageCode, kind = '') => ({ languageCode, kind, displayName: languageCode });

test('英語以外が選ばれていたら、英語のトラックへ切り替え、元のトラックを返す', async () => {
  const german = track('de');
  player = createPlayer({ current: german, tracklist: [german, track('en')] });
  const response = await request({ action: 'prefer', languageCode: 'en' });
  assert.equal(response.ok, true);
  assert.equal(response.changed, true);
  assert.deepEqual(response.previous, german);
  assert.equal(player.state.current.languageCode, 'en');
});

test('すでに英語なら、何も変えない(en-US も英語として扱う)', async () => {
  const english = track('en-US');
  player = createPlayer({ current: english, tracklist: [english] });
  const response = await request({ action: 'prefer', languageCode: 'en' });
  assert.deepEqual([response.ok, response.changed], [true, false]);
  assert.equal(player.state.set.length, 0);
});

test('手動の英語字幕と自動生成(asr)があれば、手動を選ぶ', async () => {
  const auto = track('en', 'asr');
  const manual = track('en-GB');
  player = createPlayer({ current: track('de'), tracklist: [track('de'), auto, manual] });
  await request({ action: 'prefer', languageCode: 'en' });
  assert.equal(player.state.current, manual);
});

test('手動がなければ、自動生成の英語を選ぶ', async () => {
  const auto = track('en', 'asr');
  player = createPlayer({ current: track('de'), tracklist: [track('de'), auto] });
  await request({ action: 'prefer', languageCode: 'en' });
  assert.equal(player.state.current, auto);
});

test('英語のトラックがない動画は、そのままにする', async () => {
  player = createPlayer({ current: track('de'), tracklist: [track('de'), track('fr')] });
  const response = await request({ action: 'prefer', languageCode: 'en' });
  assert.deepEqual([response.ok, response.changed, response.reason], [true, false, 'no-track']);
  assert.equal(player.state.set.length, 0);
});

test('何も選ばれていなかったとき、previous は null(戻す先がない)', async () => {
  player = createPlayer({ current: {}, tracklist: [track('en')] });
  const response = await request({ action: 'prefer', languageCode: 'en' });
  assert.equal(response.changed, true);
  assert.equal(response.previous, null);
});

test('restore: 切り替える前のトラックに戻す', async () => {
  const german = track('de');
  player = createPlayer({ current: track('en'), tracklist: [german, track('en')] });
  assert.equal((await request({ action: 'restore', track: german })).ok, true);
  assert.equal(player.state.set.at(-1).languageCode, 'de');
});

test('プレイヤーがなければ、失敗として応答する', async () => {
  player = null;
  const response = await request({ action: 'prefer', languageCode: 'en' });
  assert.equal(response.ok, false);
});

test('未知の要求や、壊れた要求には、何もしない', async () => {
  player = createPlayer({ tracklist: [track('en')] });
  assert.equal((await request({ action: 'delete-everything' })).ok, false);
  fakeDocument.dispatchEvent(new CustomEvent('yco:caption-request', { detail: 'not json' })); // 例外にならない
  assert.equal(player.state.set.length, 0);
});

test('getOption が例外を投げても、応答は返る', async () => {
  player = { getOption: () => { throw new Error('boom'); }, setOption: () => {} };
  const response = await request({ action: 'prefer', languageCode: 'en' });
  assert.equal(response.ok, false);
  assert.match(response.error, /boom/);
});
