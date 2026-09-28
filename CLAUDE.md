# DIPS

Installable web app (PWA) for planning and logging disc golf disc dye jobs; static files served by GitHub Pages.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `README.md` | Install steps, architecture, design decisions, invariants | Understanding the app, releasing, touching storage or updates |
| `index.html` | The whole app: markup, styles, IndexedDB, data folder, backup/restore, install and update UI | Changing any feature or UI |
| `sw.js` | Service worker: offline cache, update delivery, `VERSION` | Releasing (bump `VERSION`), adding app files, debugging offline or updates |
| `manifest.webmanifest` | App name, icons, colors, start URL for install | Changing app name, icons or install behavior |
| `.gitignore` | Ignores `tmp/` and the private `specs` link | Adding local-only files |

## Subdirectories

| Directory | What | When to read |
| --------- | ---- | ------------ |
| `icons/` | App icons (192, 512, maskable, Apple touch) | Changing app icons |
| `specs/` | Local link to private project docs (North Star, Doctrine, plans). Not in git | Starting a session; checking rules before changing behavior. Never commit |
| `tmp/` | Throwaway scripts (icon generator lives here). Not in git | Regenerating icons, one-off checks |

## Build

No build step. Serve the folder over HTTP to test locally:

```
python -m http.server 8080 --directory D:\source\DIPS
```

## Test

Open http://localhost:8080 in Chrome or Edge. Release: bump `VERSION` in `sw.js`, commit, push to `main`; GitHub Pages publishes automatically.
