/**
 * 利用者の設定(文字サイズ・テーマ・訳の表示・翻訳先の言語)の読み書き。
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});
  const { constants, chromeApi } = YCO;

  /** 選べる言語のコードか */
  const isSupportedLanguage = (code) => constants.LANGUAGES.some((language) => language.code === code);

  /** 保存済みの値を、既定値で補い、不正な値(古い版や手で書き換えた値)を既定値に戻す */
  function normalize(stored) {
    const settings = { ...constants.DEFAULT_SETTINGS, ...stored };
    for (const key of ['targetLang', 'captionLang']) {
      if (!isSupportedLanguage(settings[key])) settings[key] = constants.DEFAULT_SETTINGS[key];
    }
    return settings;
  }

  /** 保存済みの設定を読む */
  async function load() {
    return normalize(await chromeApi.storageGet(constants.DEFAULT_SETTINGS));
  }

  function save(settings) {
    chromeApi.storageSet(settings);
  }

  YCO.settingsStore = Object.freeze({ load, save, normalize, isSupportedLanguage });
})(globalThis);
