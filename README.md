# DIPS: Disc Ink Planning System

## Overview

DIPS is a planner and logbook for dyeing disc golf discs. It predicts how PRO Chemical & Dye colors will look on a colored disc, suggests color combos for your technique, and keeps a log of every dye job so you can learn from real results. It is a web app you install from a link. It works offline, and your data stays on your own device.

**Open the app: https://5kinnee.github.io/DIPS/**

This GitHub page holds the app's source code. Clicking files here (like `index.html`) shows code, not the app. Use the link above to run it.

**Status:** proof of concept. It tests install, local storage, saving to a folder, backup/restore and updates. The full planner is being ported next.

### Install

- **Windows or Mac (Chrome or Edge):** open https://5kinnee.github.io/DIPS/, then click the install icon in the address bar (or the Install button in the app).
- **Android (Chrome):** open https://5kinnee.github.io/DIPS/, then menu > Install app (or Add to Home screen).
- **iPhone or iPad:** open https://5kinnee.github.io/DIPS/ in Safari, tap Share, then Add to Home Screen.
- **Firefox:** works as a normal website, but can't be installed.

Use the installed app rather than a browser tab. The two keep separate data, and Safari can clear data from sites you haven't opened in 7 days.

### Keeping your data safe

- **Computers (Chrome or Edge):** choose a data folder once (for example `Documents\DIPS` or a OneDrive folder). DIPS keeps a copy of everything there automatically, as `data.json` plus a `photos` folder. If the browser's data is ever cleared, choose the same folder again and everything comes back.
- **Phones and other browsers:** use Backup to save a file, and Restore to bring it back. Restoring adds entries; it never deletes ones you already have.
- In Chrome, clearing "Cached images and files" is safe. Clearing "Cookies and other site data" erases the app's data in the browser (the data folder and backup files are not affected).

## Architecture

Static files only, served by GitHub Pages. No server, no accounts, no build step.

- `index.html` is the whole app: HTML, CSS and JavaScript in one file.
- **IndexedDB** (database `dips`) holds entries, photos as Blobs, and settings including the data-folder handle.
- **Data folder** (Chrome/Edge desktop only) uses the File System Access API. Every save writes `data.json` and any photos not yet in `photos\`. Connecting a folder first imports anything in it that the browser doesn't have.
- **Backup file** is JSON with photos embedded as data URLs. On phones it goes through the share sheet, because plain downloads are unreliable in installed iPhone apps.
- **Service worker** (`sw.js`) caches the app for offline use and delivers updates (see Invariants).

## Design Decisions

- **Installable web app instead of a desktop app:** works on phones and computers from one link, needs no installer or code signing, and updates from the repo.
- **Public repo:** GitHub Pages on a free account requires it. No user data is ever in the repo.
- **Photos shrunk to 1600 px JPEG (quality 0.85) when added:** full-size phone photos make backups too big for Chrome to build and for Android to share. The original is not kept.
- **Folder saving is desktop-only** because only Chromium desktop browsers support the File System Access API. Every other browser gets backup and restore instead.
- **Restore merges by entry id** and never deletes, so restoring an old backup can't wipe newer work.

## Invariants

- **Bump `VERSION` in `sw.js` on every release.** The browser only installs a new service worker when that file changes, and the version names the cache. Forget it and users never get the update.
- **Add every new app file to the `FILES` list in `sw.js`,** or it won't work offline.
- The service worker fetches its files with `cache: "reload"` because GitHub Pages caches files for 10 minutes; otherwise a release could cache stale copies.
- Updates never switch under the user: a waiting worker shows "A new version of DIPS is ready" and only activates when they tap Reload.
- All user data must be reachable through the data folder or the backup file. No feature may store data only in the browser.
- `specs` is a local link to private project notes. It is in `.gitignore` and must never be committed.
