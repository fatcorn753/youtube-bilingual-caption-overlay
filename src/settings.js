/**
 * 利用者の設定(文字サイズ・テーマ・日本語訳の表示)の読み書き。
 */
(function (root) {
  'use strict';

  const YCO = (root.YCO = root.YCO || {});
  const { constants, chromeApi } = YCO;

  /** 保存済みの設定を読み、既定値で補って返す */
  async function load() {
    const stored = await chromeApi.storageGet(constants.DEFAULT_SETTINGS);
    return { ...constants.DEFAULT_SETTINGS, ...stored };
  }

  function save(settings) {
    chromeApi.storageSet(settings);
  }

  YCO.settingsStore = Object.freeze({ load, save });
})(globalThis);
