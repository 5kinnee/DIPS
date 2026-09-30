# DIPS

Installable web app (PWA) for planning and logging disc golf disc dye jobs; static files served by GitHub Pages.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `README.md` | App link, install steps, architecture, design decisions, invariants, release checklist | Understanding the app, releasing, touching storage or updates |
| `index.html` | The app: Planner, Cliff Notes, Test log, My techniques, Your data tab; styles and planner code inline. This is the source to edit | Changing any feature, text or layout |
| `combos.js` | Color, combo-picker and color-wheel math (classify, buildCombos, comboTouchPairs, wheel/dial geometry), moved out of index.html so it can be checked by script. Classic script (browser globals) with a guarded CommonJS export for Node | Changing prediction math, combo variety rules, touch pairs, or the color wheel/dial |
| `local.js` | Local storage layer answering `window.claude.use(...)`, photos, folder copy, backup/restore, install help, reminders | Touching saving, photos, backups, the Your data tab |
| `sw.js` | Service worker: offline cache, update delivery, `VERSION` | Releasing (bump `VERSION` and every script tag's `?v=` in index.html), adding app files, debugging offline or updates |
| `manifest.webmanifest` | App name, icons, colors, start URL for install | Changing app name, icons or install behavior |
| `.gitignore` | Ignores `tmp/` and the private `specs` link | Adding local-only files |

## Subdirectories

| Directory | What | When to read |
| --------- | ---- | ------------ |
| `icons/` | App icons (192, 512, maskable, Apple touch) | Changing app icons |
| `specs/` | Local link to private project docs (North Star, Doctrine, plans, reference copy of the claude.ai version). Not in git | Starting a session; checking rules before changing behavior. Never commit |
| `tmp/` | Throwaway scripts (icon generator, one-off port script). Not in git | Regenerating icons, one-off checks |
| `tests/` | `node:test` checks for `combos.js`: the color math against a frozen copy of 0.1.1's, combo variety rules, the wheel/dial, and that `sw.js`'s version stays in step with index.html's script tags. Never referenced by index.html; never in sw.js's FILES | Changing combos.js, verifying a release before bumping VERSION |

## Build

No build step. Serve the folder over HTTP to test locally:

```
python -m http.server 8080 --directory D:\source\DIPS
```

## Test

Open http://localhost:8080 in Chrome or Edge for a manual click-through. Automated checks for `combos.js` live in `tests/`; run from `D:\source\DIPS` with:

```
node --test "tests/*.test.js"
```

(The bare folder form `node --test tests` fails on this machine's Node 22.)

Release: bump `VERSION` in `sw.js` and `?v=` on **every** script tag in `index.html` (`combos.js` and `local.js`) together, run the tests above, commit, push to `main`; GitHub Pages publishes automatically.
