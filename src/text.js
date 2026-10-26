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
   *   - 半角の `! ?`      : 直後が全角の文字("你好吗?我很好")でも文の終わり。中国語・日本語の字幕には、
   *                        半角の記号を空白なしで使うものがある(`.` は数字の小数点などと区別できないので除く)
   * 注意: `g` フラグ付きの RegExp は lastIndex を持つので、使うたびに新しく作る
   */
  const SENTENCE_END_SOURCE =
    '[.!?…]+["\'”’)\\]]*(?=\\s|$)|[。！？]+[」』）"\'”’)\\]]*|[!?]+["\'”’)\\]]*(?=[\\u3000-\\u9fff\\uff00-\\uffef])';

  /**
   * ピリオドで終わっていても、文の終わりではない語(言語ごと)。ドットを含む語は、ドットも書く。
   * 文末にもなりうる語("etc." "usw." など)は入れない: 入れると、本当の文末を見逃す。
   * 載っていない言語は、英語の表を使う
   */
  const ABBREVIATIONS = Object.freeze({
    en: ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St', 'vs', 'No', 'Inc', 'Ltd', 'Co', 'e.g', 'i.e', 'U.S'],
    de: ['Dr', 'Prof', 'Hr', 'Fr', 'Nr', 'Str', 'Tel', 'bzw', 'ca', 'ggf', 'evtl', 'inkl', 'vgl', 'z.B', 'd.h', 'u.a', 'z.T', 'u.U', 'i.d.R', 'o.ä', 'v.a', 'z.Zt'],
    es: ['Sr', 'Sra', 'Srta', 'Dr', 'Dra', 'Lic', 'Ing', 'Prof', 'Ud', 'Uds', 'Vd', 'pág', 'núm', 'Av', 'Gral', 'EE.UU', 'p.ej', 'a.m', 'p.m'],
    fr: ['Mme', 'Mlle', 'Mmes', 'Dr', 'Pr', 'Me', 'St', 'Ste', 'Mgr', 'cf', 'env', 'av', 'apr', 'J.-C', 'c.-à-d', 'p.ex', 'n°', 'MM'],
  });

  /** 頭文字("J." など)。"I." は文末になりうるので除く */
  const INITIAL = '[A-HJ-Z]';

  const abbreviationPatterns = new Map();
  /** 言語の略語の表から、「直前の語が略語か」を調べる正規表現を作る(言語ごとに 1 度だけ) */
  function abbreviationPattern(language) {
    const key = language in ABBREVIATIONS ? language : 'en';
    if (!abbreviationPatterns.has(key)) {
      const words = ABBREVIATIONS[key].map((word) => word.replace(/[.\-]/g, '\\$&'));
      abbreviationPatterns.set(key, new RegExp(`(?:^|\\s)(?:${words.join('|')}|${INITIAL})\\.$`));
    }
    return abbreviationPatterns.get(key);
  }

  /**
   * ドイツ語は、数字のあとのピリオドが序数("am 3. Mai")を表す。
   * 数字+ピリオドの後ろが、小文字で始まる語か月名なら、文の終わりではない。
   * (「…ist 5.」のように、後ろに何もなければ文末)
   */
  const GERMAN_MONTH = 'Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember';
  const GERMAN_ORDINAL_BEFORE = /(?:^|\s)\d+\.$/;
  const GERMAN_ORDINAL_AFTER = new RegExp(`^\\s+(?:[a-zäöüß]|(?:${GERMAN_MONTH})\\b)`);

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
   * @param {string} text
   * @param {string} [language] 字幕の言語('en' など)。略語の表と、ドイツ語の序数の扱いを切り替える
   */
  function findSentenceEnds(text, language = 'en') {
    const pattern = new RegExp(SENTENCE_END_SOURCE, 'g');
    const abbreviation = abbreviationPattern(language);
    const ends = [];
    let match;
    while ((match = pattern.exec(text))) {
      const end = match.index + match[0].length;
      if (match[0] === '.') {
        const before = text.slice(0, end);
        if (abbreviation.test(before)) continue;
        if (language === 'de' && GERMAN_ORDINAL_BEFORE.test(before) && GERMAN_ORDINAL_AFTER.test(text.slice(end))) continue;
      }
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
