/**
 * YouTube のページとのやり取りをすべてここに集める。
 *
 * YouTube の DOM が変わって動かなくなったときは、まずこのファイルの
 * セレクタ(SELECTORS)を見直す。
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});
  const { constants, text: T } = YCO;

  const SELECTORS = Object.freeze({
    player: '#movie_player',
    captionContainer: '.ytp-caption-window-container',
    captionWindow: '.ytp-caption-window-container .caption-window',
    captionLine: '.caption-visual-line',
    captionSegment: '.ytp-caption-segment',
    ccButton: '.ytp-subtitles-button',
    rightControls: '.ytp-right-controls',
  });

  /** src/page-bridge.js(MAIN world)と通信するイベント名。両方を揃えること */
  const BRIDGE_REQUEST = 'yco:caption-request';
  const BRIDGE_RESPONSE = 'yco:caption-response';
  const BRIDGE_TIMEOUT_MS = 1500;

  /** 自動生成字幕のウィンドウに付く class。手動字幕にはない */
  const ROLLUP_CLASS = 'ytp-caption-window-rollup';

  /**
   * 「○○をクリックして設定」という UI ヒントが、字幕と同じ場所に出る。
   * ヒントは id が caption-window-_<数字> で、画面の上寄せ(ytp-caption-window-top)になる。
   * id だけでは見分けられない: 手動字幕も caption-window-_<数字> の id を持つ(実際の YouTube で確認)。
   * 手動字幕は下寄せなので、「id が _ で始まる、かつ上寄せ」をヒントとみなす
   */
  const UI_HINT_ID_PREFIX = 'caption-window-_';
  const TOP_CLASS = 'ytp-caption-window-top';
  /**
   * ヒントの文言(「日本語 (自動生成) をクリックして設定」など)に含まれる語。
   * 位置と id だけで除外すると、上寄せの手動字幕まで巻き込んで、字幕が 1 つも出なくなる。
   * 字幕を捨てる誤りのほうが、ヒントが 1 行混ざる誤りより重いので、文言でも確かめて、確実なものだけ除外する
   */
  const UI_HINT_TEXT = /クリック|click|clic|klick|cliqu|clicca|설정|点击|點擊|нажм/i;
  const isUiHint = (win) =>
    win.id.startsWith(UI_HINT_ID_PREFIX) &&
    win.classList.contains(TOP_CLASS) &&
    UI_HINT_TEXT.test(win.textContent ?? '');

  const getPlayer = () => document.querySelector(SELECTORS.player);
  const getCcButton = () => getPlayer()?.querySelector(SELECTORS.ccButton) ?? null;

  /** プレイヤーの CC ボタンが押せる状態か(字幕のない動画では隠れる) */
  function isCcAvailable() {
    const button = getCcButton();
    return !!button && button.offsetParent !== null;
  }

  // ---- 字幕の読み取り -----------------------------------------------------

  /**
   * いま画面に出ている字幕を読む。
   * @returns {{text: string, rollup: boolean}}
   *   text  : 字幕(ウィンドウが複数あれば改行でつなぐ)。何も出ていなければ空文字
   *   rollup: 自動生成字幕(ロールアップ表示)か
   */
  function readCaptions() {
    const player = getPlayer();
    if (!player) return { text: '', rollup: false };

    const blocks = [];
    let rollup = false;
    for (const win of player.querySelectorAll(SELECTORS.captionWindow)) {
      if (isUiHint(win)) continue;
      if (win.classList.contains(ROLLUP_CLASS)) rollup = true;

      // YouTube はプレイヤー幅に合わせて字幕を折り返す。小窓では不要なので 1 つにつなぐ
      const lineNodes = win.querySelectorAll(SELECTORS.captionLine);
      const nodes = lineNodes.length ? lineNodes : win.querySelectorAll(SELECTORS.captionSegment);
      const lines = [...nodes].map((node) => T.collapseWhitespace(node.textContent)).filter(Boolean);
      if (lines.length) blocks.push(T.joinLines(lines));
    }
    return { text: blocks.join('\n'), rollup };
  }

  /**
   * 字幕の変化を監視する。変化があるたびに `onChange` を呼ぶ。
   * MutationObserver のコールバックは背景タブでも間引かれない
   * (requestAnimationFrame や setTimeout は間引かれるので使わない)。
   * @returns {() => void} 監視をやめる関数
   */
  function watchCaptions(onChange) {
    const player = getPlayer();
    if (!player) return () => {};

    const isCaptionMutation = (mutation) => {
      const node = mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target;
      return !!node?.closest?.(SELECTORS.captionContainer);
    };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some(isCaptionMutation)) onChange();
    });
    observer.observe(player, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }

  // ---- 字幕のトラック(言語)の切り替え -------------------------------------

  /**
   * ページ側のブリッジに要求を送り、応答を待つ。応答がなければ null(ブリッジがない・ページが重い)。
   * 中身は JSON 文字列で渡す(world をまたぐと、オブジェクトが渡らないことがある)
   */
  function callBridge(payload) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const finish = (value) => {
        clearTimeout(timer);
        document.removeEventListener(BRIDGE_RESPONSE, onResponse);
        resolve(value);
      };
      const onResponse = (event) => {
        let message;
        try {
          message = JSON.parse(event.detail);
        } catch (_) {
          return;
        }
        if (message.id === id) finish(message);
      };
      const timer = setTimeout(() => finish(null), BRIDGE_TIMEOUT_MS);
      document.addEventListener(BRIDGE_RESPONSE, onResponse);
      document.dispatchEvent(new CustomEvent(BRIDGE_REQUEST, { detail: JSON.stringify({ id, ...payload }) }));
    });
  }

  /**
   * 字幕を指定の言語に切り替える。
   * @returns {Promise<{changed: boolean, previous?: object|null}|null>} 切り替えられなければ null
   */
  async function preferCaptionLanguage(languageCode) {
    const response = await callBridge({ action: 'prefer', languageCode });
    return response?.ok ? response : null;
  }

  /** preferCaptionLanguage() で切り替える前のトラックに戻す */
  function restoreCaptionTrack(track) {
    return callBridge({ action: 'restore', track });
  }

  // ---- CC(字幕)ボタンと、元の字幕の表示 ---------------------------------

  /**
   * 小窓を開いている間だけ CC をオンにし、閉じたら元に戻す。
   * 利用者がもともとオンにしていた場合は、閉じても触らない。
   */
  class CcSwitch {
    #enabledByUs = false;

    ensureOn() {
      const button = getCcButton();
      if (button && button.offsetParent !== null && button.getAttribute('aria-pressed') === 'false') {
        button.click();
        this.#enabledByUs = true;
      }
    }

    restore() {
      if (!this.#enabledByUs) return;
      this.#enabledByUs = false;
      const button = getCcButton();
      if (button && button.getAttribute('aria-pressed') === 'true') button.click();
    }
  }

  /**
   * 元の字幕を隠す(小窓と二重に見えないように)。
   * `display: none` にすると YouTube が字幕の DOM を更新しなくなるので、透明にするだけにする
   */
  function setNativeCaptionsHidden(hidden, owner) {
    const id = constants.DOM_IDS.hideNativeStyle;
    const existing = document.getElementById(id);
    if (!hidden) {
      // 他の世代が置いた style は消さない(再読み込み直後に、古い世代の後片付けが新しい世代を壊さないように)
      if (existing?.dataset.owner === owner) existing.remove();
      return;
    }
    if (existing) {
      existing.dataset.owner = owner; // 古い世代の style が残っていたら、持ち主を引き継ぐ
      return;
    }
    const style = document.createElement('style');
    style.id = id;
    style.dataset.owner = owner;
    style.textContent = `${SELECTORS.player} ${SELECTORS.captionContainer}{opacity:0!important;pointer-events:none!important}`;
    document.head.appendChild(style);
  }

  // ---- プレイヤーに置くボタン ---------------------------------------------

  /** YouTube は Trusted Types を強制するため、innerHTML を使わず DOM API で組み立てる */
  function createButtonIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [name, value] of Object.entries({
      viewBox: '0 0 24 24',
      width: '24',
      height: '24',
      fill: 'currentColor',
      'aria-hidden': 'true',
    })) {
      svg.setAttribute(name, value);
    }
    const add = (tag, attributes) => {
      const element = document.createElementNS(NS, tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      svg.appendChild(element);
    };
    add('path', { d: 'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H5V6h14v12z' });
    add('rect', { x: 7, y: 10, width: 10, height: 2, rx: 1 });
    add('rect', { x: 9, y: 14, width: 6, height: 2, rx: 1 });
    return svg;
  }

  /**
   * プレイヤー右下(CC ボタンの左)に、小窓を開くボタンを置く。すでにあれば何もしない。
   * YouTube は画面遷移でコントロールを作り直すので、定期的に呼んで補う。
   */
  function ensureButton({ owner, title, onClick }) {
    if (document.getElementById(constants.DOM_IDS.button)) return;
    const controls = getPlayer()?.querySelector(SELECTORS.rightControls);
    if (!controls) return;

    const button = document.createElement('button');
    button.id = constants.DOM_IDS.button;
    button.dataset.owner = owner;
    button.className = 'ytp-button';
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;color:#fff';
    button.appendChild(createButtonIcon());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });

    const cc = controls.querySelector(SELECTORS.ccButton);
    if (cc?.parentElement) cc.parentElement.insertBefore(button, cc);
    else controls.prepend(button);
  }

  /** ボタンの見た目を、小窓が開いているかどうかに合わせる */
  function setButtonPressed(pressed) {
    const button = document.getElementById(constants.DOM_IDS.button);
    if (!button) return;
    button.setAttribute('aria-pressed', String(pressed));
    button.style.opacity = pressed ? '1' : '0.75';
  }

  /**
   * 拡張の再読み込み後、古い世代が残したボタンと style を消す。
   * @param {string|null} owner null なら持ち主を問わず消す。指定すれば、その持ち主のものだけ消す
   */
  function removeInjectedElements(owner = null) {
    for (const id of [constants.DOM_IDS.button, constants.DOM_IDS.hideNativeStyle]) {
      const element = document.getElementById(id);
      if (element && (owner === null || element.dataset.owner === owner)) element.remove();
    }
  }

  YCO.youtube = Object.freeze({
    isCcAvailable,
    readCaptions,
    watchCaptions,
    CcSwitch,
    preferCaptionLanguage,
    restoreCaptionTrack,
    setNativeCaptionsHidden,
    ensureButton,
    setButtonPressed,
    removeInjectedElements,
  });
})(globalThis);
