'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadYco } = require('./helpers');

const { youtube } = loadYco();

// ---- 偽の DOM: readCaptions() が触る部分だけを再現する ------------------------

const textNode = (text) => ({ textContent: text });

/**
 * 字幕のウィンドウ(.caption-window)。
 * @param {object} spec
 * @param {string[]} [spec.lines]    .caption-visual-line ごとのテキスト
 * @param {string[]} [spec.segments] 行がないときの .ytp-caption-segment のテキスト
 */
function captionWindow({ id = 'caption-window-1', rollup = false, top = false, lines = [], segments = [] }) {
  return {
    id,
    textContent: [...lines, ...segments].join(' '),
    classList: {
      contains: (name) =>
        (rollup && name === 'ytp-caption-window-rollup') || (top && name === 'ytp-caption-window-top'),
    },
    querySelectorAll: (selector) => {
      if (selector === '.caption-visual-line') return lines.map(textNode);
      if (selector === '.ytp-caption-segment') return segments.map(textNode);
      return [];
    },
  };
}

/** 偽のページを用意して、その中で fn を実行する */
function withPage(windows, fn) {
  const player = { querySelectorAll: () => windows };
  globalThis.document = { querySelector: () => (windows === null ? null : player) };
  try {
    return fn();
  } finally {
    delete globalThis.document;
  }
}

test('折り返された字幕の行を、1 つにつなぐ', () => {
  const windows = [captionWindow({ lines: ['the quick brown', 'fox jumps'] })];
  assert.deepEqual(withPage(windows, youtube.readCaptions), { text: 'the quick brown fox jumps', rollup: false });
});

test('日本語の行は、空白を入れずにつなぐ', () => {
  const windows = [captionWindow({ lines: ['ポッター。そんなこと', 'は言わ'] })];
  assert.equal(withPage(windows, youtube.readCaptions).text, 'ポッター。そんなことは言わ');
});

test('行の要素がなければ、セグメントから読む', () => {
  const windows = [captionWindow({ segments: ['Hello', 'there'] })];
  assert.equal(withPage(windows, youtube.readCaptions).text, 'Hello there');
});

test('ウィンドウが複数あれば、改行でつなぐ', () => {
  const windows = [
    captionWindow({ id: 'caption-window-1', lines: ['First block.'] }),
    captionWindow({ id: 'caption-window-2', lines: ['Second block.'] }),
  ];
  assert.equal(withPage(windows, youtube.readCaptions).text, 'First block.\nSecond block.');
});

test('「クリックして設定」の UI ヒントは字幕に含めない', () => {
  const windows = [
    captionWindow({ id: 'caption-window-_5', top: true, lines: ['日本語 (自動生成) をクリックして設定'] }),
    captionWindow({ id: 'caption-window-1', lines: ['Real caption.'] }),
  ];
  assert.equal(withPage(windows, youtube.readCaptions).text, 'Real caption.');
});

test('上寄せの手動字幕は、id が caption-window-_N でも字幕として読む(ヒントの文言がなければ除外しない)', () => {
  const windows = [captionWindow({ id: 'caption-window-_7', top: true, lines: ['Rewrite the rules of the battlefield.'] })];
  assert.equal(withPage(windows, youtube.readCaptions).text, 'Rewrite the rules of the battlefield.');
});

test('ヒントの文言は、各国語でも除外する', () => {
  for (const hint of ['English (auto-generated) Click for settings', 'Haz clic para ver la configuración', '日本語 (自動生成) をクリックして設定']) {
    const windows = [captionWindow({ id: 'caption-window-_5', top: true, lines: [hint] })];
    assert.equal(withPage(windows, youtube.readCaptions).text, '', hint);
  }
});

test('手動字幕は id が caption-window-_N でも、下寄せなら字幕として読む(実際の YouTube で確認)', () => {
  const windows = [captionWindow({ id: 'caption-window-_4', lines: ['Also hier sind wir vor den Elefanten.'] })];
  assert.equal(withPage(windows, youtube.readCaptions).text, 'Also hier sind wir vor den Elefanten.');
});

test('自動生成字幕(ロールアップ表示)を判別する', () => {
  const windows = [captionWindow({ rollup: true, lines: ['so today we go'] })];
  assert.equal(withPage(windows, youtube.readCaptions).rollup, true);
});

test('空白だけの行は捨て、余分な空白は 1 つにする', () => {
  const windows = [captionWindow({ lines: ['  Hello \n  there  ', '   '] })];
  assert.equal(withPage(windows, youtube.readCaptions).text, 'Hello there');
});

test('字幕が何も出ていなければ、空文字を返す', () => {
  assert.deepEqual(withPage([], youtube.readCaptions), { text: '', rollup: false });
});

test('プレイヤーがなければ、空文字を返す', () => {
  assert.deepEqual(withPage(null, youtube.readCaptions), { text: '', rollup: false });
});
