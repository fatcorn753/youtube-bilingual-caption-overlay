/**
 * ツールバーのアイコンを押したときのポップアップ。設定を選び、chrome.storage.local に保存する。
 * 開いている YouTube のタブは、保存の変更を chrome.storage.onChanged で受け取って反映する
 * (このファイルは YouTube のタブとは通信しない)。
 */
(function (root) {
  'use strict';

  const { constants, chromeApi, settingsStore } = root.YCO;

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = chromeApi.t(element.dataset.i18n);
  }

  const select = document.getElementById('targetLang');
  for (const { code, name } of constants.LANGUAGES) {
    select.add(new Option(name, code));
  }

  settingsStore.load().then((settings) => {
    select.value = settings.targetLang;
  });
  select.addEventListener('change', () => chromeApi.storageSet({ targetLang: select.value }));
})(globalThis);
