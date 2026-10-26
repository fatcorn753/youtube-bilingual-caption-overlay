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
      showJa: true, // 日本語訳を表示するか
    }),

    FONT_SIZE: Object.freeze({ min: 14, max: 72, step: 4 }),

    /** 翻訳先の言語 */
    TARGET_LANG: 'ja',

    /**
     * 小窓を開いている間、YouTube の字幕をこの言語に切り替える(閉じたら元に戻す)。
     * 拡張は画面に出ている字幕をそのまま読むので、字幕が別の言語(自動翻訳など)だと、
     * 訳す元の文が取れない。その言語のトラックがない動画は、そのままにする
     */
    CAPTION_LANG: 'en',

    /** 日本語訳の文字サイズ = 英語の文字サイズ × この値 */
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
