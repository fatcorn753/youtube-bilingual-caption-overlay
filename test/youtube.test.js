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

/**
 * 偽のページを用意して、その中で fn を実行する。
 * @param {object[]|null} windows 字幕のウィンドウ。null ならプレイヤーがない
 * @param {Function} fn
 * @param {{container?: boolean, containerText?: string}} [options] 字幕の入れ物の有無と、ウィンドウ外の文字
 */
function withPage(windows, fn, { container = true, containerText = '' } = {}) {
  const containerElement = {
    textContent: containerText,
    querySelectorAll: () => windows,
  };
  const player = {
    classList: { contains: () => false },
    querySelectorAll: () => windows,
    querySelector: (selector) => (selector === '.ytp-caption-window-container' && container ? containerElement : null),
  };
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

test('isVideoPlaying: 再生中だけ true', () => {
  const player = (video) => ({ querySelector: () => video });
  const run = (video) => {
    globalThis.document = { querySelector: () => (video === undefined ? null : player(video)) };
    try {
      return youtube.isVideoPlaying();
    } finally {
      delete globalThis.document;
    }
  };
  assert.equal(run({ paused: false, ended: false }), true);
  assert.equal(run({ paused: true, ended: false }), false);
  assert.equal(run({ paused: false, ended: true }), false);
  assert.equal(run(null), false);
  assert.equal(run(undefined), false);
});

// ---- diagnoseCaptions: 読めない原因の見分け ----------------------------------

test('diagnoseCaptions: 字幕を読めたら ok', () => {
  const windows = [captionWindow({ lines: ['Hello there.'] })];
  assert.equal(withPage(windows, youtube.diagnoseCaptions), 'ok');
});

test('diagnoseCaptions: 字幕の入れ物はあるが字幕が出ていないだけなら empty(無音・間奏)', () => {
  assert.equal(withPage([], youtube.diagnoseCaptions), 'empty');
});

test('diagnoseCaptions: UI ヒントしかなければ empty', () => {
  const windows = [captionWindow({ id: 'caption-window-_5', top: true, lines: ['クリックして設定'] })];
  assert.equal(withPage(windows, youtube.diagnoseCaptions), 'empty');
});

test('diagnoseCaptions: ウィンドウに文字があるのに行を読めなければ unreadable', () => {
  // 行・セグメントの class が変わった想定: 文字はあるが、既知の要素では取れない
  const win = captionWindow({ lines: [], segments: [] });
  win.textContent = 'Some caption text';
  assert.equal(withPage([win], youtube.diagnoseCaptions), 'unreadable');
});

test('diagnoseCaptions: ウィンドウの外に文字があれば unreadable(.caption-window の class が変わった想定)', () => {
  assert.equal(withPage([], youtube.diagnoseCaptions, { containerText: 'Some caption text' }), 'unreadable');
});

test('diagnoseCaptions: 字幕の入れ物がなければ no-container', () => {
  assert.equal(withPage([], youtube.diagnoseCaptions, { container: false }), 'no-container');
  assert.equal(withPage(null, youtube.diagnoseCaptions), 'no-container');
});

test('isAdShowing: 広告の再生中だけ true', () => {
  const run = (adShowing) => {
    globalThis.document = {
      querySelector: () => ({ classList: { contains: (name) => adShowing && name === 'ad-showing' } }),
    };
    try {
      return youtube.isAdShowing();
    } finally {
      delete globalThis.document;
    }
  };
  assert.equal(run(true), true);
  assert.equal(run(false), false);
});

// ---- 字幕のトラックの切り替え(ブリッジとの通信) -----------------------------------

/** 偽の document で、ブリッジの代わりに応答を返す */
function withBridge(respond, fn) {
  const fakeDocument = new EventTarget();
  fakeDocument.addEventListener('yco:caption-request', (event) => {
    const request = JSON.parse(event.detail);
    const response = respond(request);
    fakeDocument.dispatchEvent(new CustomEvent('yco:caption-response', { detail: JSON.stringify({ id: request.id, ...response }) }));
  });
  globalThis.document = fakeDocument;
  return Promise.resolve(fn()).finally(() => delete globalThis.document);
}

test('preferCaptionLanguage: ブリッジの応答を返す', async () => {
  const previous = { languageCode: 'de' };
  const result = await withBridge(
    (request) => ({ ok: true, changed: true, previous, echoed: request.languageCode }),
    () => youtube.preferCaptionLanguage('en'),
  );
  assert.equal(result.changed, true);
  assert.deepEqual(result.previous, previous);
  assert.equal(result.echoed, 'en');
});

test('preferCaptionLanguage: ブリッジが失敗を返したら null', async () => {
  const result = await withBridge(() => ({ ok: false, reason: 'no-player' }), () => youtube.preferCaptionLanguage('en'));
  assert.equal(result, null);
});

test('restoreCaptionTrack: 戻すトラックを送る', async () => {
  let received = null;
  await withBridge(
    (request) => {
      received = request;
      return { ok: true };
    },
    () => youtube.restoreCaptionTrack({ languageCode: 'de' }),
  );
  assert.equal(received.action, 'restore');
  assert.equal(received.track.languageCode, 'de');
});
