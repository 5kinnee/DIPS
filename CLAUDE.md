# DIPS

Installable web app (PWA) for planning and logging disc golf disc dye jobs; static files served by GitHub Pages.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `README.md` | App link, install steps, architecture, design decisions, invariants, release checklist | Understanding the app, releasing, touching storage or updates |
| `index.html` | The app: Planner, Cliff Notes, Test log, My techniques, Your data tab; styles and planner code inline. This is the source to edit | Changing any feature, text or layout |
| `local.js` | Local storage layer answering `window.claude.use(...)`, photos, folder copy, backup/restore, install help, reminders | Touching saving, photos, backups, the Your data tab |
| `sw.js` | Service worker: offline cache, update delivery, `VERSION` | Releasing (bump `VERSION` and the `?v=` in index.html), adding app files, debugging offline or updates |
| `manifest.webmanifest` | App name, icons, colors, start URL for install | Changing app name, icons or install behavior |
| `.gitignore` | Ignores `tmp/` and the private `specs` link | Adding local-only files |

## Subdirectories

| Directory | What | When to read |
| --------- | ---- | ------------ |
| `icons/` | App icons (192, 512, maskable, Apple touch) | Changing app icons |
| `specs/` | Local link to private project docs (North Star, Doctrine, plans, reference copy of the claude.ai version). Not in git | Starting a session; checking rules before changing behavior. Never commit |
| `tmp/` | Throwaway scripts (icon generator, one-off port script). Not in git | Regenerating icons, one-off checks |

## Build

No build step. Serve the folder over HTTP to test locally:

```
python -m http.server 8080 --directory D:\source\DIPS
```

## Test

Open http://localhost:8080 in Chrome or Edge. Release: bump `VERSION` in `sw.js` and `?v=` on the `local.js` tag in `index.html`, commit, push to `main`; GitHub Pages publishes automatically.
