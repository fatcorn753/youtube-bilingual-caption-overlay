/**
 * テキスト処理(ブラウザに依存しない純粋な関数)。
 *
 * 字幕の連結と、文の区切りの判定だけを扱う。単体テストは test/text.test.js。
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});

  /** 日本語・中国語などの全角文字(とその句読点) */
  const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

  /** ひらがな・カタカナ。あれば日本語とみなす */
  const KANA = /[\u3040-\u30ff]/;

  /**
   * 文末記号と、その後ろの閉じ引用符・括弧。次の 2 通りがある。
   *   - 半角の `. ! ? …`: 直後が空白か末尾のものだけを文の終わりとみなす
   *                        ("3.14" や "e.g" の途中では区切らない)
   *   - 全角の `。 ! ?`   : 日本語は句点の直後に空白を置かないので、後ろに何が続いても文の終わり
   * 注意: `g` フラグ付きの RegExp は lastIndex を持つので、使うたびに新しく作る
   */
  const SENTENCE_END_SOURCE =
    '[.!?…]+["\'”’)\\]]*(?=\\s|$)|[。！？]+[」』）"\'”’)\\]]*';

  /**
   * ピリオドで終わっていても、文の終わりではない語。
   * 敬称・略語・頭文字("J." など)。"I." は文末になりうるので頭文字から除く
   */
  const ABBREVIATION = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|No|Inc|Ltd|Co|e\.g|i\.e|U\.S|[A-HJ-Z])\.$/;

  /** 連続する空白(改行を含む)を 1 つの半角スペースにし、前後を削る */
  function collapseWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  /** 2 つの断片をつなぐときの区切り。CJK が絡むときは空白を入れない */
  function separatorFor(a, b) {
    return CJK.test(a.slice(-1)) || CJK.test(b[0]) ? '' : ' ';
  }

  /** 2 つの断片を、自然な区切りでつなぐ。どちらかが空ならもう一方を返す */
  function joinText(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a + separatorFor(a, b) + b;
  }

  /** 折り返された字幕の各行を、1 つの文字列につなぐ */
  function joinLines(lines) {
    return lines.reduce(joinText, '');
  }

  /**
   * 文の終わりの位置(その文の直後のインデックス)を、先頭から順に返す。
   * 略語の後ろのピリオドは除く。
   */
  function findSentenceEnds(text) {
    const pattern = new RegExp(SENTENCE_END_SOURCE, 'g');
    const ends = [];
    let match;
    while ((match = pattern.exec(text))) {
      const end = match.index + match[0].length;
      if (match[0] === '.' && ABBREVIATION.test(text.slice(0, end))) continue;
      ends.push(end);
    }
    return ends;
  }

  const isAscii = (text) => /^[\x00-\x7F]+$/.test(text);

  YCO.text = Object.freeze({
    CJK,
    KANA,
    collapseWhitespace,
    separatorFor,
    joinText,
    joinLines,
    findSentenceEnds,
    isAscii,
  });
})(globalThis);
