/**
 * ツールバーのアイコンを押したときのポップアップ。設定を選び、chrome.storage.local に保存する。
 * 開いている YouTube のタブは、保存の変更を chrome.storage.onChanged で受け取って反映する
 * (このファイルは YouTube のタブとは通信しない)。
 */
(function (root) {
  'use strict';

  const { constants, chromeApi, settingsStore } = root.YCO;
  const { t } = chromeApi;

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }

  const captionSelect = document.getElementById('captionLang');
  const targetSelect = document.getElementById('targetLang');
  const statusElement = document.getElementById('pairStatus');
  for (const select of [captionSelect, targetSelect]) {
    for (const { code, name } of constants.LANGUAGES) select.add(new Option(name, code));
  }

  /** 選んだ組み合わせを、Chrome の翻訳が使えるか確かめて表示する(確かめられなければ何も出さない) */
  let checkId = 0;
  async function showPairStatus() {
    const id = ++checkId;
    const sourceLanguage = captionSelect.value;
    const targetLanguage = targetSelect.value;
    let message = '';
    if (sourceLanguage === targetLanguage) {
      message = t('popupPairSame');
    } else if (root.Translator?.availability) {
      try {
        const availability = await root.Translator.availability({ sourceLanguage, targetLanguage });
        message = {
          available: t('popupPairAvailable'),
          downloadable: t('popupPairDownload'),
          downloading: t('popupPairDownload'),
          unavailable: t('popupPairUnavailable'),
        }[availability] ?? '';
      } catch (_) {
        message = '';
      }
    }
    if (id === checkId) statusElement.textContent = message; // 古い問い合わせの結果で上書きしない
  }

  settingsStore.load().then((settings) => {
    captionSelect.value = settings.captionLang;
    targetSelect.value = settings.targetLang;
    showPairStatus();
  });
  captionSelect.addEventListener('change', () => {
    chromeApi.storageSet({ captionLang: captionSelect.value });
    showPairStatus();
  });
  targetSelect.addEventListener('change', () => {
    chromeApi.storageSet({ targetLang: targetSelect.value });
    showPairStatus();
  });
})(globalThis);
