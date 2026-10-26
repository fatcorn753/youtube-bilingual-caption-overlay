/**
 * 定数と既定値。
 *
 * 挙動を調整したいときは、まずこのファイルを見る。
 * (字幕を「文」に区切るタイミング、履歴の長さ、窓の大きさ、など)
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});

  YCO.constants = Object.freeze({
    /** 利用者が変えられる設定の既定値。chrome.storage.local に保存される */
    DEFAULT_SETTINGS: Object.freeze({
      fontSize: 28, // 英語の文字サイズ(px)。日本語訳はこの JA_SCALE 倍
      theme: 'dark', // 'dark' | 'light'
      showJa: true, // 訳を表示するか(保存済みの設定との互換のため、名前は showJa のまま)
      targetLang: 'ja', // 翻訳先の言語(LANGUAGES のコード)。ポップアップで選ぶ
      captionLang: 'en', // 字幕の言語。小窓を開いている間、YouTube の字幕をこの言語に切り替える(トラックがあれば)
    }),

    FONT_SIZE: Object.freeze({ min: 14, max: 72, step: 4 }),

    /**
     * 選べる言語。コードは Translator API の言語タグ。名前は、その言語自身の表記
     * (どの UI 言語でも読めるように、翻訳しない)
     */
    LANGUAGES: Object.freeze([
      Object.freeze({ code: 'ja', name: '日本語' }),
      Object.freeze({ code: 'en', name: 'English' }),
      Object.freeze({ code: 'zh', name: '中文(简体)' }),
      Object.freeze({ code: 'ko', name: '한국어' }),
      Object.freeze({ code: 'es', name: 'Español' }),
      Object.freeze({ code: 'fr', name: 'Français' }),
      Object.freeze({ code: 'de', name: 'Deutsch' }),
    ]),

    /** 訳の文字サイズ = 字幕の文字サイズ × この値 */
    JA_SCALE: 0.85,

    /** 小窓の配色。`ja` は日本語訳の色 */
    THEMES: Object.freeze({
      dark: Object.freeze({ bg: '#000', fg: '#fff', ja: '#ffe082', shadow: '0 0 4px #000, 0 0 2px #000' }),
      light: Object.freeze({ bg: '#fff', fg: '#111', ja: '#0b57d0', shadow: 'none' }),
    }),

    /** 字幕を 1 行(= 1 文)に区切るタイミング(ミリ秒) */
    TIMING: Object.freeze({
      /** 句読点のない字幕(自動生成): 話が止まってから、未確定の文を確定するまで */
      stallMs: 1500,
      /** 句読点のある字幕: 文末が来ないまま止まったときの保険 */
      longStallMs: 8000,
      /** 動画が替わったあと、字幕の準備ができるのを待つ上限(ミリ秒)と、確かめる間隔 */
      captionsReadyTimeoutMs: 20000,
      captionsReadyPollMs: 500,
      /** 翻訳の準備に失敗した後、自動で再試行するまでの間隔 */
      translatorRetryMs: 15000,
      /**
       * 翻訳 API の応答を待つ上限。応答しない呼び出しで、翻訳の列全体が止まらないようにする。
       * モデルのダウンロードは長くかかるので、create だけ長い
       */
      translatorTimeouts: Object.freeze({ availabilityMs: 8000, createMs: 180000, translateMs: 15000 }),
      /**
       * 字幕の DOM に文字があるのに読めない(または字幕の入れ物がない)状態のまま、
       * 動画がこの秒数だけ再生され続けたら、読み取れていないと知らせる。
       * 字幕が出ていないだけ(無音・間奏)の間は数えない
       */
      unreadableAfterPlayingSeconds: 20,
    }),

    LIMITS: Object.freeze({
      /** 文末が来ないまま、これより長くなったら途中でも区切る(文字数) */
      maxPending: 220,
      /** 句読点のない字幕では、もっと短く区切る(文字数) */
      maxPendingUnpunctuated: 120,
      /** 「行が繰り上がった」と判定するための、前の字幕との最小の重なり(文字数) */
      minOverlap: 8,
      /** 履歴に残す最大行数 */
      historyMax: 300,
      /** 翻訳結果のキャッシュ件数 */
      cacheMax: 500,
    }),

    /** 小窓(Document Picture-in-Picture)の初期サイズ */
    PIP_SIZE: Object.freeze({ width: 640, height: 300 }),

    /** ページに挿入する要素の id */
    DOM_IDS: Object.freeze({
      button: 'yco-button',
      hideNativeStyle: 'yco-hide-native',
    }),
  });
})(globalThis);
