'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadYco } = require('./helpers');

const { CaptionHistory, constants } = loadYco();

/** 確定した行を集めながら、履歴を作る */
function createHistory(overrides = {}) {
  const lines = [];
  const history = new CaptionHistory({ onCommit: (line) => lines.push(line), ...overrides });
  return { history, lines };
}

// ---- 句読点のある字幕(手動字幕) -------------------------------------------

test('1 つの字幕が 1 文なら、その場で 1 行として確定する', () => {
  const { history, lines } = createHistory();
  history.update('Hello there my friend.');
  assert.deepEqual(lines, ['Hello there my friend.']);
  assert.equal(history.pending, '');
});

test('文の途中の字幕は、未確定のまま表示に残る', () => {
  const { history, lines } = createHistory();
  history.update('So today we are going to talk');
  assert.deepEqual(lines, []);
  assert.equal(history.pending, 'So today we are going to talk');
});

test('1 つの文が複数の字幕にまたがっても、文末まで貯めて 1 行にする', () => {
  const { history, lines } = createHistory();
  history.update('So today we are going to talk');
  history.update('about captions and more.');
  assert.deepEqual(lines, ['So today we are going to talk about captions and more.']);
  assert.equal(history.pending, '');
});

test('1 つの字幕に複数の文があれば、文ごとに行を分ける', () => {
  const { history, lines } = createHistory();
  history.update('First one here. Second one here.');
  assert.deepEqual(lines, ['First one here.', 'Second one here.']);
});

test('確定した文は、字幕が伸びても二重に確定しない', () => {
  const { history, lines } = createHistory();
  history.update('Hello there my friend.');
  history.update('Hello there my friend. How are');
  assert.deepEqual(lines, ['Hello there my friend.']);
  assert.equal(history.pending, 'How are');
  history.update('Hello there my friend. How are you?');
  assert.deepEqual(lines, ['Hello there my friend.', 'How are you?']);
});

test('略語の後ろでは区切らず、"I." では区切る', () => {
  const { history, lines } = createHistory();
  history.update('Mr. Smith went home. So do I. Yes.');
  assert.deepEqual(lines, ['Mr. Smith went home.', 'So do I.', 'Yes.']);
});

test('日本語(句読点なし)は、字幕ごとに行を分ける', () => {
  const { history, lines } = createHistory();
  history.update('これは');
  history.update('続きです');
  history.update('次の行です');
  assert.deepEqual(lines, ['これは', '続きです']);
  assert.equal(history.pending, '次の行です');
});

test('日本語でも、句点で終わっていれば文として確定する', () => {
  const { history, lines } = createHistory();
  history.update('これは文です。');
  assert.deepEqual(lines, ['これは文です。']);
});

// ---- 句読点のない手動字幕(歌詞など) -----------------------------------------------

test('歌詞: 句読点がなくても、大文字で始まる字幕ごとに行を分ける', () => {
  const { history, lines } = createHistory();
  for (const cue of ['The gate opened on me', 'So I leaped', 'Down, down, and down I go', 'I tell myself I am a tough girl']) {
    history.update(cue);
  }
  assert.deepEqual(lines, ['The gate opened on me', 'So I leaped', 'Down, down, and down I go']);
  assert.equal(history.pending, 'I tell myself I am a tough girl');
});

test('歌詞: 字幕が途切れる(空になる)間をはさんでも、大文字で始まれば分ける', () => {
  const { history, lines } = createHistory();
  history.update('My heart goes right');
  history.update('');
  history.update('My head goes left');
  assert.deepEqual(lines, ['My heart goes right']);
  assert.equal(history.pending, 'My head goes left');
});

test('歌詞: 小文字で始まる字幕は、前の字幕の続きとしてつなぐ', () => {
  const { history } = createHistory();
  history.update('And end up');
  history.update('on your bed');
  assert.equal(history.pending, 'And end up on your bed');
});

test('文が続く語(and / the / to など)や記号で終わる字幕のあとは、大文字で始まっても分けない', () => {
  for (const [first, second] of [
    ['We went to see the', 'Eiffel Tower today'],
    ['She said hello,', 'Harry waved back'],
    ['It was cold and', 'Windy outside'],
  ]) {
    const { history, lines } = createHistory();
    history.update(first);
    history.update(second);
    assert.deepEqual(lines, [], `${first} / ${second}`);
  }
});

test('全部が大文字の字幕は、大文字を手がかりにせず、つなげる', () => {
  const { history, lines } = createHistory();
  history.update('THE QUICK BROWN');
  history.update('FOX JUMPS');
  assert.deepEqual(lines, []);
  assert.equal(history.pending, 'THE QUICK BROWN FOX JUMPS');
});

test('自動生成字幕(ロールアップ)は、大文字では分けない', () => {
  const { history, lines } = createHistory();
  history.update('the quick brown fox', { rollup: true });
  history.update('Something else entirely different', { rollup: true });
  assert.deepEqual(lines, []);
});

test('字幕が伸びただけのとき(続き)は、大文字が混ざっても分けない', () => {
  const { history, lines } = createHistory();
  history.update('We met');
  history.update('We met Harry at the zoo');
  assert.deepEqual(lines, []);
  assert.equal(history.pending, 'We met Harry at the zoo');
});

test('文末が来ないまま止まったら、commitPending() で確定できる', () => {
  const { history, lines } = createHistory();
  history.update('This cue has no ending yet');
  history.commitPending();
  assert.deepEqual(lines, ['This cue has no ending yet']);
  assert.equal(history.pending, '');
});

