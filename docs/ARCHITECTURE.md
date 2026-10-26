# 設計

この拡張機能の構成と、その理由をまとめます。コードを読む前に、ここを一通り読むと迷いません。

## 全体像

YouTube のプレイヤーから字幕を読み取り、**文に区切って**、最前面の小窓に**1 行 = 1 文**で積み、各行に**日本語訳**を付けます。

```
YouTube のページ
  └─ 字幕の DOM ─(youtube.js)─▶ CaptionHistory ─(1 文ごとに onCommit)─▶ Overlay(履歴に追加)
                                                         │
                                                         └▶ TranslationService ─▶ Overlay(訳を追加)
```

- 字幕は「いま画面に出ているもの」しか取れず、刻々と変わります。これを文に区切るのが `CaptionHistory` の仕事です
- 文が確定するたびに、履歴へ行を足し、その行の翻訳を依頼します
- 翻訳は Chrome 内蔵の Translator API(端末内で完結)です

## ファイル構成

ビルドはありません。`manifest.json` の `content_scripts.js` に書かれた順に、ブラウザが読み込みます(この順序が依存関係です)。各ファイルは `globalThis.YCO` に部品を登録します。

| 順 | ファイル | 役割 | ブラウザ依存 |
| --- | --- | --- | --- |
| 1 | `src/constants.js` | 定数と既定値(タイミング・上限・配色) | なし |
| 2 | `src/text.js` | 文字列の連結と、文の区切りの判定 | なし |
| 3 | `src/chrome-api.js` | `chrome.*` の呼び出しをすべて集める | あり |
| 4 | `src/settings.js` | 設定の読み書き | あり(chrome-api 経由) |
| 5 | `src/caption-history.js` | 字幕を文に区切る状態機械 | **なし** |
| 6 | `src/translation.js` | 翻訳サービス(状態通知・キャッシュ・言語判定) | 環境を注入できる |
| 7 | `src/youtube.js` | YouTube のページとのやり取りをすべて集める | あり |
| 8 | `src/overlay.js` | 小窓の UI(表示だけ) | あり |
| 9 | `src/content.js` | 部品をつなぎ、起動・開閉・後片付けを管理する | あり |
| - | `popup/popup.html` / `popup.js` | ツールバーのポップアップ。設定を `chrome.storage.local` に保存するだけで、YouTube のタブとは直接通信しない(`constants.js` `chrome-api.js` `settings.js` を共用) | あり |
| - | `src/page-bridge.js` | **MAIN world** で動き、字幕トラックの切り替えだけをページ側で行う(manifest の別エントリ) | あり |

「ブラウザ依存なし」の部品(2, 5)と、環境を注入できる部品(6)は、Node で単体テストします。

## 字幕を文に区切る(`caption-history.js`)

表示中の字幕は、次の 3 通りのどれかで変わります。

```
1. 伸びる     "Hello"      → "Hello there"       単語が増える
2. 繰り上がる "A B C D"    → "C D E"             先頭が消え、前の末尾が新しい先頭に残る(自動字幕)
3. 入れ替わる "Hello there" → "Something else"    新しい発話
```

まだ文として確定していない字幕を **未確定(pending)** と呼びます。次の 2 つでできています。

- `carry`: 画面から消えたが、まだ文の終わりに達していない断片
- 表示中の字幕のうち、まだ確定していない後半(`committedLength` 文字目以降)

未確定は、次のどれかで 1 行として確定します。

| きっかけ | 判断する場所 |
| --- | --- |
| 文末記号(`. ? ! 。` など)が来た | `CaptionHistory`(自動) |
| 話が止まった | `content.js` が待ち時間を測り、`commitPending()` を呼ぶ |
| 文末が来ないまま長くなった | `CaptionHistory`(自動) |

**自動生成字幕**(句読点がない)かどうかは、YouTube の DOM のクラス `ytp-caption-window-rollup` で判別します。この場合は、待ち時間を短く(約 1.5 秒)、行の上限も短く(約 120 文字)します。手動字幕は、文をまたぐキューが多いので、待ち時間は長め(約 8 秒。保険)にして、文末まで貯めます。

### 文末の判定(`text.js`)

- 半角の `. ! ? …` は、直後が空白か末尾のときだけ文末とみなします(`3.14` や `e.g` の途中で切らないため)
- 全角の `。 ! ?` は、日本語では直後に空白を置かないので、後ろに何が続いても文末とみなします
- `Mr.` `Dr.` `e.g.` や頭文字(`J.`)の後ろのピリオドは、文末にしません。ただし `I.` は文末になりうるので、頭文字から除きます

## 翻訳(`translation.js`)

- Chrome 138 以降の `Translator` / `LanguageDetector` を使います。ブラウザの API は `env` から取るので、テストでは偽物に差し替えられます
- 翻訳器は原語ごとに 1 度だけ作り、使い回します。失敗したら一定時間は再試行しません(`JA` ボタンで即やり直せます)
- 翻訳できないときは、理由を `onStatus` で通知します(小窓の下の帯に出ます)。一度でも訳せた後の一時的な失敗は、通知しません
- モデルの初回ダウンロードは、ユーザー操作の直後でないと許可されないことがあります。そのため、小窓を開くボタンのクリック直後に `prewarm()` を呼びます
- 確定した文の翻訳は、`content.js` が 1 件ずつ順番に処理します。同じ文はキャッシュから返します

