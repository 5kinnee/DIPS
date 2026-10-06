"use strict";
/* Shared harness for the screen checks: a local server for the app's own files, installed Edge
   via playwright-core, a fresh browser profile per check, and real taps at screen points. Requiring
   it registers the before/after hooks in the requiring test file. */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg" };

/* Serves only the app's own files (the list sw.js caches), never specs/, .git or node_modules. */
const APP_FILES = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8")
  .match(/const FILES\s*=\s*(\[[\s\S]*?\]);/)[1]).filter(f => f !== "./").concat("sw.js"));

function serve() {
  const server = http.createServer((req, res) => {
    const rel = req.url.split("?")[0].replace(/^\/+/, "") || "index.html";
    if (!APP_FILES.has(rel)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(rel)] || "application/octet-stream" });
    fs.createReadStream(path.join(ROOT, rel)).pipe(res);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/* Each check runs in a fresh browser profile, so the offline copy starts empty and is filled
   from the files on disk: no stale copy from an earlier run. */
const DEVICES = {
  computer: { viewport: { width: 1280, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
};

/* Extra sizes for checks that need them; kept out of DEVICES so checks that loop over DEVICES stay on the two main sizes. */
const ALL_DEVICES = { ...DEVICES, laptop: { viewport: { width: 1280, height: 768 } },
  phone360: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true } };

let server, browser, base;
test.before(async () => {
  server = await serve();
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ channel: "msedge" });
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

/* opts.context: extra browser-context options (e.g. deviceScaleFactor); opts.init: functions given the
   context before the page opens, for init scripts such as noGraphics and countSurfaces below;
   opts.onFirstLoad: a function given the page right after its first, fresh-profile load. */
async function openApp(device, opts = {}) {
  const context = await browser.newContext({ ...ALL_DEVICES[device], ...(opts.colorScheme ? { colorScheme: opts.colorScheme } : {}), ...(opts.context || {}) });
  for (const f of [].concat(opts.init || [])) await f(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  /* A first visit does not reload: the page notes it had no worker when it started and ignores the
     worker taking over (DIPS-023). Open the app again once the worker is in control, as a returning
     user would. The retry on an interrupted navigation is harmless protection; nothing reloads the page on a first visit. */
  await page.goto(base);
  if (opts.onFirstLoad) await opts.onFirstLoad(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  for (let attempt = 1; ; attempt++) {
    try { await page.goto(base); break; }
    catch (e) { if (attempt === 3 || !/interrupted by another navigation/.test(e.message)) throw e; }
  }
  await page.waitForFunction(() => /^#[0-9a-f]{6}$/.test(document.querySelector("#baseHex").value));
  return { context, page, errors };
}

const isTouch = device => !!ALL_DEVICES[device].hasTouch;
async function tapAt(page, device, x, y) {
  if (isTouch(device)) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
}
/* Scrolls the control to mid-screen and taps its center; a control that is hidden or covered fails. */
async function tapEl(page, device, sel) {
  const loc = page.locator(sel).first();
  await loc.evaluate(el => el.scrollIntoView({ block: "center" }));
  const b = await loc.boundingBox();
  assert.ok(b, `${sel} is not on screen`);
  await tapAt(page, device, b.x + b.width / 2, b.y + b.height / 2);
}
async function boxOf(page, sel) {
  const loc = page.locator(sel).first();
  await loc.evaluate(el => el.scrollIntoView({ block: "center" }));
  const b = await loc.boundingBox();
  assert.ok(b, `${sel} is not on screen`);
  return b;
}
/* A token's value as the browser resolves it for the current theme, in rgb() form like getComputedStyle. */
async function tokenRgb(page, name) {
  return page.evaluate(n => {
    const p = document.createElement("i");
    p.style.color = `var(${n})`;
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }, name);
}
const rgbOf = s => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s); assert.ok(m, `not a color: ${s}`); return [+m[1], +m[2], +m[3]]; };
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(rgbOf(a)), lum(rgbOf(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function hueOf(s) {
  const [r, g, b] = rgbOf(s).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const stateSel = page => page.evaluate(() => state.sel.slice());
const reopen = async page => { await page.reload(); await page.waitForFunction(() => /^#[0-9a-f]{6}$/.test(document.querySelector("#baseHex").value)); };
const showWheel = async (page, device) => {
  await tapEl(page, device, '#viewSeg [data-view="wheel"]');
  await page.locator("#wheelBox").waitFor({ state: "visible" });
};
/* A first visit starts with the top combo already picked; clear it with × as a person would. */
const clearPicked = async (page, device) => {
  while (await page.locator('#onDisc [data-remove]').count()) {
    const n = (await stateSel(page)).length;
    await tapEl(page, device, '#onDisc [data-remove="0"]');
    await page.waitForFunction(k => state.sel.length === k - 1, n);
  }
};
const openShelf = async (page, device) => {
  await tapEl(page, device, "#shelfFold > summary");
  await page.waitForFunction(() => document.querySelector("#shelfFold").open);
};

/* The hit area of a chip button is its ::after box; read it from the browser so a missing one fails. */
const hitArea = (page, sel) => page.locator(sel).first().evaluate(el => {
  const b = el.getBoundingClientRect(), cs = getComputedStyle(el, "::after"), p = v => parseFloat(v);
  return { content: cs.content, l: b.left + p(cs.left), r: b.right - p(cs.right), t: b.top + p(cs.top), b: b.bottom - p(cs.bottom), box: { h: b.height } };
});

/* ---------- 0.5.0 disc pictures ---------- */
/* No graphics chip: the page's graphics-chip surfaces come back empty, so the app must use its flat
   drawing. Forced from outside, so the app itself has no test switch (Blueprint 0.5.0 §12). */
const noGraphics = context => context.addInitScript(() => {
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /^(webgl2?|experimental-webgl)$/.test(type) ? null : get.call(this, type, ...rest); };
});
/* Counts the graphics-chip surfaces the page makes (window.__surfaces) and keeps them (window.__gl). */
const countSurfaces = context => context.addInitScript(() => {
  const get = HTMLCanvasElement.prototype.getContext, seen = new WeakSet();
  window.__surfaces = 0; window.__gl = [];
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = get.call(this, type, ...rest);
    if (c && /^(webgl2?|experimental-webgl)$/.test(type) && !seen.has(c)) { seen.add(c); window.__surfaces++; window.__gl.push(c); }
    return c;
  };
});
module.exports = { test, assert, ROOT, DEVICES, ALL_DEVICES, openApp, isTouch, tapAt, tapEl, boxOf, tokenRgb, rgbOf, lum, contrast, hueOf, stateSel, reopen, showWheel, clearPicked, openShelf, hitArea,
  noGraphics, countSurfaces };
