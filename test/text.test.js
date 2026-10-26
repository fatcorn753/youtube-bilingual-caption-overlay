'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadYco } = require('./helpers');

const { text: T } = loadYco();

/** 文の終わりの位置で切って、文のリストにする */
function splitSentences(text, language) {
  const sentences = [];
  let start = 0;
  for (const end of T.findSentenceEnds(text, language)) {
    sentences.push(text.slice(start, end).trim());
    start = end;
  }
  return sentences;
}

test('joinText: 英語は空白で、日本語は空白なしでつなぐ', () => {
  assert.equal(T.joinText('Hello', 'world'), 'Hello world');
  assert.equal(T.joinText('こんにちは', '世界'), 'こんにちは世界');
  assert.equal(T.joinText('English 日本', '語'), 'English 日本語');
  assert.equal(T.joinText('日本語', 'English'), '日本語English');
});

test('joinText: どちらかが空ならもう一方を返す', () => {
  assert.equal(T.joinText('', 'abc'), 'abc');
  assert.equal(T.joinText('abc', ''), 'abc');
  assert.equal(T.joinText('', ''), '');
});

test('joinLines: 折り返された行を 1 つにつなぐ', () => {
  assert.equal(T.joinLines(['the quick brown', 'fox jumps']), 'the quick brown fox jumps');
  assert.equal(T.joinLines(['ポッター。私は分かりません。そんなこと', 'は言わ']), 'ポッター。私は分かりません。そんなことは言わ');
  assert.equal(T.joinLines([]), '');
});

test('collapseWhitespace: 連続する空白と改行を 1 つにして、前後を削る', () => {
  assert.equal(T.collapseWhitespace('  a \n\n b\t c  '), 'a b c');
});

test('findSentenceEnds: 文末記号で区切る', () => {
  assert.deepEqual(splitSentences('Hello there. How are you? Fine!'), ['Hello there.', 'How are you?', 'Fine!']);
  assert.deepEqual(splitSentences('Really?! Yes.'), ['Really?!', 'Yes.']);
  assert.deepEqual(splitSentences('これは文です。次の文です。'), ['これは文です。', '次の文です。']);
});

test('findSentenceEnds: 文末記号の後ろの閉じ引用符・括弧は文に含める', () => {
  assert.deepEqual(splitSentences('He said "Hi." Then left.'), ['He said "Hi."', 'Then left.']);
});

test('findSentenceEnds: 数字や語の途中のピリオドでは区切らない', () => {
  assert.deepEqual(splitSentences('Pi is 3.14 roughly.'), ['Pi is 3.14 roughly.']);
});

test('findSentenceEnds: 敬称・略語・頭文字の後ろでは区切らない', () => {
  assert.deepEqual(splitSentences('Mr. Smith went home.'), ['Mr. Smith went home.']);
  assert.deepEqual(splitSentences('Dr. Jones met J. K. Rowling.'), ['Dr. Jones met J. K. Rowling.']);
  assert.deepEqual(splitSentences('Use fruit, e.g. apples.'), ['Use fruit, e.g. apples.']);
});

test('findSentenceEnds: "I." は文末になりうるので区切る', () => {
  assert.deepEqual(splitSentences('So do I. Yes.'), ['So do I.', 'Yes.']);
});

test('findSentenceEnds: 文末記号がなければ空', () => {
  assert.deepEqual(T.findSentenceEnds('no punctuation here'), []);
});

test('findSentenceEnds: 呼び出しごとに状態が残らない(g フラグの lastIndex)', () => {
  assert.deepEqual(T.findSentenceEnds('One. Two.'), [4, 9]);
  assert.deepEqual(T.findSentenceEnds('One. Two.'), [4, 9]);
});

test('KANA / isAscii', () => {
  assert.ok(T.KANA.test('こんにちは'));
  assert.ok(!T.KANA.test('Hello'));
  assert.ok(T.isAscii('Hello, world.'));
  assert.ok(!T.isAscii('Bonjour à tous'));
});

// ---- 言語ごとの区切り -------------------------------------------------------------

test('findSentenceEnds(de): 略語の後ろでは区切らない', () => {
  assert.deepEqual(splitSentences('Das ist z.B. ein Test. Dr. Müller kommt bzw. geht.', 'de'), [
    'Das ist z.B. ein Test.',
    'Dr. Müller kommt bzw. geht.',
  ]);
});

test('findSentenceEnds(de): 数字のあとのピリオド(序数)は、小文字の語や月名が続けば区切らない', () => {
  assert.deepEqual(splitSentences('Am 3. Mai war es kalt. Wir treffen uns am 12. Dezember wieder.', 'de'), [
    'Am 3. Mai war es kalt.',
    'Wir treffen uns am 12. Dezember wieder.',
  ]);
  assert.deepEqual(splitSentences('Das ist der 2. gute Tag.', 'de'), ['Das ist der 2. gute Tag.']);
});

test('findSentenceEnds(de): 数字で終わる文は、そこで区切る(大文字の語が続く・末尾)', () => {
  assert.deepEqual(splitSentences('Es sind 5. Dann gehen wir.', 'de'), ['Es sind 5.', 'Dann gehen wir.']);
  assert.deepEqual(splitSentences('Es sind 5.', 'de'), ['Es sind 5.']);
});

test('findSentenceEnds(en): 序数の規則は英語には適用しない', () => {
  assert.deepEqual(splitSentences('It costs 5. then it rises.', 'en'), ['It costs 5.', 'then it rises.']);
});

test('findSentenceEnds(es): 敬称の後ろでは区切らず、¿ ¡ を含む文も文末記号で区切る', () => {
  assert.deepEqual(splitSentences('El Sr. López llegó. ¡Hola! ¿Cómo estás? Bien.', 'es'), [
    'El Sr. López llegó.',
    '¡Hola!',
    '¿Cómo estás?',
    'Bien.',
  ]);
});

test('findSentenceEnds(fr): 敬称の後ろでは区切らず、記号の前の空白があっても区切る', () => {
  assert.deepEqual(splitSentences('Mme. Dupont arrive. Quoi ? Oui !', 'fr'), ['Mme. Dupont arrive.', 'Quoi ?', 'Oui !']);
});

test('findSentenceEnds: 言語ごとの略語は、他の言語の表には入らない', () => {
  assert.deepEqual(splitSentences('Siehe z.B. oben.', 'en'), ['Siehe z.B.', 'oben.']);
  assert.deepEqual(splitSentences('See Mme. Dupont.', 'en'), ['See Mme.', 'Dupont.']);
});

test('findSentenceEnds: 韓国語・中国語は、半角・全角の文末記号で区切る', () => {
  assert.deepEqual(splitSentences('안녕하세요. 잘 지내세요? 네!', 'ko'), ['안녕하세요.', '잘 지내세요?', '네!']);
  assert.deepEqual(splitSentences('你好。你好吗?我很好!', 'zh'), ['你好。', '你好吗?', '我很好!']);
  assert.deepEqual(splitSentences('你好。你好吗？我很好！', 'zh'), ['你好。', '你好吗？', '我很好！']);
});

test('findSentenceEnds: 表のない言語は、英語の表を使う', () => {
  assert.deepEqual(splitSentences('Mr. Smith left. Bye.', 'xx'), ['Mr. Smith left.', 'Bye.']);
});
