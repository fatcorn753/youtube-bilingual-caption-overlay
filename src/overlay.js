/**
 * 小窓(Document Picture-in-Picture)の中身。
 *
 * ここは「表示」だけを担当する。何を表示するか(字幕を文に区切る・翻訳する)は知らない。
 * 見た目を変えたいときは、STYLE(CSS)を編集する。
 *
 * 画面の構造:
 *   #stage
 *     #text            履歴(スクロールする)
 *       .entry.h       確定した 1 文: .en(英語) と .ja(日本語訳)
 *       .entry.live    未確定の文(いまの 1 行): .en だけ
 *     #status          翻訳の状態メッセージ(準備中・失敗理由)
 *   #ctl               右上のボタン(カーソルを乗せると現れる)
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});
  const { constants } = YCO;

  /** 一番下からこの距離(px)以内なら「一番下を見ている」とみなし、新しい行に追従する */
  const STICK_TO_BOTTOM_PX = 40;

  const STYLE = `
    html, body { margin: 0; height: 100%; overflow: hidden; }
    body {
      display: flex; align-items: flex-start; justify-content: center;
      font-family: system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif;
    }
    #stage {
      box-sizing: border-box; width: 100%; height: 100%;
      display: flex; flex-direction: column; padding: 12px 20px;
    }
    #text {
      flex: 1; min-height: 0; overflow-y: auto; overflow-anchor: none; scrollbar-width: thin;
      text-align: center; font-weight: 600; line-height: 1.45; white-space: pre-line;
      overflow-wrap: anywhere; user-select: text;
      font-size: var(--fs); text-shadow: var(--shadow);
    }
    .entry { margin-bottom: .55em; }
    .entry .ja { font-size: var(--jafs); color: var(--ja); margin-top: .15em; }
    .entry .ja:empty, body.nojp .ja { display: none; }
    #text .h:not(.latest) { opacity: .55; }
    #status { flex: none; margin-top: .4em; text-align: center; font-size: 13px; font-style: italic; opacity: .65; }
    #status:empty { display: none; }
    #ctl { position: fixed; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
    body:hover #ctl, #ctl:focus-within { opacity: 1; }
    #ctl button {
      min-width: 30px; height: 26px; border: 1px solid rgba(128,128,128,.6); border-radius: 6px;
      background: rgba(128,128,128,.35); color: inherit; font: 600 13px system-ui, sans-serif; cursor: pointer;
    }
    #ctl button:hover { background: rgba(128,128,128,.6); }
    #ctl button[aria-pressed=false] { opacity: .5; }
  `;

  class Overlay {
    #window;
    #document;
    #t;
    #historyMax;
    #textElement;
    #statusElement;
    #jaButton;
    #liveElement;
    #liveTextElement;
    /** 一番新しい行(ここだけ濃く表示する) */
    #latestElement = null;
    #lineCount = 0;

    /**
     * @param {Window} win Document Picture-in-Picture の window
     * @param {object} options
     * @param {(key: string) => string} options.t
     * @param {number} options.historyMax 残す最大行数
     * @param {(action: 'sizeDown'|'sizeUp'|'toggleJa'|'toggleTheme') => void} options.onAction ボタン操作
     */
    constructor(win, { t, historyMax, onAction }) {
      this.#window = win;
      this.#document = win.document;
      this.#t = t;
      this.#historyMax = historyMax;
      this.#buildDocument(onAction);
      this.#resetLiveEntry();
    }

    /** 確定した行の数 */
    get lineCount() {
      return this.#lineCount;
    }

    /** 小窓が閉じられたときに呼ぶ関数を登録する */
    onClosed(callback) {
      this.#window.addEventListener('pagehide', callback);
    }

    close() {
      try {
        this.#window.close();
      } catch (_) {
        // すでに閉じている
      }
    }

    /** 設定(文字サイズ・テーマ・訳の表示・翻訳先)を見た目に反映する */
    applySettings(settings) {
      const theme = constants.THEMES[settings.theme] ?? constants.THEMES.dark;
      const root = this.#document.documentElement;
      root.style.background = theme.bg;
      this.#document.body.style.background = theme.bg;
      this.#document.body.style.color = theme.fg;
      root.style.setProperty('--fs', `${settings.fontSize}px`);
      root.style.setProperty('--jafs', `${Math.round(settings.fontSize * constants.JA_SCALE)}px`);
      root.style.setProperty('--ja', theme.ja);
      root.style.setProperty('--shadow', theme.shadow);
      this.#document.body.classList.toggle('nojp', !settings.showJa);
      this.#jaButton.setAttribute('aria-pressed', String(settings.showJa));
      this.#jaButton.textContent = settings.targetLang.toUpperCase(); // 翻訳先の言語コード
    }

    /** 確定した 1 文を、履歴の末尾に足す。訳を入れる欄(.ja)を返す */
    appendLine(text) {
      return this.#keepBottom(() => {
        const { entry, english, japanese } = this.#createEntry('entry h');
        english.textContent = text;
        this.#textElement.insertBefore(entry, this.#liveElement);
        this.#lineCount += 1;
        if (this.#lineCount > this.#historyMax) {
          this.#textElement.firstElementChild.remove();
          this.#lineCount -= 1;
        }
        return japanese;
      });
    }

    /**
     * 未確定の文(いまの 1 行)を表示する。
     * @param {string} text 未確定の文。空なら placeholder を薄く出す
     * @param {string} [placeholder] 字幕が何もないときに出す案内
     */
    setPending(text, placeholder = '') {
      this.#keepBottom(() => {
        const content = text || placeholder;
        this.#liveTextElement.textContent = content;
        this.#liveTextElement.style.opacity = text ? '1' : '0.45';
        this.#liveElement.style.display = content ? '' : 'none';
        this.#markLatest(text ? this.#liveElement : this.#liveElement.previousElementSibling);
      });
    }

    /** 行の下に訳を出す。その行がもう消えていれば何もしない */
    setTranslation(slot, text) {
      if (!slot?.isConnected) return;
      this.#keepBottom(() => {
        slot.textContent = text;
      });
    }

    /** 翻訳の状態メッセージ(準備中・失敗理由)を出す。空文字で消す */
    setStatus(text) {
      this.#statusElement.textContent = text;
    }

    /** 訳がまだ付いていない行(訳の表示をオンに戻したときや、翻訳先を変えたときに訳す) */
    untranslatedLines() {
      const lines = [];
      for (const entry of this.#textElement.querySelectorAll('.entry:not(.live)')) {
        const slot = entry.querySelector('.ja');
        if (slot && !slot.textContent) lines.push({ slot, text: entry.querySelector('.en').textContent });
      }
      return lines;
    }

    /** 出ている訳をすべて消す(翻訳先が変わったとき。行は残す) */
    clearTranslations() {
      for (const slot of this.#textElement.querySelectorAll('.entry .ja')) slot.textContent = '';
    }

    /** 履歴を空にする(動画が替わったとき) */
    clearLines() {
      this.#textElement.replaceChildren();
      this.#lineCount = 0;
      this.#latestElement = null;
      this.#resetLiveEntry();
    }

    // ---- 内部処理 -------------------------------------------------------

    #buildDocument(onAction) {
      const doc = this.#document;
      doc.title = this.#t('extName');
      const style = doc.createElement('style');
      style.textContent = STYLE;
      doc.head.appendChild(style);

      const stage = doc.createElement('div');
      stage.id = 'stage';
      this.#textElement = doc.createElement('div');
      this.#textElement.id = 'text';
      this.#statusElement = doc.createElement('div');
      this.#statusElement.id = 'status';
      stage.append(this.#textElement, this.#statusElement);
      doc.body.appendChild(stage);

      const controls = doc.createElement('div');
      controls.id = 'ctl';
      const addButton = (label, titleKey, action) => {
        const button = doc.createElement('button');
        button.textContent = label;
        button.title = this.#t(titleKey);
        button.setAttribute('aria-label', this.#t(titleKey));
        button.addEventListener('click', () => onAction(action));
        controls.appendChild(button);
        return button;
      };
      addButton('A−', 'sizeDown', 'sizeDown');
      addButton('A+', 'sizeUp', 'sizeUp');
      this.#jaButton = addButton('JA', 'toggleTranslation', 'toggleJa');
      addButton('◐', 'theme', 'toggleTheme');
      doc.body.appendChild(controls);
    }

    #createEntry(className) {
      const entry = this.#document.createElement('div');
      entry.className = className;
      const english = this.#document.createElement('div');
      english.className = 'en';
      const japanese = this.#document.createElement('div');
      japanese.className = 'ja';
      entry.append(english, japanese);
      return { entry, english, japanese };
    }

    #resetLiveEntry() {
      const { entry, english } = this.#createEntry('entry live');
      this.#liveElement = entry;
      this.#liveTextElement = english;
      this.#textElement.appendChild(entry);
    }

    /** 一番新しい行だけを濃く、それ以前は薄くする */
    #markLatest(target) {
      if (this.#latestElement === target) return;
      this.#latestElement?.classList.remove('latest');
      target?.classList.add('latest');
      this.#latestElement = target;
    }

    /** fn の前後で、一番下を見ていたなら一番下に追従し続ける(上を読んでいる間は動かさない) */
    #keepBottom(fn) {
      const el = this.#textElement;
      const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
      const result = fn();
      if (wasAtBottom) el.scrollTop = el.scrollHeight;
      return result;
    }
  }

  YCO.Overlay = Overlay;
})(globalThis);