## 設計上の判断

### 字幕の言語は、プレイヤーの API で英語に切り替える

拡張は画面に出ている字幕をそのまま読むので、YouTube が日本語やドイツ語を選んでいると、訳す元の英語が取れません。実際にドイツ語が既定で出る動画を確認しました。プレイヤー(`#movie_player`)の `getOption('captions', 'tracklist')` / `setOption('captions', 'track', …)` で切り替えられますが、これらはページ自身の JavaScript に定義されていて、通常の content script(isolated world)からは呼べません。そのため `world: "MAIN"` の `page-bridge.js` に処理を任せ、`document` 上の CustomEvent(中身は JSON 文字列)で通信します。英語のトラックがない動画は触りません。切り替える前のトラックは覚えておき、小窓を閉じたときに戻します。

### 動画が替わったあとは、準備ができるまで繰り返す

動画が替わった直後は、プレイヤーの準備がまだで、CC ボタンも出ていません。1 度きりの `ensureOn()` では取りこぼし、次の動画ごとに小窓を開き直すことになります。そこで `prepareCaptions()` が、CC ボタンが出るまで(最大 20 秒)0.5 秒おきに確かめ、出たら CC をオンにして字幕を英語にします。

### 翻訳先は、ポップアップから storage 経由で変える

翻訳先の言語は、ポップアップ(動画のタブとは別のページ)で選びます。ポップアップは `chrome.storage.local` に書くだけにして、開いているタブの content script が `chrome.storage.onChanged` で受け取ります。タブへ直接メッセージを送ると、どのタブが開いているかを管理する必要があり、拡張を再読み込みした後の古いタブとの食い違いも増えるためです。

言語が変わると、`TranslationService.setTargetLang()` が翻訳器・キャッシュ・失敗の記録を捨て、小窓は出ている訳を消して訳し直します。翻訳には「世代」の番号があり、**翻訳中に言語が変わったら、古い言語の訳を捨てます**(捨てないと、古い訳が画面にもキャッシュにも残ります)。

### 字幕は DOM から読む

YouTube 公式の字幕ファイル(`timedtext`)は、取得しようとすると HTTP 200 で**空の本文**が返ります(2026 年 9 月に確認。証明トークンが必要とみられます)。拡張機能から安定して取る方法がないため、プレイヤーの DOM(`.ytp-caption-window-container`)を読んでいます。YouTube が構造を変えると動かなくなる恐れがあり、その場合は `src/youtube.js` の `SELECTORS` を直します。

### `requestAnimationFrame` を使わない

この拡張は「別のタブに移っても、字幕を更新し続ける」ことが目的です。ところが、YouTube のタブが背景に回ると、Chrome は `requestAnimationFrame` を止め、`setTimeout` も間引きます。一方、`MutationObserver` のコールバックはマイクロタスクで動くので、間引かれません。字幕の変化は `MutationObserver` で受け、`queueMicrotask` で描画します。

### 元の字幕は `display: none` にしない

小窓を開いている間、YouTube 本体の字幕は隠します。`display: none` にすると、YouTube が字幕の DOM を更新しなくなり、こちらが読めなくなります。そのため `opacity: 0` で隠します。

### `innerHTML` を使わない

YouTube は Trusted Types を強制していて、`innerHTML` への代入は拒否されます。要素は DOM API で組み立てます。

### 拡張の再読み込みと「世代」

拡張を再読み込み・更新しても、開いているタブの古い content script は残ります。古い側から `chrome.*` を呼ぶと `Extension context invalidated` になります。そこで、読み込みのたびに世代 ID を付け、次のようにしています。

- 新しい世代は、古い世代が残したボタンを消して、自分のボタンを置く
- 古い世代は、定期チェックで「自分はもう現役ではない」と気づくと、自分が作ったものだけ片付けて止まる
- ページに置く要素には持ち主(`data-owner`)を付け、他の世代のものは消さない

### 依存パッケージとビルドを持たない

読みやすさと、貢献のしやすさのためです。モジュール分割は、`manifest.json` の読み込み順と、`globalThis.YCO` への登録で実現しています。

## テスト

| 対象 | 方法 |
| --- | --- |
| `text.js` / `caption-history.js` | 単体テスト(Node 標準の `node --test`) |
| `translation.js` | 単体テスト。Translator / LanguageDetector の偽物を注入 |
| `youtube.js` の `readCaptions` | 単体テスト。偽の DOM を用意 |
| `manifest.json` と翻訳メッセージ | 単体テスト。キーの過不足、読み込み漏れ、バージョンの一致 |
| `overlay.js` / `content.js` | 手動ハーネス(`test/manual/harness.html`)。偽のプレイヤー、偽の小窓、偽の翻訳 API |

実際の YouTube と、Chrome 内蔵の翻訳モデルを使った通し確認は自動化していません。リリース前に、実機で確かめてください。
