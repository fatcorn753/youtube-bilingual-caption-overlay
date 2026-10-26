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
 *   応答 'yco:caption-response' { id, ok, changed?, previous?, reason?, error? }
 *
 * このファイルは YouTube のページの JavaScript と同じ場所で動くので、グローバルを増やさず、
 * 要求されたこと以外はしない。単体テストは test/page-bridge.test.js。
 */
(function (root) {
  'use strict';

  const REQUEST_EVENT = 'yco:caption-request';
  const RESPONSE_EVENT = 'yco:caption-response';

  const getPlayer = () => root.document.querySelector('#movie_player');

  /** 'en-US' や 'en' を、言語の部分('en')で比べる */
  const matchesLanguage = (track, languageCode) =>
    typeof track?.languageCode === 'string' && track.languageCode.toLowerCase().split('-')[0] === languageCode;

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

    const candidates = (player.getOption('captions', 'tracklist') || []).filter((track) =>
      matchesLanguage(track, languageCode),
    );
    const target = candidates.find((track) => track.kind !== 'asr') || candidates[0];
    if (!target) return { ok: true, changed: false, reason: 'no-track' };

    player.setOption('captions', 'track', target);
    // 何も選ばれていなかった(languageCode がない)ときは、戻す先がない
    return { ok: true, changed: true, previous: current?.languageCode ? current : null };
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
