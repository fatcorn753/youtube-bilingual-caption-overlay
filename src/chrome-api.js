/**
 * `chrome.*` API を使う処理は、すべてこのファイルに集める。
 *
 * 拡張が再読み込み・更新されると、ページに残った古い content script から
 * `chrome.*` を呼ぶと "Extension context invalidated" の例外になる。
 * ここではその例外を握りつぶし、呼び出し側が壊れないようにしている。
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});

  /** 翻訳済みのメッセージ(_locales)。取得できなければキー名をそのまま返す */
  function t(key) {
    try {
      return chrome.i18n.getMessage(key) || key;
    } catch (_) {
      return key;
    }
  }

  /** 拡張のコンテキストがまだ有効か。再読み込み後の古い content script では false になる */
  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  /** chrome.storage.local から読む。失敗したら既定値を返す */
  async function storageGet(defaults) {
    try {
      return await chrome.storage.local.get(defaults);
    } catch (_) {
      return { ...defaults };
    }
  }

  /** chrome.storage.local へ書く(結果は待たない。失敗しても何もしない) */
  function storageSet(values) {
    try {
      chrome.storage.local.set(values).catch(() => {});
    } catch (_) {
      // 拡張のコンテキストが無効
    }
  }

  /**
   * 設定が(ポップアップや別のタブから)変わったときに、listener(changes) を呼ぶ。
   * changes は { キー: { newValue, oldValue } }
   */
  function onStorageChanged(listener) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') listener(changes);
      });
    } catch (_) {
      // 拡張のコンテキストが無効
    }
  }

  YCO.chromeApi = Object.freeze({ t, isContextValid, storageGet, storageSet, onStorageChanged });
})(globalThis);
