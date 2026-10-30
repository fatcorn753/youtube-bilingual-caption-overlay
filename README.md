# Bilingual Caption Overlay for YouTube

[日本語](README.ja.md)

A Chrome extension that shows YouTube captions in an **always-on-top floating window** — one sentence per line, like scrolling lyrics — with an **on-device Japanese translation** under each line. The window stays visible when you switch to another tab or app.

<p align="center">
  <img src="docs/images/overlay-dark.png" alt="The floating window, dark theme: English sentences stacked from top to bottom, each with a Japanese translation underneath" width="49%">
  <img src="docs/images/overlay-light.png" alt="The same window, light theme" width="49%">
</p>

<sub>The sentences in these images were written for this project. They are not taken from any video.</sub>

- **One sentence per line.** Captions are grouped into sentences and stacked from top to bottom. The newest line is bright; older lines fade.
- **Translation under every line.** Translated on your device by Chrome's built-in Translator API. Nothing is sent to any server. Japanese by default; pick another language (English, Chinese, Korean, Spanish, French, German) from the toolbar icon.
- **Works with auto-generated captions**, which have no punctuation: lines are split when the speaker pauses.
- **Stays on top** of other tabs and apps (Document Picture-in-Picture).
- Adjustable text size, light/dark theme, and a switch to hide the translation.

## Why I built it, and how

I think the easiest and most memorable way to learn a new language is to read the captions of channels you already watch — in the language you want to learn — next to a translation, as one set.

I let AI (Claude Code) write and debug the code. My part is to try it on real YouTube videos and point out what is wrong with the UI and UX. Two changes came from using it that way:

- **Reopening the window for every new video was a chore** → the window now stays open and follows the next video automatically (v2.2.0).
- **The translation was Japanese only, and captions were assumed to be English** → the translation language and the caption language can now be chosen in the toolbar popup (v2.3.0).

I have not measured whether it actually improves learning.

## Requirements

| Feature | Needs |
| --- | --- |
| Floating window | Chrome 116 or later (Document Picture-in-Picture) |
| Translation | Chrome 138 or later (Translator API), desktop |

Other browsers (Firefox, Safari) are not supported.

## Install

Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/bilingual-caption-overlay/fbkiogggnhmaadaphohfnafjncbainfc) (one click, updates automatically).

To install a specific version, or to try the latest source, install it from a release instead:

1. Download `bilingual-caption-overlay-<version>.zip` from the [Releases page](https://github.com/fatcorn753/youtube-bilingual-caption-overlay/releases/latest).
2. Unzip it into a folder you will keep (Chrome loads the extension from that folder, so do not delete it).
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and choose the folder from step 2.

To update, download the new zip, replace the folder's contents, and click **Reload** on the extension card.

Prefer the source? `git clone https://github.com/fatcorn753/youtube-bilingual-caption-overlay`, then do steps 3–4 with the cloned folder.

## Usage

1. Open a YouTube video that has captions.
2. Click the **caption overlay** button, just left of the CC button in the player.
3. A floating window opens. Move the pointer over it to reach the controls:

| Button | What it does |
| --- | --- |
| `A−` / `A+` | Smaller / larger text |
| `JA` (shows the target language code, e.g. `KO`) | Show / hide the translation |
| `◐` | Switch between dark and light theme |

While the window is open, YouTube's own captions are hidden, CC is turned on if needed, and the caption language is switched to your chosen **caption language** (English by default; set it in the toolbar popup) when the video has that track (YouTube may otherwise show another language, leaving nothing to translate). Closing the window restores all of it. Moving on to the next video keeps the window open and prepares the new video the same way.

Scroll up to re-read earlier lines; the window stops following new lines until you scroll back to the bottom. The history keeps up to 300 lines and resets when you switch videos.

### When the translation does not appear

A short message at the bottom of the window explains why. Press `JA` twice to try again.

| Message | Meaning |
| --- | --- |
| Preparing translation… | The model is being prepared |
| Downloading translation model… NN% | First use only |
| The Translator API is not available here | Chrome 138+ is required |
| Translation model is not available (en→ja) | Check `chrome://on-device-translation-internals` |
| Translation error: … | The error name and message are shown (details in the console) |

## How it works

YouTube's caption text is read from the player and grouped into sentences. Sentences end at `.` `?` `!` `。` and so on; a sentence spread over several captions is joined into one line. Auto-generated captions, which have no punctuation, are split when the speaker pauses (about 1.5 s) or when a line gets too long.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design (written in Japanese).

## Limitations

- **Captions are read from YouTube's page.** If YouTube changes its markup, the extension may stop working until the selectors in [`src/youtube.js`](src/youtube.js) are updated. YouTube's official caption files can't be used: they are served empty without a proof-of-origin token.
- **Translation is machine translation** by Chrome's on-device model.
- Sentence splitting is tuned for English, German, Spanish, French, Japanese, Chinese and Korean. The abbreviation lists follow the caption language you chose in the popup, so a video whose captions are in another language may split a little early. Auto-generated captions have no punctuation and are split by pauses in any language.
- The abbreviation list (`Mr.`, `Dr.`, `e.g.`, …) is small. An unlisted abbreviation can split a sentence early.

## Development

No build step and no dependencies are needed. Node.js 20 or later runs the tests.

```sh
npm test         # unit tests (Node's built-in test runner)
npm run pack     # build dist/bilingual-caption-overlay-<version>.zip
```

To try the extension without opening YouTube, serve the repository and open the test harness (a fake player and a fake floating window):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/test/manual/harness.html in Chrome
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a pull request.

## Privacy

The extension collects no data and makes no network requests. Settings (text size, theme, translation on/off) are stored locally in your browser. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)

This project is not affiliated with, endorsed by, or sponsored by YouTube or Google. "YouTube" is a trademark of Google LLC. The extension only reads the captions you are already watching, in your own browser.
