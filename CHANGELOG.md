# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- The window no longer has to be closed and reopened for every next video. After a video change, CC was switched on only once, before the new player was ready; now the extension waits (up to 20 seconds) until the player is ready and then prepares captions.
- Manual (uploaded) captions were ignored when YouTube gave their window an id like `caption-window-_4`, because that id pattern was treated as a UI hint. Only top-aligned windows with that id whose text also looks like the hint ("click for settings" in several languages) are treated as hints now, so top-aligned manual captions are no longer dropped. (Found by running against the real YouTube page.)
- A translation API call that never answers no longer stalls every later translation. Each call has a timeout, and a stuck translator is discarded and recreated.
- Lines whose translation failed are retried automatically once translation recovers, instead of staying untranslated.
- The detected caption language is forgotten when the video changes, so one video's language is no longer applied to the next.
- Right after switching videos, captions left over from the previous video are no longer added to the new video's history.
- A reloaded extension's old script no longer removes the new script's style that hides YouTube's own captions.

### Added

- While the window is open, YouTube's caption language is switched to English when the video has an English track (manual captions are preferred over auto-generated ones), and restored when the window closes. Previously the window showed whatever language YouTube had selected — for example Japanese or German — so there was nothing to translate.
- If YouTube's caption markup changes so that captions are visible on the page but cannot be read (or the caption container is gone) for 20 seconds of playback, the window says so instead of waiting silently. Silent stretches (instrumental breaks, parts without captions) and ads are not counted, so it does not raise false alarms.
- A translation model that needs a click to download (for a language other than English) is now prepared the next time the window is opened, and the window explains what to do.

## [2.1.0] - 2026-09-21

### Changed

- Split the single `content.js` into modules under `src/` (captions → sentences, translation, YouTube access, window UI, entry point). No build step is needed; `manifest.json` lists the load order.
- Added unit tests (`npm test`), a manual test harness, CI, and contributor documentation.

### Fixed

- Japanese sentences were not split at `。` `！` `？`, because a space after the mark was required. Japanese captions now break into one sentence per line.
- Turning the `JA` button off cancelled the timer that finalizes a caption after the speaker pauses, so the pending line stayed until the next caption change.

## [2.0.0] - 2026-09-21 (not released separately)

### Added

- One sentence per line, stacked like scrolling lyrics; the newest line is bright.
- On-device Japanese translation under each line (Chrome Translator API), with status and error messages shown in the window.
- Support for auto-generated captions (no punctuation): lines split when the speaker pauses or a line grows too long.
- Text size, light/dark theme, and translation on/off controls.

### Fixed

- Rendering no longer depends on `requestAnimationFrame`, which Chrome stops in background tabs.
- After the extension is reloaded, the old script in an open tab shuts itself down instead of throwing `Extension context invalidated`.

[2.1.0]: https://github.com/fatcorn753/youtube-bilingual-caption-overlay/releases/tag/v2.1.0
