/**
 * エントリポイント。各モジュールをつなぎ、拡張の一生(起動・小窓の開閉・後片付け)を管理する。
 *
 * データの流れ:
 *
 *   YouTube の字幕 ──(youtube.js)──> CaptionHistory ──(1 文ごと)──> Overlay(履歴に追加)
 *                                                          └────> TranslationService ──> Overlay(訳を追加)
 *
 * 読み込み順は manifest.json の content_scripts.js に書いてある。
 */
(function (root) {
  'use strict';

  const YCO = root.YCO;
  const { constants, chromeApi, settingsStore, youtube, CaptionHistory, Overlay, createTranslationService } = YCO;
  const { t } = chromeApi;

  /** この content script の世代 ID。拡張が再読み込みされると、古い世代は自分で退場する */
  const INSTANCE = Math.random().toString(36).slice(2);
  const INSTANCE_ATTRIBUTE = 'ycoInstance';
  /** ページ上のボタンが残っているか確かめる間隔(YouTube は画面遷移でコントロールを作り直す) */
  const BUTTON_CHECK_MS = 1500;
  /** 動画が替わったあと、字幕の DOM が作り直されるのを待つ時間 */
  const NAVIGATION_SETTLE_MS = 1200;
  const WATCHDOG_INTERVAL_MS = 5000;

  let settings = { ...constants.DEFAULT_SETTINGS };
  let overlay = null;
  /** 翻訳の状態メッセージ。小窓を作る前に通知されることがあるので、覚えておく */
  let statusMessage = '';
  let stopWatchingCaptions = null;
  let stallTimer = null;
  let renderScheduled = false;
  /** 前回描画したときの字幕。同じなら描画しない */
  let lastRenderKey = null;
  /** 確定した文の翻訳は、1 件ずつ順番に処理する */
  let translationQueue = Promise.resolve();
  /** 翻訳に失敗した行を、あとでやり直すためのタイマー */
  let retryTimer = null;
  /** 動画の切替中か。古い動画の字幕が DOM に残っている間は、字幕を読まない */
  let navigating = false;
  let navigationTimer = null;
  /** 字幕の準備(CC をオンにする・言語を英語にする)を、準備ができるまで繰り返す */
  let prepareTimer = null;
  /** 字幕の言語を切り替えたときの、切り替える前のトラック(閉じるときに戻す) */
  let originalTrack = null;
  /** 字幕を読めているかの見張り */
  let watchdogTimer = null;
  let playingSeconds = 0;
  let captionsUnreadable = false;

  const ccSwitch = new youtube.CcSwitch();
  const history = new CaptionHistory({ onCommit: onLineCommitted });
  const translator = createTranslationService({
    t,
    onStatus: setStatus,
    cacheMax: constants.LIMITS.cacheMax,
    retryMs: constants.TIMING.translatorRetryMs,
  });

  // ---- 字幕 → 履歴 → 翻訳 -------------------------------------------------

  function setStatus(message) {
    statusMessage = message;
    overlay?.setStatus(message);
  }

  /** 1 文が確定した: 履歴に足し、日本語訳をつける */
  function onLineCommitted(line) {
    if (!overlay) return;
    const slot = overlay.appendLine(line);
    if (settings.showJa) enqueueTranslation(slot, line);
  }

  function enqueueTranslation(slot, line) {
    translationQueue = translationQueue
      .then(async () => {
        if (!overlay || !slot.isConnected || !settings.showJa) return;
        const translation = await translator.translate(line);
        if (translation === null) {
          scheduleTranslationRetry();
          return;
        }
        overlay?.setTranslation(slot, translation);
        // 翻訳が回復した: 失敗して訳が抜けていた行を、いまのうちに埋める
        if (retryTimer) retryUntranslated();
      })
      .catch(() => {});
  }

  /** 訳のない行を、もう一度訳す */
  function retryUntranslated() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!overlay || !settings.showJa) return;
    for (const { slot, text } of overlay.untranslatedLines()) enqueueTranslation(slot, text);
  }

  /** 翻訳に失敗した行は、しばらくしてからやり直す(翻訳側の再試行の猶予が過ぎたころ) */
  function scheduleTranslationRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(retryUntranslated, constants.TIMING.translatorRetryMs + 1000);
  }

  /** 字幕が変わったことを知らせる。マイクロタスクにまとめて描画する */
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    // requestAnimationFrame は背景タブで止まるので使わない。この拡張は「別のタブに移っても更新し続ける」ことが目的
    queueMicrotask(render);
  }

  function render() {
    renderScheduled = false;
    if (!overlay || navigating) return;

    const { text, rollup } = youtube.readCaptions();
    const renderKey = text ? `text:${text}` : `none:${youtube.isCcAvailable()}:${overlay.lineCount}`;
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;

    history.update(text, { rollup });
    showPending();
    scheduleStall();
  }

  /** 未確定の文(いまの 1 行)を出す。何もなければ案内を出す */
  function showPending() {
    const hasAnything = history.visible || overlay.lineCount;
    const placeholder = hasAnything && !captionsUnreadable ? '' : emptyPlaceholder();
    overlay.setPending(history.pending, placeholder);
  }

  /** 字幕がまだ 1 つもないときの案内 */
  function emptyPlaceholder() {
    if (captionsUnreadable) return t('captionsUnreadable');
    return youtube.isCcAvailable() ? t('waiting') : t('noCaptions');
  }

  /**
   * 字幕の DOM に文字があるのに読めない状態(または字幕の入れ物がない状態)が続いたら、読み取れていないと知らせる。
   * YouTube の構造が変わったときに、利用者が「字幕のない動画」と「拡張の不具合」を区別できるようにする。
   * 字幕が出ていないだけの間(無音・間奏・字幕のない区間)は、不具合とみなさない
   */
  function checkCaptionsReadable() {
    if (!overlay || navigating) return;
    const state = youtube.diagnoseCaptions();
    const suspicious = state === 'unreadable' || state === 'no-container';
    const counting =
      suspicious && youtube.isCcAvailable() && youtube.isVideoPlaying() && !youtube.isAdShowing();
    if (!counting) {
      playingSeconds = 0;
      if (captionsUnreadable) {
        captionsUnreadable = false;
        showPending();
      }
      return;
    }
    playingSeconds += WATCHDOG_INTERVAL_MS / 1000;
    if (!captionsUnreadable && playingSeconds >= constants.TIMING.unreadableAfterPlayingSeconds) {
      captionsUnreadable = true;
      console.warn(`[Caption Overlay] 字幕を読み取れません(状態: ${state})。YouTube の構造が変わった可能性があります。`);
      showPending();
    }
  }

  /** 話が止まったら、未確定の文を確定する */
  function scheduleStall() {
    clearTimeout(stallTimer);
    if (!history.pending) return;
    stallTimer = setTimeout(() => {
      if (!overlay) return;
      history.commitPending();
      showPending();
    }, history.stallDelayMs);
  }

  /** 履歴を空にする(動画が替わったとき)。字幕の読み直しは、DOM が落ち着いてから行う */
  function resetHistory() {
    clearTimeout(stallTimer);
    clearTimeout(retryTimer);
    retryTimer = null;
    history.reset();
    translator.resetLanguage(); // 前の動画の言語を引きずらない
    overlay?.clearLines();
    lastRenderKey = null;
    playingSeconds = 0;
    captionsUnreadable = false;
  }

  // ---- 小窓の開閉 ---------------------------------------------------------

  /** JA ボタンをオンに戻した: 翻訳の準備をやり直し、訳のなかった行を訳す */
  function retryTranslation() {
    translator.retry();
    for (const { slot, text } of overlay?.untranslatedLines() ?? []) enqueueTranslation(slot, text);
  }

  /** 小窓のボタン操作 */
  function handleAction(action) {
    const { min, max, step } = constants.FONT_SIZE;
    if (action === 'sizeDown') settings.fontSize = Math.max(min, settings.fontSize - step);
    if (action === 'sizeUp') settings.fontSize = Math.min(max, settings.fontSize + step);
    if (action === 'toggleTheme') settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    if (action === 'toggleJa') settings.showJa = !settings.showJa;

    settingsStore.save(settings);
    overlay?.applySettings(settings);
    if (action === 'toggleJa') {
      if (settings.showJa) retryTranslation();
      else setStatus('');
    }
  }

  async function openOverlay() {
    if (!('documentPictureInPicture' in window)) {
      alert(t('unsupported'));
      return;
    }
    if (overlay) {
      overlay.close();
      return;
    }

    let pipWindow;
    try {
      const pending = window.documentPictureInPicture.requestWindow(constants.PIP_SIZE);
      // クリックの直後(ユーザー操作が有効なうち)に、最も多い英語→日本語のモデルを用意しておく
      if (settings.showJa) {
        translator.begin();
        translator.prewarmAll();
      } else {
        statusMessage = '';
      }
      pipWindow = await pending;
    } catch (error) {
      console.warn('[Caption Overlay] 小窓を開けませんでした:', error);
      return;
    }

    history.reset();
    lastRenderKey = null;
    navigating = false;
    playingSeconds = 0;
    captionsUnreadable = false;
    overlay = new Overlay(pipWindow, {
      t,
      historyMax: constants.LIMITS.historyMax,
      onAction: handleAction,
    });
    overlay.applySettings(settings);
    overlay.setStatus(statusMessage);
    overlay.onClosed(closeOverlay);

    youtube.setNativeCaptionsHidden(true, INSTANCE);
    prepareCaptions();
    stopWatchingCaptions = youtube.watchCaptions(scheduleRender);
    watchdogTimer = setInterval(checkCaptionsReadable, WATCHDOG_INTERVAL_MS);
    render();
    youtube.setButtonPressed(true);
  }

  function closeOverlay() {
    if (!overlay) return;
    const closing = overlay;
    overlay = null;
    navigating = false;
    clearTimeout(stallTimer);
    clearTimeout(retryTimer);
    clearTimeout(navigationTimer);
    clearInterval(watchdogTimer);
    clearInterval(prepareTimer);
    retryTimer = null;
    stopWatchingCaptions?.();
    stopWatchingCaptions = null;
    youtube.setNativeCaptionsHidden(false, INSTANCE);
    if (originalTrack) youtube.restoreCaptionTrack(originalTrack);
    originalTrack = null;
    ccSwitch.restore();
    closing.close();
    youtube.setButtonPressed(false);
  }

  /**
   * 字幕の準備をする: CC をオンにし、字幕を英語に切り替える。
   * 動画が替わった直後は、プレイヤーの準備がまだで、CC ボタンも出ていない。
   * 1 度きりだと取りこぼすので、準備ができるまで繰り返す
   * (これがないと、次の動画へ進むたびに、小窓を開き直すことになる)
   */
  function prepareCaptions() {
    clearInterval(prepareTimer);
    const startedAt = Date.now();
    const attempt = async () => {
      if (!overlay) {
        clearInterval(prepareTimer);
        return;
      }
      if (!youtube.isCcAvailable()) {
        if (Date.now() - startedAt > constants.TIMING.captionsReadyTimeoutMs) clearInterval(prepareTimer);
        return;
      }
      clearInterval(prepareTimer);
      ccSwitch.ensureOn();
      const result = await youtube.preferCaptionLanguage(constants.CAPTION_LANG);
      if (!result?.changed) return;
      if (overlay) originalTrack = result.previous ?? null;
      else if (result.previous) youtube.restoreCaptionTrack(result.previous); // 待っている間に閉じられた
    };
    prepareTimer = setInterval(attempt, constants.TIMING.captionsReadyPollMs);
    attempt();
  }

  // ---- ページとの連携・後片付け ------------------------------------------

  /** この世代がまだ有効か。拡張が再読み込みされたら、新しい世代に取って代わられる */
  function isCurrentInstance() {
    return chromeApi.isContextValid() && document.documentElement.dataset[INSTANCE_ATTRIBUTE] === INSTANCE;
  }

  function mountButton() {
    youtube.ensureButton({
      owner: INSTANCE,
      title: t('buttonTitle'),
      onClick: () => (isCurrentInstance() ? openOverlay() : shutdown()),
    });
    youtube.setButtonPressed(!!overlay);
  }

  /** 動画が切り替わった(YouTube は画面遷移してもページを読み込み直さない) */
  function onNavigate() {
    if (!isCurrentInstance()) return shutdown();
    mountButton();
    if (!overlay) return;
    // 別の動画の字幕が混ざらないよう、履歴は動画ごとに消す。
    // 切替の直後は、前の動画の字幕が DOM に残っているので、落ち着くまで読まない
    navigating = true;
    originalTrack = null; // 前の動画のトラックは、新しい動画では意味がない
    clearInterval(prepareTimer);
    resetHistory();
    // 小窓は開いたまま、新しい動画の字幕へ追従する
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => {
      if (!overlay) return;
      navigating = false;
      prepareCaptions();
      stopWatchingCaptions?.();
      stopWatchingCaptions = youtube.watchCaptions(scheduleRender);
      lastRenderKey = null;
      render();
    }, NAVIGATION_SETTLE_MS);
  }

  /** 世代が古くなった(拡張が再読み込みされた等)ら、自分が作ったものだけ片付けて止まる */
  function shutdown() {
    clearInterval(buttonTimer);
    window.removeEventListener('yt-navigate-finish', onNavigate);
    window.removeEventListener('pagehide', closeOverlay);
    closeOverlay();
    youtube.removeInjectedElements(INSTANCE);
  }

  // ---- 起動 ---------------------------------------------------------------

  // 古い世代が残したボタンは、押しても動かないので消す
  youtube.removeInjectedElements();
  document.documentElement.dataset[INSTANCE_ATTRIBUTE] = INSTANCE;

  settingsStore.load().then((loaded) => {
    settings = loaded;
    overlay?.applySettings(settings);
  });

  mountButton();
  const buttonTimer = setInterval(() => (isCurrentInstance() ? mountButton() : shutdown()), BUTTON_CHECK_MS);
  window.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('pagehide', closeOverlay);
})(globalThis);
