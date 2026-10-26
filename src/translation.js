/**
 * 翻訳サービス。Chrome 内蔵の Translator / LanguageDetector API(Chrome 138 以降)を使う。
 * 翻訳は端末内で完結し、字幕が外部へ送信されることはない。
 *
 * 使い方:
 *   const service = createTranslationService({ t, onStatus, ... });
 *   service.prewarm('en');             // ユーザー操作の直後に呼び、モデルを用意しておく
 *   const ja = await service.translate('Hello there.');
 *
 * `translate()` の戻り値:
 *   - 文字列 : 訳文。すでに翻訳先の言語なら空文字
 *   - null   : 翻訳できなかった(理由は `onStatus` で通知される)
 *
 * ブラウザの API は `env` から取る(既定は globalThis)ので、テストでは差し替えられる。
 * 単体テストは test/translation.test.js。
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});
  const { constants, text: T } = YCO;

  /**
   * promise が ms ミリ秒以内に決着しなければ、TimeoutError で失敗させる。
   * 翻訳 API は、応答しないまま待たされることがある(確認済み)。そのとき、待つ側を巻き込まない
   */
  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { name: 'TimeoutError' })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /** 例外を「エラー名: メッセージ」の短い 1 行にする */
  function describeError(error) {
    return `${error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 80)}`;
  }

  /**
   * @param {object} options
   * @param {(key: string) => string} options.t 翻訳済みメッセージの取得
   * @param {(message: string) => void} options.onStatus 状態メッセージの通知(空文字 = 表示を消す)
   * @param {object} [options.env] Translator / LanguageDetector を持つオブジェクト
   * @param {string} [options.targetLang]
   * @param {number} [options.cacheMax]
   * @param {number} [options.retryMs]
   * @param {{availabilityMs: number, createMs: number, translateMs: number}} [options.timeouts]
   * @param {() => number} [options.now]
   */
  function createTranslationService({
    t,
    onStatus,
    env = globalThis,
    targetLang = constants.TARGET_LANG,
    cacheMax = constants.LIMITS.cacheMax,
    retryMs = constants.TIMING.translatorRetryMs,
    timeouts = constants.TIMING.translatorTimeouts,
    now = Date.now,
  }) {
    /** 原語 → Promise<Translator | null> */
    const translators = new Map();
    /** 原語 → 準備に失敗した時刻。一定時間は再試行しない */
    const failedAt = new Map();
    /** 原文 → 訳文 */
    const cache = new Map();
    let detectorPromise = null;
    let lastLang = null;
    /** 一度でも訳が出たら、その後の一時的な失敗は表示しない */
    let hasTranslated = false;
    /**
     * モデルの取得に、ユーザー操作が要るのに得られなかった原語。
     * 字幕の途中で見つかった英語以外の言語は、クリックの直後に用意できない。
     * 次に小窓を開くクリックのときに、まとめて用意する
     */
    const needsGesture = new Set();

    /** 失敗などの理由を通知する。すでに訳が出ているときは邪魔しない */
    function reportStatus(message, detail) {
      if (detail) console.warn('[Caption Overlay]', message, detail);
      if (hasTranslated) return;
      onStatus(message);
    }

    // ---- 言語の判定 -----------------------------------------------------

    /** 字幕の言語コードを返す。判定できなければ null(理由は通知される) */
    async function detectLanguage(text) {
      if (T.KANA.test(text)) return 'ja';
      // 短い文は判定精度が低いので、直前に確定した言語を使う
      if (text.length < 12 && lastLang) return lastLang;
      try {
        if (env.LanguageDetector) {
          detectorPromise ??= withTimeout(env.LanguageDetector.create(), timeouts.createMs, 'LanguageDetector.create');
          const detector = await detectorPromise;
          const [top] = await withTimeout(detector.detect(text), timeouts.translateMs, 'LanguageDetector.detect');
          if (top && top.confidence >= 0.6) lastLang = top.detectedLanguage;
        }
      } catch (_) {
        detectorPromise = null;
      }
      if (lastLang) return lastLang;
      // 判定手段がなくても、ASCII だけの字幕は英語として扱う
      if (T.isAscii(text)) return 'en';
      reportStatus(t('statusNoLang'));
      return null;
    }

    // ---- 翻訳器の準備 ---------------------------------------------------

    /** 翻訳器を作る。使えない理由は `reportStatus` で通知し、null を返す */
    async function createTranslator(sourceLang) {
      if (!env.Translator) {
        reportStatus(t('statusNoApi'));
        return null;
      }
      const options = { sourceLanguage: sourceLang, targetLanguage: targetLang };

      let availability;
      try {
        availability = await withTimeout(env.Translator.availability(options), timeouts.availabilityMs, 'availability');
      } catch (error) {
        reportStatus(`${t('statusError')}${describeError(error)}`, error);
        return null;
      }
      if (availability === 'unavailable') {
        reportStatus(`${t('statusUnavailable')} (${sourceLang}→${targetLang})`);
        return null;
      }
      if (availability !== 'available') reportStatus(t('statusDownloading'));

      try {
        // モデルの初回ダウンロードにはユーザー操作が要る。ボタンを押した直後に呼んで満たす
        const created = env.Translator.create({
          ...options,
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', (event) => {
              reportStatus(`${t('statusDownloading')} ${Math.round(event.loaded * 100)}%`);
            });
          },
        });
        return await withTimeout(created, timeouts.createMs, 'create');
      } catch (error) {
        if (error?.name === 'NotAllowedError') {
          needsGesture.add(sourceLang);
          reportStatus(`${t('statusNeedsGesture')} (${sourceLang})`, error);
        } else {
          reportStatus(`${t('statusError')}${describeError(error)}`, error);
        }
        return null;
      }
    }

    /** 原語ごとの翻訳器を、1 度だけ作って使い回す。失敗したら一定時間は再試行しない */
    function getTranslator(sourceLang) {
      if (failedAt.has(sourceLang) && now() - failedAt.get(sourceLang) < retryMs) {
        return Promise.resolve(null);
      }
      if (!translators.has(sourceLang)) {
        const promise = createTranslator(sourceLang).then((translator) => {
          if (translator) {
            onStatus(''); // 準備できたら「準備中」などの表示を消す
          } else {
            translators.delete(sourceLang);
            failedAt.set(sourceLang, now());
          }
          return translator;
        });
        translators.set(sourceLang, promise);
      }
      return translators.get(sourceLang);
    }

    // ---- 翻訳 -----------------------------------------------------------

    async function translateUncached(text) {
      const sourceLang = await detectLanguage(text);
      if (!sourceLang) return null;
      if (sourceLang === targetLang) return ''; // すでに翻訳先の言語
      const translator = await getTranslator(sourceLang);
      if (!translator) return null;
      try {
        // 改行ごとに訳す(Translator は 1 回の呼び出しで改行を保つとは限らない)
        const lines = await Promise.all(
          text.split('\n').map((line) => withTimeout(translator.translate(line), timeouts.translateMs, 'translate')),
        );
        return lines.join('\n');
      } catch (error) {
        // 応答しない・壊れた翻訳器を使い回さない。次の翻訳で作り直す
        translators.delete(sourceLang);
        throw error;
      }
    }

    function remember(text, translation) {
      if (cache.size >= cacheMax) cache.delete(cache.keys().next().value);
      cache.set(text, translation);
    }

    /** 訳が出たことを記録する。以後の一時的な失敗表示を止め、「準備中」などを消す */
    function noteTranslated(translation) {
      if (!translation) return;
      hasTranslated = true;
      onStatus('');
    }

    /** 訳す。翻訳できなければ null。例外は投げない */
    async function translate(text) {
      const cached = cache.get(text);
      if (cached !== undefined) {
        noteTranslated(cached);
        return cached;
      }
      try {
        const translation = await translateUncached(text);
        if (translation === null) return null;
        remember(text, translation);
        noteTranslated(translation);
        return translation;
      } catch (error) {
        reportStatus(`${t('statusError')}${describeError(error)}`, error);
        return null;
      }
    }

    /** 翻訳器を先に用意する。ユーザー操作の直後(モデルのダウンロードが許される間)に呼ぶ */
    async function prewarm(sourceLang) {
      if (await getTranslator(sourceLang)) onStatus('');
    }

    /** 英語と、前回ユーザー操作が足りずに用意できなかった言語を、まとめて用意する(クリックの直後に呼ぶ) */
    async function prewarmAll() {
      await Promise.all(['en', ...needsGesture].map((lang) => prewarm(lang)));
    }

    /** 窓を開いたときの初期化。「準備中」を通知し、以後の失敗を表示できる状態に戻す */
    function begin() {
      hasTranslated = false;
      lastLang = null;
      onStatus(t('statusPreparing'));
    }

    /** 失敗の記録を捨てて、翻訳の準備からやり直す(JA ボタンを押したときなど) */
    function retry() {
      failedAt.clear();
      translators.clear();
      begin();
      prewarmAll();
    }

    /** 直前の言語判定を忘れる(別の動画に替わったとき。前の動画の言語を引きずらない) */
    function resetLanguage() {
      lastLang = null;
    }

    return { translate, prewarm, prewarmAll, begin, retry, resetLanguage };
  }

  YCO.createTranslationService = createTranslationService;
})(globalThis);
