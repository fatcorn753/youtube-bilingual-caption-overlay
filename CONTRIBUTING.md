# Contributing / コントリビューションの手引き

Thanks for your interest! Issues and pull requests are welcome, in English or Japanese.
関心をもっていただきありがとうございます。Issue・プルリクエストは、日本語・英語のどちらでも歓迎します。

## Setup / 準備

No build step, no dependencies. Node.js 20+ is only needed for the tests.
ビルドも依存パッケージも不要です。テストの実行にだけ Node.js 20 以降を使います。

```sh
npm test                         # 単体テスト / unit tests
python3 -m http.server 8000      # then open /test/manual/harness.html
sh scripts/screenshots.sh        # README の画像を作り直す / regenerate the README images (macOS + Chrome)
```

To try the extension in Chrome: `chrome://extensions` → Developer mode → Load unpacked → choose this folder. After editing the source, click "Reload" on the extension **and reload the YouTube tab** (the old script stays in the open tab until it is reloaded).

Chrome で試すには、`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選びます。ソースを直したら、拡張の「再読み込み」に加えて、**YouTube のタブもリロード**してください(古いスクリプトが、開いているタブに残るためです)。

## Project layout / 構成

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. It explains what each file does and why.
まず [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を読んでください。各ファイルの役割と、その理由を説明しています。

| Path | Role |
| --- | --- |
| `src/caption-history.js` | Groups captions into sentences (pure logic, well tested) |
| `src/translation.js` | Chrome Translator API wrapper (testable with a fake environment) |
| `src/youtube.js` | Everything that touches YouTube's page — start here when YouTube changes its markup |
| `src/page-bridge.js` | Runs in the page's own JS world (MAIN) to switch the caption track; talks to `youtube.js` via CustomEvents |
| `src/overlay.js` | The floating window's UI |
| `src/content.js` | Entry point that wires the modules together |
| `test/` | Unit tests (`*.test.js`) and a manual harness (`manual/harness.html`) |

## Guidelines / 方針

- **Add a test with every change in behavior.** Pure logic (`text.js`, `caption-history.js`, `translation.js`) is unit tested; for DOM code, use the harness.
  挙動を変えるときは、テストも足してください。純粋なロジックは単体テストで、DOM まわりはハーネスで確かめます。
- **Keep it dependency-free and build-free.** New dependencies need a strong reason.
  依存パッケージとビルド工程は増やさない方針です。
- **All `chrome.*` calls live in `src/chrome-api.js`**, and all page access in `src/youtube.js`.
  `chrome.*` は `chrome-api.js` に、ページへのアクセスは `youtube.js` に集めています。
- **Never use `requestAnimationFrame` or long timers for updating the window.** Chrome throttles them in background tabs, which is exactly when the window is needed. `MutationObserver` callbacks are not throttled.
  小窓の更新に `requestAnimationFrame` は使わないでください。背景のタブで止まります。
- **Do not use `innerHTML`.** YouTube enforces Trusted Types; build elements with the DOM API.
  `innerHTML` は使わないでください。YouTube は Trusted Types を強制します。
- **Adding a user-visible string:** add the key to both `_locales/en/messages.json` and `_locales/ja/messages.json`. `test/manifest.test.js` checks that every key is defined, used, and present in every language.
  画面に出す文言を足すときは、`en` と `ja` の両方にキーを足します。整合性は `test/manifest.test.js` が確かめます。
- Code comments are in Japanese and explain *why*, not *what*. English comments are fine in new code too.
  コードのコメントは日本語で、「何をするか」より「なぜそうするか」を書きます。

## Reporting problems / 不具合の報告

Please include: Chrome version, the video URL (if the caption behavior is involved), whether the captions were auto-generated, and the message shown at the bottom of the window (if any). The console messages starting with `[Caption Overlay]` help too.

Chrome のバージョン、動画の URL(字幕の挙動に関わる場合)、自動生成字幕かどうか、小窓の下の帯に出たメッセージ、コンソールの `[Caption Overlay]` から始まる出力を添えてください。