test('確定後に字幕が伸びたら、続きだけが未確定になる', () => {
  const { history, lines } = createHistory();
  history.update('So today we talk');
  history.commitPending();
  history.update('So today we talk about captions');
  assert.deepEqual(lines, ['So today we talk']);
  assert.equal(history.pending, 'about captions');
});

test('字幕が一時的に短くなっても、長い方を保持する', () => {
  const { history } = createHistory();
  history.update('Hello there my friend');
  history.update('Hello there');
  assert.equal(history.visible, 'Hello there my friend');
});

test('字幕が消えたら、未確定の断片は次の字幕とつながる', () => {
  const { history, lines } = createHistory();
  history.update('This is a long sentence that');
  history.update('');
  assert.deepEqual(lines, []);
  history.update('never really ends here.');
  assert.deepEqual(lines, ['This is a long sentence that never really ends here.']);
});

test('直前と同じ行は、二重に確定しない', () => {
  const { history, lines } = createHistory();
  history.update('Hi there.');
  history.update('');
  history.update('Hi there.');
  assert.deepEqual(lines, ['Hi there.']);
});

test('文末が来ないまま長くなったら、途中でも区切る', () => {
  const limits = { ...constants.LIMITS, maxPending: 30 };
  const { history, lines } = createHistory({ limits });
  history.update('a'.repeat(10) + ' ' + 'b'.repeat(10));
  assert.deepEqual(lines, []);
  history.update('a'.repeat(10) + ' ' + 'b'.repeat(10) + ' ' + 'c'.repeat(10));
  assert.equal(lines.length, 1);
  assert.ok(history.isUnpunctuated, '以後は句読点のない字幕として扱う');
  assert.equal(history.stallDelayMs, constants.TIMING.stallMs);
});

test('文末記号が来たら、句読点なしの扱いをやめる', () => {
  const limits = { ...constants.LIMITS, maxPending: 20 };
  const { history } = createHistory({ limits });
  history.update('a'.repeat(30));
  assert.ok(history.isUnpunctuated);
  history.update('a'.repeat(30) + ' Done.');
  assert.ok(!history.isUnpunctuated);
});

test('stallDelayMs: 手動字幕は長め、自動生成字幕は短め', () => {
  const { history } = createHistory();
  history.update('Something', { rollup: false });
  assert.equal(history.stallDelayMs, constants.TIMING.longStallMs);
  history.update('Something else entirely', { rollup: true });
  assert.equal(history.stallDelayMs, constants.TIMING.stallMs);
});

test('reset(): すべて忘れる', () => {
  const { history, lines } = createHistory();
  history.update('Unfinished thought');
  history.reset();
  assert.equal(history.pending, '');
  assert.equal(history.visible, '');
  history.update('Hi there.');
  assert.deepEqual(lines, ['Hi there.']);
});

// ---- 句読点のない字幕(自動生成) ---------------------------------------------

test('自動生成字幕: 単語が増えている間は未確定、止まったら確定する', () => {
  const { history, lines } = createHistory();
  history.update('so today we are going', { rollup: true });
  history.update('so today we are going to talk about it', { rollup: true });
  assert.deepEqual(lines, []);
  history.commitPending();
  assert.deepEqual(lines, ['so today we are going to talk about it']);
});

test('自動生成字幕: 行が繰り上がっても、消えた先頭部分が失われない', () => {
  const { history, lines } = createHistory();
  history.update('the quick brown fox jumps over the lazy dog and', { rollup: true });
  // 1 行目が消え、2 行目が先頭に繰り上がる(前の末尾が新しい先頭に残る)
  history.update('over the lazy dog and then it ran far away home', { rollup: true });
  assert.deepEqual(lines, []);
  assert.equal(history.pending, 'the quick brown fox jumps over the lazy dog and then it ran far away home');
  history.commitPending();
  assert.deepEqual(lines, ['the quick brown fox jumps over the lazy dog and then it ran far away home']);
});

test('自動生成字幕: 止まらず喋り続けても、長くなったら区切る', () => {
  const { history, lines } = createHistory();
  const words = 'and then the speaker keeps going without any pause at all because the caption is generated automatically and never has punctuation marks so the lines keep rolling up'.split(' ');
  let visible = '';
  for (const word of words) {
    visible = visible ? `${visible} ${word}` : word;
    history.update(visible, { rollup: true });
  }
  assert.ok(lines.length >= 1, '長さの上限で区切られる');
  assert.ok(
    lines.every((line) => line.length <= constants.LIMITS.maxPendingUnpunctuated + 20),
    `1 行が長すぎない: ${lines.map((l) => l.length)}`,
  );
  // 区切られた行と未確定を合わせると、元の字幕がすべて残る
  const all = [...lines, history.pending].join(' ');
  assert.equal(all, words.join(' '));
});

// ---- 字幕の言語 -----------------------------------------------------------------

test('setLanguage(): その言語の略語の後ろでは、文を確定しない', () => {
  const { history, lines } = createHistory();
  history.setLanguage('de');
  history.update('Das ist z.B. ein Test.');
  assert.deepEqual(lines, ['Das ist z.B. ein Test.']);
});

test('setLanguage() をしなければ、英語の表で区切る(z.B. で区切れてしまう)', () => {
  const { history, lines } = createHistory();
  history.update('Das ist z.B. ein Test.');
  assert.deepEqual(lines, ['Das ist z.B.', 'ein Test.']);
});
