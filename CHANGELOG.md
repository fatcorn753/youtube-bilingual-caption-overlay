# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
