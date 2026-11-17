/**
 * ページ側(MAIN world)で動く、小さな橋渡し。
 *
 * YouTube のプレイヤー(#movie_player)の `getOption` / `setOption` は、ページ自身の JavaScript に
 * 定義されていて、拡張の通常のスクリプト(isolated world)からは呼べない。
 * そのため、字幕のトラック(言語)を切り替える処理だけを、この MAIN world のスクリプトに任せる。
 *
 * 通信は document 上の CustomEvent で行う。world をまたいでも確実に渡せるよう、
 * 中身は JSON 文字列にする。イベント名は src/youtube.js と揃えること。
 *
 *   要求 'yco:caption-request'  { id, action: 'prefer', languageCode } | { id, action: 'restore', track }
 *                               | { id, action: 'current' }
 *   応答 'yco:caption-response' { id, ok, changed?, previous?, language?, reason?, error? }
 *
 * このファイルは YouTube のページの JavaScript と同じ場所で動くので、グローバルを増やさず、
 * 要求されたこと以外はしない。単体テストは test/page-bridge.test.js。
 */
(function (root) {
  'use strict';

  const REQUEST_EVENT = 'yco:caption-request';
  const RESPONSE_EVENT = 'yco:caption-response';

  const getPlayer = () => root.document.querySelector('#movie_player');

  /**
   * トラックの言語を、選べる言語のコード(小文字)にそろえる。'en-US' → 'en'。
   * 中国語だけは、簡体字('zh')と繁体字('zh-hant')を分ける('zh-TW' 'zh-HK' 'zh-Hant' は繁体字)
   */
  function trackLanguage(track) {
    if (typeof track?.languageCode !== 'string') return null;
    const code = track.languageCode.toLowerCase();
    const base = code.split('-')[0];
    if (base === 'zh' && /-(hant|tw|hk|mo)\b/.test(code)) return 'zh-hant';
    return base;
  }

  const matchesLanguage = (track, languageCode) => trackLanguage(track) === languageCode.toLowerCase();

  /**
   * 字幕のトラックを、指定の言語に切り替える。すでにその言語なら何もしない。
   * 手動の字幕があれば、自動生成(asr)より優先する。
   * @returns 切り替える前のトラックを `previous` に入れて返す(元に戻すために使う)
   */
  function preferLanguage(languageCode) {
    const player = getPlayer();
    if (typeof player?.getOption !== 'function') return { ok: false, reason: 'no-player' };

    const current = player.getOption('captions', 'track');
    if (matchesLanguage(current, languageCode)) return { ok: true, changed: false };

    const tracklist = player.getOption('captions', 'tracklist') || [];
    let candidates = tracklist.filter((track) => matchesLanguage(track, languageCode));
    if (!candidates.length) {
      // 中国語は、選んだ字体のトラックがなければ、もう一方の字体でもよい(字幕がないよりよい)
      const sameBase = (track) => trackLanguage(track)?.split('-')[0] === languageCode.toLowerCase().split('-')[0];
      if (sameBase(current)) return { ok: true, changed: false };
      candidates = tracklist.filter(sameBase);
    }
    const target = candidates.find((track) => track.kind !== 'asr') || candidates[0];
    if (!target) return { ok: true, changed: false, reason: 'no-track' };

    player.setOption('captions', 'track', target);
    // 何も選ばれていなかった(languageCode がない)ときは、戻す先がない
    return { ok: true, changed: true, previous: current?.languageCode ? current : null };
  }

  /**
   * いま表示されている字幕の言語を、Translator API の言語タグで返す(字幕がオフなら null)。
   * YouTube の自動翻訳が選ばれているときは、翻訳先(translationLanguage)が、表示されている言語
   */
  function currentLanguage() {
    const player = getPlayer();
    if (typeof player?.getOption !== 'function') return { ok: false, reason: 'no-player' };
    const track = player.getOption('captions', 'track');
    const language = trackLanguage(track?.translationLanguage?.languageCode ? track.translationLanguage : track);
    if (language === 'zh-hant') return { ok: true, language: 'zh-Hant' };
    // YouTube はヘブライ語を古いコード 'iw' で表す
    return { ok: true, language: language === 'iw' ? 'he' : language };
  }

  function restoreTrack(track) {
    const player = getPlayer();
    if (typeof player?.setOption !== 'function' || !track?.languageCode) return { ok: false, reason: 'no-track' };
    player.setOption('captions', 'track', track);
    return { ok: true };
  }

  function handle(request) {
    if (request.action === 'prefer' && typeof request.languageCode === 'string') {
      return preferLanguage(request.languageCode);
    }
    if (request.action === 'restore') return restoreTrack(request.track);
    if (request.action === 'current') return currentLanguage();
    return { ok: false, reason: 'unknown-action' };
  }

  root.document.addEventListener(REQUEST_EVENT, (event) => {
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch (_) {
      return;
    }
    let response;
    try {
      response = handle(request);
    } catch (error) {
      response = { ok: false, error: String(error?.message ?? error) };
    }
    root.document.dispatchEvent(
      new root.CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify({ id: request.id, ...response }) }),
    );
  });
})(globalThis);
