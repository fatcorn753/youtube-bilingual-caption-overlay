# Chrome ウェブストア掲載文

ストアのダッシュボードへ貼る文面。拡張機能の名前と短い説明は `_locales/*/messages.json` から自動で入る。

## 英語(既定言語)

**Detailed description**

Keep YouTube captions in a small always-on-top window, with a translation under each line.

- One sentence per line, scrolling like lyrics, so you can read at your own pace
- Translation appears right under each line (Japanese by default; pick other languages from the toolbar icon)
- The window stays on top, so you can switch to another tab or app and keep reading
- Light and dark themes, adjustable text size

Private by design
- Translation runs on your device with Chrome's built-in Translator API. Captions are never sent to any server.
- No network requests, no tracking, no account.
- The only permission requested is "storage", used to remember your text size and theme.

Requirements
- Chrome 138 or later (needed for the built-in Translator API). On older versions the caption window still works, but translation is unavailable.
- The video must have captions (manual or auto-generated).

Open source (MIT): https://github.com/fatcorn753/youtube-bilingual-caption-overlay

## 日本語

**詳細な説明**

YouTube の字幕を、最前面の小窓に表示します。各行の下に翻訳も出ます。

- 1 文 = 1 行で、歌詞のように流れます。自分のペースで読めます
- 各行のすぐ下に翻訳を表示(既定は日本語。ツールバーのアイコンから他の言語も選べます)
- 小窓は最前面に残るので、別のタブやアプリに移っても読み続けられます
- ライト/ダークのテーマ、文字サイズの調整

プライバシー
- 翻訳は Chrome 内蔵の Translator API で、端末内で行います。字幕が外部のサーバーへ送られることはありません
- ネットワーク通信、トラッキング、アカウント登録はありません
- 要求する権限は「storage」のみ。文字サイズとテーマの記憶に使います

動作条件
- 翻訳には Chrome 138 以降が必要です。それより古い場合、字幕の小窓は使えますが、翻訳は使えません
- 字幕(手動・自動生成のどちらでも)がある動画で使えます

オープンソース(MIT): https://github.com/fatcorn753/youtube-bilingual-caption-overlay

## ダッシュボードの入力欄

| 項目 | 値 |
|---|---|
| カテゴリ | ユーザー補助 または 生産性 |
| 言語 | 英語(既定)、日本語 |
| スクショ | `dist/store/screenshot-dark.png`、`dist/store/screenshot-light.png`(1280×800) |
| プライバシー方針の URL | `https://github.com/fatcorn753/youtube-bilingual-caption-overlay/blob/main/PRIVACY.md` |
| 単一用途の説明 | YouTube の字幕と翻訳を、最前面の小窓に表示する |
| `storage` の理由 | 文字サイズ・テーマ・翻訳の表示設定を、利用者のブラウザ内に保存するため |
| ホスト権限の理由 | `https://www.youtube.com/*` で字幕を読み取り、小窓へ表示するため |
| リモートコード | 使用しない |
| データの収集 | 収集しない(すべて「いいえ」) |
