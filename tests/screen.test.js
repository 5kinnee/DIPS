"use strict";
/* Screen checks: open the real app in Edge and use it the way a person does.
   Taps go through the browser's hit-testing (mouse.click / touchscreen.tap at a point),
   so a layer sitting on top of a control fails here even when the control's code is fine. */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png" };

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

async function openApp(device) {
  const context = await browser.newContext(DEVICES[device]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  /* First visit: the offline worker installs, takes over and the page reloads itself once
     (DIPS-023). Open the app again once it is in control, as a returning user would; that
     self-reload can interrupt this navigation, so try again (it happens only once). */
  await page.goto(base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  for (let attempt = 1; ; attempt++) {
    try { await page.goto(base); break; }
    catch (e) { if (attempt === 3 || !/interrupted by another navigation/.test(e.message)) throw e; }
  }
  await page.waitForFunction(() => /^#[0-9a-f]{6}$/.test(document.querySelector("#baseHex").value));
  return { context, page, errors };
}

/* Point on the wheel as a fraction of its box (0.5, 0.5 is the center). */
async function tapWheel(page, device, fx, fy) {
  const box = await page.locator("#pickRing").boundingBox();
  const x = box.x + box.width * fx, y = box.y + box.height * fy;
  if (device === "phone") await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

for (const device of Object.keys(DEVICES)) {
  test(`DIPS-031 (${device}): tapping "Pick on a wheel" sets the disc color and moves the marker`, async () => {
    const { context, page, errors } = await openApp(device);
    try {
      const summary = page.locator("#pickFold summary");
      if (device === "phone") await summary.tap(); else await summary.click();
      await page.locator("#pickRing").waitFor({ state: "visible" });

      const before = await page.inputValue("#baseHex");
      const seen = [];
      for (const [fx, fy] of [[0.85, 0.5], [0.5, 0.85]]) {
        await tapWheel(page, device, fx, fy);
        const hex = await page.inputValue("#baseHex");
        const marker = await page.getAttribute("#pickSvg circle", "fill");
        assert.strictEqual(marker, hex, "the wheel marker should show the color that was just picked");
        seen.push(hex);
      }
      assert.notStrictEqual(seen[0], before, "first tap on the wheel did not change the disc color");
      assert.notStrictEqual(seen[1], seen[0], "second tap on a different spot did not change the disc color");
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally {
      await context.close();
    }
  });
}
