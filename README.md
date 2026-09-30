# DIPS: Disc Ink Planning System

## Overview

**Open the app: https://5kinnee.github.io/DIPS/**

This GitHub page holds the app's source code. Clicking files here (like `index.html`) shows code, not the app. Use the link above to run it. Friends only ever need that link; the app explains installing and keeping data safe in plain words, for their device.

DIPS is a planner and logbook for dyeing disc golf discs. It predicts how PRO Chemical & Dye colors will look on a colored disc, suggests color combos for your technique, teaches the basics, and keeps a log of every dye job so you can learn from real results. It installs from a link, works offline, and keeps each person's data on their own device.

### Install

- **Windows or Mac (Chrome or Edge):** open https://5kinnee.github.io/DIPS/, then click the install icon in the address bar (or the Install button on the "Your data" tab).
- **Android (Chrome or Edge):** open https://5kinnee.github.io/DIPS/, then use the browser menu > Install app (or Add to Home screen).
- **iPhone or iPad:** open https://5kinnee.github.io/DIPS/ in Safari, tap Share, then Add to Home Screen.
- **Firefox:** works as a normal website, but can't be installed.

Use the installed app rather than a browser tab. The two keep separate data, and Safari can clear data from sites you haven't opened in 7 days.

## Architecture

Static files only, served by GitHub Pages. No server, no accounts, no build step.

- `index.html` is the app: the Planner, Cliff Notes, Test log, My techniques and the "Your data" tab, with its styles and code inline. It was first built as a claude.ai page and still calls storage through `window.claude.use("db" | "assets" | "user" | "downloads")`.
- `combos.js` holds all the color, combo-picker and color-wheel math (moved out of `index.html` so it can be checked by script): classify a dye against a disc, build the ranked combo types, and the wheel/dial geometry. Loaded as a classic script before `local.js`, so its functions are globals that `index.html` calls directly; it also exports the same functions as CommonJS so `tests/` can run against it with Node, outside the browser.
- `tests/` holds `node:test` checks for `combos.js`: the new color math against a frozen copy of 0.1.1's (so a refactor can't silently change a prediction), the combo picker's variety rules, the color wheel's dial, and that `sw.js`'s version stays in step with `index.html`'s script tags. Not part of the app; never referenced by `index.html` or listed in `sw.js`'s `FILES`.
- `local.js` answers those calls from this device, so the planner code runs unchanged:
  - **db:** collections of documents (`tests`, `techniques`) held in memory and written through to IndexedDB (database `dips`, store `docs`), with live listeners.
  - **assets:** photos, shrunk to 1600 px JPEG and stored as Blobs (store `blobs`). The planner renders them as `<img data-blob="id">`; a MutationObserver fills in the image.
  - **user:** a local profile id plus the name set on the "Your data" tab.
  - **downloads:** a normal download on computers, the share sheet on phones.
  - It also owns the "Your data" tab: install help, name, the DIPS folder copy, backup and restore, and the reminder bar.
- **Other saved state** lives in `localStorage` under `discdye.*` (dye shelf, custom dyes, planner setup, sort order). The folder copy and backups include the ones that matter.
- **DIPS folder** (Chrome/Edge on computers, File System Access API): the user picks a place; DIPS uses or creates a `DIPS` folder there and writes `data.json` (everything except photos) plus `photos\<id>.jpg`, about 1.5 s after each change.
- **Backup file** is JSON with photos embedded as data URLs.
- **Service worker** (`sw.js`) caches the app for offline use and delivers updates.

## Design Decisions

- **Installable web app, not a desktop app:** works on phones and computers from one link, needs no installer or code signing, and updates from the repo.
- **Keep the planner code as built and tested; swap only the storage underneath** (`local.js`). The planner was shaped by many rounds of real use, and rewriting it would risk losing fixes.
- **Public repo:** GitHub Pages on a free account requires it. No user data is ever in the repo.
- **Photos shrunk to 1600 px JPEG (quality 0.85) when added:** full-size phone photos make backups too big for Chrome to build and for Android to share. The original is not kept.
- **DIPS makes its own folder** inside the place the user picks, so it never scatters files through Documents. The user confirms the folder before anything is written, because the Windows picker can hand back a highlighted neighbor folder.
- **Browsers never reveal a folder's full path,** so the user can jot down where the folder lives and DIPS shows that note.
- **Folder saving is computer-only** (Chromium desktop). Phones get backup and restore, plus a reminder when the last backup is over 14 days old.
- **Restore and folder import only add;** they never delete or overwrite. Photos deleted in the app are left in the folder as a safety copy.

## Invariants

- **Release checklist:** bump `VERSION` in `sw.js` **and** the `?v=` on **every** script tag in `index.html` (`combos.js` and `local.js`), all to the same value; run `node --test "tests/*.test.js"` from the repo folder. The browser only installs a new service worker when `sw.js` changes, and the `?v=` stops a browser pairing a new page with an old cached script (GitHub Pages lets browsers cache files for 10 minutes).
- **Add every new app file to the `FILES` list in `sw.js`,** or it won't work offline.
- Updates never switch under the user: a waiting worker shows "A new version of DIPS is ready" and only activates when they tap Reload.
- All user data must be reachable through the DIPS folder or the backup file. No feature may store data only in the browser. New `localStorage` keys that hold user data go in `LOCAL_KEYS` in `local.js`.
- Nothing shown to users may assume technical knowledge (no "IndexedDB", "cache", "JSON", "service worker").
- `specs` is a local link to private project notes. It is in `.gitignore` and must never be committed.