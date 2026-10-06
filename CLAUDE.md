# DIPS

Installable web app (PWA) for planning and logging disc golf disc dye jobs; static files served by GitHub Pages.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `README.md` | App link, install steps, architecture, design decisions, invariants, release checklist | Understanding the app, releasing, touching storage or updates |
| `index.html` | The app: Planner, Cliff Notes, Test log, My techniques, Your data tab; styles and planner code inline. Also the pattern list (`PATS`, `PHOTO_PATS`, own photo patterns and the helpers `patLabel` / `patKnown` / `extraPatterns` every site reads), More patterns and the own-photo line-up. This is the source to edit | Changing any feature, text or layout |
| `combos.js` | Color, combo-picker and color-wheel math (classify, buildCombos, buildCombosN for Dyes per combo, comboTouchPairs, photo color groups, wheel/dial geometry), moved out of index.html so it can be checked by script. Holds `MAX_DYES` (8), the one dye limit every route reads. Classic script (browser globals) with a guarded CommonJS export for Node | Changing prediction math, combo variety rules, touch pairs, the dye limit, or the color wheel/dial |
| `preview.js` | All disc drawing: the graphics-chip drawing (one shared hidden surface, copied into each picture) and the flat drawing it falls back to (`drawPattern`, `drawDiscOn`), photo loading and the photo recolor. Browser only | Changing how any disc picture looks, photo patterns, the fallback |
| `local.js` | Local storage layer answering `window.claude.use(...)`, photos, folder copy, backup/restore (with the tidy-up rule for each saved kind: log entries, techniques, own photo patterns), install help, reminders | Touching saving, photos, backups, the Your data tab |
| `sw.js` | Service worker: offline cache, update delivery, `VERSION` | Releasing (bump `VERSION` and every script tag's `?v=` in index.html), adding app files, debugging offline or updates |
| `manifest.webmanifest` | App name, icons, colors, start URL for install | Changing app name, icons or install behavior |
| `package.json` | Test tooling only: `playwright-core` dev dependency and `npm test`. The app has no packages | Changing how checks run |
| `.gitignore` | Ignores `tmp/`, `node_modules/` and the private `specs` link | Adding local-only files |

## Subdirectories

| Directory | What | When to read |
| --------- | ---- | ------------ |
| `icons/` | App icons (192, 512, maskable, Apple touch) | Changing app icons |
| `photos/` | The three shipped photo patterns (`cells.jpg`, `flames.jpg`, `spoked-starburst.jpg`, 720x720), listed in sw.js's FILES. The only photos in the public repo; a dyer's own photos stay on their device | Replacing a shipped photo pattern |
| `specs/` | Local link to private project docs (North Star, Doctrine, plans, reference copy of the claude.ai version). Not in git | Starting a session; checking rules before changing behavior. Never commit |
| `tmp/` | Throwaway scripts (icon generator, one-off port script). Not in git | Regenerating icons, one-off checks |
| `tests/` | `node:test` checks. `combos.test.js`: the color math against a frozen copy of 0.1.1's, the default combos against a frozen copy of 0.4.1's picker (`reference-0.4.1-combos.js`), combo variety rules, the wheel/dial, and that `sw.js`'s version stays in step with index.html's script tags. `harness.js`: shared setup for the screen checks (local server for the app's files, fresh Edge profile per check, real taps). `preview.test.js`: the disc pictures on both drawing paths, photo patterns, up to 8 dyes, Dyes per combo, More patterns. `planner.test.js`: Planner behavior and wording (custom dye ids and names, two windows, log limits, technique fallback, photo errors, no technical words, own photo patterns, the Test log form keeping every dye and any pattern, the printable sheet, bench figures). `data.test.js`: saving, backups, restore of damaged files, own photo patterns in backups and the folder, the DIPS folder, reminders, Install. `screen.test.js`: opens the app in installed Edge (computer, laptop-height, phone and 360px phone sizes) and taps real controls: the Pick on a wheel tap, the dye shelf at the top of the Planner, its fold and its count, chip button tap areas and no drag from a button, the wheel filter (default, empty states, hint per filter), the purple source dot, the tap-color tokens in light and dark, and that the Planner's left column scrolls with the page so "Log this dye job" stays reachable. Never referenced by index.html; never in sw.js's FILES | Changing combos.js or anything on screen, verifying a release before bumping VERSION |

## Build

No build step. Serve the folder over HTTP to test locally:

```
python -m http.server 8080 --directory D:\source\DIPS
```

## Test

Open http://localhost:8080 in Chrome or Edge for a manual click-through. Automated checks live in `tests/`; run from `D:\source\DIPS` with:

```
npm install   # once per machine: test tooling only
npm test
```

`npm test` runs `node --test --test-concurrency=2 "tests/*.test.js"` (the bare folder form `node --test tests` fails on this machine's Node 22). At most two test files run at once: each screen check's Edge draws on the graphics chip, and four at once overloaded the computer into page-load timeouts. The screen checks start their own local server and drive the installed Microsoft Edge, so Edge must be installed.

Screen checks tap at a point on screen (`mouse.click` / `touchscreen.tap`), never `element.click()`, so a layer covering a control fails them. For a bug fix, revert the fix and confirm the new check fails before keeping it.

Release: bump `VERSION` in `sw.js` and `?v=` on **every** script tag in `index.html` (`combos.js`, `preview.js` and `local.js`) together, run `npm test`, commit, push to `main`; GitHub Pages publishes automatically.
