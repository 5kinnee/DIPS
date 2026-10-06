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

Use the installed app rather than a browser tab. On computers and Android the two share the same data (open both at once and each keeps up with the other). On iPhone they keep separate data, and Safari can clear data from sites you haven't opened in 7 days.

## Architecture

Static files only, served by GitHub Pages. No server, no accounts, no build step.

- `index.html` is the app: the Planner, Cliff Notes, Test log, My techniques and the "Your data" tab, with its styles and code inline. It was first built as a claude.ai page and still calls storage through `window.claude.use("db" | "assets" | "user" | "downloads")`.
- `combos.js` holds all the color, combo-picker and color-wheel math (moved out of `index.html` so it can be checked by script): classify a dye against a disc, build the ranked combo types (and, with "Dyes per combo" set, options of exactly that many dyes), which colors touch in each pattern, the color groups of a photo pattern, and the wheel/dial geometry. Loaded as a classic script first, so its functions are globals that `index.html` calls directly; it also exports the same functions as CommonJS so `tests/` can run against it with Node, outside the browser. The Planner works the combos out again only when something they depend on changes (`combosFor` in `index.html`: the disc, plastic, depth, mixing math, technique, pattern, which dyes are allowed, Dyes per combo, a photo's color groups becoming ready); putting dyes on the disc never does.
- **Up to 8 dyes on a disc.** The one limit is `MAX_DYES` in `combos.js`; every route that adds a dye (cards, Show on disc, the wheel, the dial, mixes, custom dyes, a saved setup), the drawing, the Test log form and the printable sheet read it. The Test log form shows one color slot per dye an entry has (plus one empty while under 8), so editing never drops a dye, even from an entry with more.
- `preview.js` draws every disc picture (the Planner disc, the Cliff Notes pictures, My techniques). It draws on the device's graphics chip through one shared hidden drawing surface, copying each finished disc into its picture, so any number of pictures uses one surface. If the chip is missing or stops working, every picture quietly uses the flat drawing (`drawPattern`) instead, never a blank disc and with no message. The disc's rim shadow, flight-plate line and highlight are the same 2D code on both paths. Loaded after `combos.js` and before `local.js`.
- `photos/` holds the three shipped photo patterns (Cells photo, Flames photo, Spoked starburst photo), cached for offline use. A photo pattern sorts the photo's colors into as many groups as there are dyes (largest area gets color 1) and recolors it, keeping its light and dark detail. A dyer can also add their own photo (More patterns > Add my own photo): it is lined up on a circle, cut square, shrunk like any photo and saved on their device.
- `tests/` holds `node:test` checks. `combos.test.js` covers `combos.js`: the new color math against a frozen copy of 0.1.1's (so a refactor can't silently change a prediction), the default combos against a frozen copy of 0.4.1's picker, the combo picker's variety rules, the color wheel's dial, and that `sw.js`'s version stays in step with `index.html`'s script tags. `screen.test.js` (Planner screens), `preview.test.js` (disc pictures on both drawing paths, photo patterns, 8 dyes), `planner.test.js` (Planner behavior and wording, own photo patterns, the Test log form) and `data.test.js` (saving, backups, restore, the DIPS folder, reminders, install) open the app in the installed Microsoft Edge (via `playwright-core`) as a computer and as a phone and tap real controls, so a layer covering a control fails a check; `harness.js` is their shared setup (a local server for the app's own files, a fresh browser profile per check, real taps). Not part of the app; never referenced by `index.html` or listed in `sw.js`'s `FILES`.
- `package.json` exists only for the test tooling (`playwright-core`, a dev dependency, in `node_modules/`, which git ignores). The app itself has no packages and no build step.
- `local.js` answers those calls from this device, so the planner code runs unchanged:
  - **db:** collections of documents (`tests` for log entries, `techniques`, and `patterns` for own photo patterns: `{name, photo, by, createdAt}`, the photo in the `blobs` store) stored in IndexedDB (database `dips`, store `docs`), the source of truth: each save is written there first, then to the in-memory copy that live listeners read. Other open windows hear about each save (BroadcastChannel) and reload that document; the shelf and custom dyes follow other windows through the browser's storage event. Backups and the folder copy are built from IndexedDB, never from one window's memory.
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
- **Deleting an own photo pattern never breaks what used it:** log entries keep the pattern's name (`patternName`, saved with every entry), "Load in planner" and a saved setup fall back to the bed's first usual pattern and say so, and a technique's picture falls back to Swirl. An own photo pattern whose photo is missing (restored without it) draws the dyes as Swirl and says so under the disc.
- **Every pattern works on every bed:** each technique's usual patterns come first; all others (the other drawn patterns, the photos, the dyer's own photos) are under More patterns, in the Test log form and in My techniques.
- **Folder saving is computer-only** (Chromium desktop). Phones get backup and restore, plus a reminder when the last backup is over 14 days old.
- **Restore and folder import only add;** they never delete or overwrite. Photos deleted in the app are left in the folder as a safety copy. Imported files are checked item by item: a log entry, technique or own photo pattern with a damaged field is repaired (that field is reset) and kept, except an own photo pattern with no photo reference, which is skipped; anything else unusable is skipped and counted; one bad item never stops the rest. A custom dye in the file that shares its id with a different dye on this device (older versions numbered custom dyes from 1 on every device) is kept under a new id.
- **A folder data file DIPS can't read is never overwritten:** DIPS stops and says so, so a damaged copy is never replaced by this device's data. A file DIPS can read is merged in when the folder is chosen and then kept up to date from this device; anything in it this version doesn't know is not kept. Every format DIPS has written is readable: the proof of concept's older data file holds nothing the planner uses, and any notes in it are kept beside it as `data-format1.json` before the first save.

## Invariants

- **Release checklist:** bump `VERSION` in `sw.js` **and** the `?v=` on **every** script tag in `index.html` (`combos.js`, `preview.js` and `local.js`), all to the same value; run `npm test` from the repo folder (once per machine, `npm install` first; the screen checks need Microsoft Edge installed). The browser only installs a new service worker when `sw.js` changes, and the `?v=` stops a browser pairing a new page with an old cached script (GitHub Pages lets browsers cache files for 10 minutes).
- **Add every new app file to the `FILES` list in `sw.js`,** or it won't work offline.
- Updates never switch under the user: a waiting worker shows "A new version of DIPS is ready" and only activates when they tap Reload.
- All user data must be reachable through the DIPS folder or the backup file. No feature may store data only in the browser. New `localStorage` keys that hold user data go in `LOCAL_KEYS` in `local.js`.
- Nothing shown to users may assume technical knowledge (no "IndexedDB", "cache", "JSON", "service worker", "WebGL", "shader", "graphics", "canvas", "GPU", "k-means").
- The dye limit lives only in `MAX_DYES` (`combos.js`); no other place may hold its own number.
- `specs` is a local link to private project notes. It is in `.gitignore` and must never be committed.