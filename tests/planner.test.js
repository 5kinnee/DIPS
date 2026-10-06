"use strict";
/* Planner data-safety checks (0.4.0): first visit, custom dye ids and names, windows in step, plain
   messages, the full log, deleted techniques, bad photos and the words people see. Taps go through
   real screen points like screen.test.js. */
const { test, assert, openApp, tapEl, openShelf, stateSel, reopen } = require("./harness.js");

const TABS = ["planner", "notes", "log", "data"];
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error("timed out waiting"); await new Promise(r => setTimeout(r, 100)); }
};
const baseReady = page => page.waitForFunction(() => /^#[0-9a-f]{6}$/.test(document.querySelector("#baseHex").value));
const showTabByTap = (page, device, tab) => tapEl(page, device, `#tabbtn-${tab}`);
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/* A minimal valid log entry for the Test log; the dye is the first one on the shelf. */
const seedEntry = (page, extra) => page.evaluate(async extra => {
  const db = await window.claude.use("db"), d = state.dyes[0];
  const r = await db.collection("tests").add({
    date: "2026-01-01", createdAt: new Date().toISOString(),
    disc: { hex: "#f2dc3c", name: "yellow" }, plastic: { brand: "Innova", name: "Star / Shimmer", rating: "-", translucent: false },
    tech: "floetrol", pattern: "cells", depth: 0.8, dyes: [{ id: d.id, code: d.code, name: d.name, hex: d.hex, recipe: null }], closer: "", ...extra
  });
  return r.id;
}, extra || {});

const seedTechnique = (page, extra) => page.evaluate(async extra => {
  const db = await window.claude.use("db"), now = new Date().toISOString();
  const r = await db.collection("techniques").add({ name: "Zed wave", pattern: "swirl", base: "floetrol", createdAt: now, updatedAt: now, ...extra });
  return r.id;
}, extra || {});

test("DIPS-023: a first visit does not reload the page when the offline worker takes over", async () => {
  const { context: c0, page: p0 } = await openApp("computer");
  const url = p0.url();
  const fresh = await c0.browser().newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await fresh.newPage();
    /* Count page loads: the offline worker can take over before the page is ready, so a marker set
       afterwards would survive a reload that already happened. */
    let loads = 0;
    page.on("load", () => { loads++; });
    await page.goto(url);
    await baseReady(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(1000);
    await baseReady(page);
    assert.strictEqual(loads, 1, "the page reloaded itself on a first visit");
  } finally {
    await fresh.close();
    await c0.close();
  }
});

test("DIPS-023: accepting an update reloads a tab that was opened on a first visit, once", async () => {
  const { context: c0, page: p0 } = await openApp("computer");
  const url = p0.url();
  const fresh = await c0.browser().newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await fresh.newPage();
    let loads = 0;
    page.on("load", () => { loads++; });
    await page.goto(url);
    await baseReady(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(1000);
    assert.strictEqual(loads, 1, "the first visit should not have reloaded");
    /* No second worker file exists here, so the update bar is shown by hand and the worker taking
       over is the browser's own event, fired twice to show the page reloads only once. */
    await page.evaluate(() => { document.getElementById("updateBar").hidden = false; });
    await tapEl(page, "computer", "#updateBtn");
    await page.evaluate(() => { navigator.serviceWorker.dispatchEvent(new Event("controllerchange")); navigator.serviceWorker.dispatchEvent(new Event("controllerchange")); });
    await until(() => loads >= 2);
    await page.waitForTimeout(1000);
    await baseReady(page);
    assert.strictEqual(loads, 2, "accepting the update should reload the page exactly once");
  } finally {
    await fresh.close();
    await c0.close();
  }
});

for (const device of ["computer", "phone"]) {
  test(`DIPS-014 (${device}): new dyes and mixes get random custom ids and old numbered ids keep working`, async () => {
    const { context, page, errors } = await openApp(device);
    try {
      await page.evaluate(() => localStorage.setItem("discdye.custom", JSON.stringify([{ id: "custom-7", code: "Custom", name: "Old one", hex: "#123456", recipe: null }])));
      await reopen(page);
      assert.ok(await page.evaluate(() => state.dyes.some(d => d.id === "custom-7" && d.name === "Old one")), "a saved custom-7 dye was lost");

      await openShelf(page, device);
      await tapEl(page, device, "#cdAdd");
      await page.waitForFunction(() => state.dyes.filter(d => d.fam === "c").length === 2);
      await tapEl(page, device, "#cdAdd");
      await page.waitForFunction(() => state.dyes.filter(d => d.fam === "c").length === 3);
      await tapEl(page, device, "#mixAdd");
      await page.waitForFunction(() => state.dyes.filter(d => d.fam === "c").length === 4);
      const ids = await page.evaluate(() => state.dyes.filter(d => d.fam === "c" && d.id !== "custom-7").map(d => d.id));
      for (const id of ids) assert.match(id, /^custom-[0-9a-f]{8}$/, `${id} is not a random custom id`);
      assert.strictEqual(new Set(ids).size, ids.length, "two new dyes shared an id");
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally {
      await context.close();
    }
  });
}

test("DIPS-036: an unnamed custom dye is named for its color, never with a hex code, and a repeat gets 2, 3", async () => {
  const { context, page } = await openApp("computer");
  try {
    await openShelf(page, "computer");
    for (let n = 1; n <= 3; n++) {
      await tapEl(page, "computer", "#cdAdd");
      await page.waitForFunction(k => state.dyes.filter(d => d.fam === "c").length === k, n);
    }
    const names = await page.evaluate(() => state.dyes.filter(d => d.fam === "c").map(d => d.name));
    assert.ok(names.every(n => !n.includes("#")), `a name shows a hex code: ${names}`);
    assert.match(names[0], /^Custom [a-z ]+$/, "the first name should be Custom plus the color name");
    assert.deepStrictEqual(names.slice(1), [`${names[0]} 2`, `${names[0]} 3`]);
  } finally {
    await context.close();
  }
});

for (const device of ["computer", "phone"]) {
  test(`DIPS-017 (${device}): a second window sees the shelf and custom dyes another window changed`, async () => {
    const { context, page, errors } = await openApp(device);
    try {
      const page2 = await context.newPage();
      await page2.goto(page.url());
      await baseReady(page2);
      const picks = await stateSel(page2);
      assert.ok(picks.length > 0, "the second window should start with a pick");

      await openShelf(page, device);
      await tapEl(page, device, "#shelf .jar");
      await page2.waitForFunction(() => state.owned.size === 1 && document.querySelector("#shelfTitle").textContent === "My dye shelf (1)");

      await tapEl(page, device, "#cdAdd");
      await page2.waitForFunction(() => state.dyes.some(d => d.fam === "c") && !!document.querySelector("#shelf .cfam .jar"));
      assert.deepStrictEqual(await stateSel(page2), picks, "the second window lost its picks");
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally {
      await context.close();
    }
  });
}

test("DIPS-018: a full device and a failed save each get a plain message", async () => {
  const { context, page } = await openApp("computer");
  try {
    const failWith = code => page.evaluate(code => {
      db.collection = () => ({ add: async () => { throw { code }; } });
    }, code);
    const hint = () => page.locator("#logBtnHint").textContent();

    await failWith("quota_exceeded");
    await tapEl(page, "computer", "#logBtn");
    await page.waitForFunction(() => /out of space/.test(document.querySelector("#logBtnHint").textContent));
    assert.match(await hint(), /out of space for DIPS/);

    await failWith("unavailable");
    await tapEl(page, "computer", "#logBtn");
    await page.waitForFunction(() => /Couldn't save/.test(document.querySelector("#logBtnHint").textContent));
    assert.doesNotMatch(await hint(), /out of space/);
  } finally {
    await context.close();
  }
});

test("DIPS-019: the Test log shows every entry, 301 of 301", async () => {
  const { context, page } = await openApp("computer");
  try {
    await page.evaluate(async () => {
      const db = await window.claude.use("db"), d = state.dyes[0];
      for (let i = 0; i < 301; i++) {
        await db.collection("tests").add({
          date: "2026-01-01", createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
          disc: { hex: "#f2dc3c", name: "yellow" }, plastic: { brand: "Innova", name: "Star / Shimmer", rating: "-", translucent: false },
          tech: "floetrol", pattern: "cells", depth: 0.8, dyes: [{ id: d.id, code: d.code, name: d.name, hex: d.hex, recipe: null }], closer: ""
        });
      }
    });
    await showTabByTap(page, "computer", "log");
    await page.waitForFunction(() => document.querySelector("#lfCount").textContent === "301 entries");
    assert.strictEqual(await page.locator("#tally .t b").first().textContent(), "301");
    assert.strictEqual(await page.locator("#logList .entry").count(), 301);
  } finally {
    await context.close();
  }
});

test("Safety net: a log entry stored in a shape the app can't draw shows as a small card that can be deleted, next to the good entries", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await seedEntry(page);
    await seedEntry(page);
    /* Written straight to the database, the way a document from an older release or another path would arrive. */
    await page.evaluate(async () => { await (await window.claude.use("db")).doc("tests/bad1").set({ date: {}, dyes: [null], predicted: "x", createdAt: 5 }); });
    await showTabByTap(page, "computer", "log");
    await page.waitForFunction(() => document.querySelectorAll("#logList .entry").length === 3);
    assert.strictEqual(await page.locator("#logList .entry .empty").count(), 1, "one stand-in card");
    assert.match(await page.locator('.entry[data-id="bad1"]').textContent(), /This entry couldn't be shown\./);
    assert.strictEqual(await page.locator("#logList .entry .ehead").count(), 2, "the two good entries draw as usual");
    await tapEl(page, "computer", '.entry[data-id="bad1"] [data-del]');
    await page.waitForFunction(() => /Tap again to delete/.test(document.querySelector('.entry[data-id="bad1"]').textContent));
    await tapEl(page, "computer", '.entry[data-id="bad1"] [data-del]');
    await page.waitForFunction(() => document.querySelectorAll("#logList .entry").length === 2);
    assert.strictEqual(await page.evaluate(async () => (await (await window.claude.use("db")).doc("tests/bad1").get()).exists), false, "the entry is gone from the database");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally {
    await context.close();
  }
});

test("Safety net: a technique stored in a shape the app can't read shows as a small card that can be deleted, and is left out of the Planner picker", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await seedTechnique(page);
    await page.evaluate(async () => { await (await window.claude.use("db")).doc("techniques/bad1").set({ name: 7, pattern: "swirl", createdAt: 5 }); });
    await page.waitForFunction(() => document.querySelectorAll("#myTechList .tcard").length === 2);
    assert.match(await page.locator("#myTechList").textContent(), /This technique couldn't be shown\./);
    assert.strictEqual(await page.locator("#myTechPick option").count(), 2, "the picker holds the prompt and the good technique only");
    await showTabByTap(page, "computer", "notes");
    await tapEl(page, "computer", '#myTechList [data-tdel="bad1"]');
    await page.waitForFunction(() => /Tap again to delete/.test(document.querySelector("#myTechList").textContent));
    await tapEl(page, "computer", '#myTechList [data-tdel="bad1"]');
    await page.waitForFunction(() => document.querySelectorAll("#myTechList .tcard").length === 1);
    assert.doesNotMatch(await page.locator("#myTechList").textContent(), /couldn't be shown/);
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally {
    await context.close();
  }
});

test("DIPS-025: Load in planner falls back to Floetrol bed when the entry's technique was deleted", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const techId = await seedTechnique(page);
    await page.waitForFunction(id => !!techInfo("my:" + id), techId);
    await seedEntry(page, { tech: "my:" + techId, techName: "Zed wave", pattern: "swirl" });
    await page.evaluate(id => window.claude.use("db").then(db => db.doc("techniques/" + id).delete()), techId);
    await page.waitForFunction(id => !techInfo("my:" + id), techId);

    await tapEl(page, "computer", '#techSeg [data-tech="hotdip"]');
    await page.waitForFunction(() => state.tech === "hotdip");
    await showTabByTap(page, "computer", "log");
    await tapEl(page, "computer", ".entry [data-load]");
    await page.waitForFunction(() => !document.querySelector("#tab-planner").hidden);
    assert.strictEqual(await page.evaluate(() => state.tech), "floetrol", "the Planner kept the technique it had");
    assert.strictEqual(await page.evaluate(() => state.pattern), "cells");
    assert.match(await page.locator("#logBtnHint").textContent(), /technique was deleted, so DIPS used Floetrol bed/);
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally {
    await context.close();
  }
});

test("DIPS-025: a saved technique of mine is still restored when the app reopens", async () => {
  const { context, page } = await openApp("computer");
  try {
    const techId = await seedTechnique(page);
    await page.waitForFunction(id => !!techInfo("my:" + id), techId);
    await page.selectOption("#myTechPick", "my:" + techId);
    await page.waitForFunction(id => state.tech === "my:" + id, techId);
    await reopen(page);
    await page.waitForFunction(id => state.tech === "my:" + id, techId);
    assert.strictEqual(await page.evaluate(() => state.pattern), "swirl");
  } finally {
    await context.close();
  }
});

test("DIPS-027: a file that is not a photo in Match from a photo shows a hint and keeps the earlier photo", async () => {
  const { context, page } = await openApp("computer");
  try {
    await tapEl(page, "computer", "summary:has-text('Match from a photo')");
    const original = await page.locator("#photoHint").textContent();
    await page.setInputFiles("#photoIn", { name: "ok.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await page.waitForFunction(() => !document.querySelector("#photoCv").hidden);

    await page.setInputFiles("#photoIn", { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from("this is not an image") });
    await page.waitForFunction(() => /couldn't be opened/.test(document.querySelector("#photoHint").textContent));
    assert.strictEqual(await page.evaluate(() => document.querySelector("#photoCv").hidden), false, "the earlier photo was dropped");
    assert.notStrictEqual(await page.locator("#photoHint").textContent(), original);
  } finally {
    await context.close();
  }
});

test("DIPS-021/029: no tab shows claude.ai-era or technical wording", async () => {
  const { context, page } = await openApp("computer");
  try {
    await seedEntry(page, { by: "other-person" });
    await seedTechnique(page, { by: "other-person" });
    await page.waitForFunction(() => document.querySelector("#myTechList [data-by]") && document.querySelector("#logList [data-by]"));
    const banned = /\bJSON\b|everyone who uses|edit access|in this view|this page|\bhex\b|someone/i;
    for (const tab of TABS) {
      await showTabByTap(page, "computer", tab);
      if (tab === "data") await page.waitForFunction(() => document.querySelector("#installState").textContent !== "Checking…");
      const text = await page.evaluate(t => document.querySelector("#tab-" + t).textContent, tab);
      assert.doesNotMatch(text, banned, `the ${tab} tab shows ${text.match(banned) && text.match(banned)[0]}`);
    }
  } finally {
    await context.close();
  }
});

test("DIPS-029: the disc color box and the mix swatch name no hex code", async () => {
  const { context, page } = await openApp("computer");
  try {
    assert.strictEqual(await page.getAttribute("#baseHex", "aria-label"), "Disc color code");
    assert.doesNotMatch(await page.getAttribute("#mixOut", "title"), /#[0-9a-f]{6}|hex/i);
  } finally {
    await context.close();
  }
});

for (const device of ["computer", "phone"]) {
  test(`DIPS-029 (${device}): the copy fallback says what to do on this kind of device`, async () => {
    const { context, page } = await openApp(device);
    try {
      await showTabByTap(page, device, "log");
      await tapEl(page, device, "#sheetFold > summary");
      await page.waitForFunction(() => document.querySelector("#sheetFold").open);
      await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => Promise.reject(new Error("blocked")) }));
      await tapEl(page, device, "#sheetCopy");
      await page.waitForFunction(() => /selected/.test(document.querySelector("#sheetMsg").textContent));
      const msg = await page.locator("#sheetMsg").textContent();
      if (device === "phone") {
        assert.match(msg, /touch and hold/);
        assert.doesNotMatch(msg, /Ctrl/);
      } else {
        assert.match(msg, /press Ctrl and C together/);
        assert.doesNotMatch(msg, /touch and hold/);
      }
    } finally {
      await context.close();
    }
  });
}

/* ---------- 0.5.0 Part 2: own photo patterns, the Test log form, every pattern on every bed,
   the printable sheet, bench figures (Story 0.5.0, Blueprint 0.5.0 §7.2-7.5, 9, 11) ---------- */
const fs = require("fs");
const path = require("path");
const { clearPicked, boxOf } = require("./harness.js");
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const getDocP = (page, p) => page.evaluate(async p => { const s = await (await window.claude.use("db")).doc(p).get(); return s.exists ? s.data() : null; }, p);
const countIn = (page, store) => page.evaluate(st => new Promise((res, rej) => {
  const r = indexedDB.open("dips");
  r.onerror = () => rej(r.error);
  r.onsuccess = () => { const d = r.result, q = d.transaction(st).objectStore(st).count(); q.onsuccess = () => { d.close(); res(q.result); }; q.onerror = () => rej(q.error); };
}), store);
const blobCount = page => countIn(page, "blobs");
const patternDocs = page => page.evaluate(async () => (await (await window.claude.use("db")).collection("patterns").get()).docs.map(s => ({ id: s.id, ...s.data() })));
/* A test photo made in the page: green with a red circle, as PNG bytes. */
const pngOf = (page, w, h) => page.evaluate(([w, h]) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.fillStyle = "#2a7a3a"; x.fillRect(0, 0, w, h); x.fillStyle = "#c33"; x.beginPath(); x.arc(w / 2, h / 2, Math.min(w, h) / 3, 0, 7); x.fill();
  return c.toDataURL("image/png").split(",")[1];
}, [w, h]).then(b => Buffer.from(b, "base64"));
/* An own photo pattern stored the way the app stores one (a photo in assets, then the pattern doc). */
const seedOwnPattern = (page, name) => page.evaluate(async name => {
  const db = await window.claude.use("db"), assets = await window.claude.use("assets");
  const c = document.createElement("canvas"); c.width = c.height = 96;
  const x = c.getContext("2d"); x.fillStyle = "#d02020"; x.fillRect(0, 0, 96, 48); x.fillStyle = "#2040d0"; x.fillRect(0, 48, 96, 48);
  const ph = await assets.upload(await new Promise(r => c.toBlob(r, "image/png")));
  const ref = await db.collection("patterns").add({ name, photo: ph.id, by: null, createdAt: new Date().toISOString() });
  return { id: ref.id, key: "own:" + ref.id, photo: ph.id };
}, name);
const openMore = async (page, device) => {
  if (!(await page.evaluate(() => document.querySelector("#morePats").open))) await tapEl(page, device, "#morePats > summary");
  await page.waitForFunction(() => document.querySelector("#morePats").open);
};
const pickN = async (page, device, n) => {
  await clearPicked(page, device);
  const ids = await page.$$eval(".dye", (els, n) => els.slice(0, n).map(e => e.dataset.dye), n);
  for (const id of ids) { await tapEl(page, device, `.dye[data-dye="${id}"]`); await page.waitForFunction(id => state.sel.includes(id), id); }
  assert.deepStrictEqual(await stateSel(page), ids);
  return ids;
};
const slotValues = (page, form) => page.$$eval(`${form} select[data-dyeslot]`, ss => ss.map(s => s.value));
const ink = (page, sel) => page.$eval(sel, cv => { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n++; return n / (cv.width * cv.height); });

/* ----- C. own photo patterns (AC-23..AC-29) ----- */
test("AC-23..AC-28 (computer, mouse): add my own photo: bad files give the photo message, the line-up starts centered, drags and zooms, Use this saves a square photo and the pattern, Delete takes two taps and removes both", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    await openMore(page, "computer");
    const blobs0 = await blobCount(page);
    for (const f of [{ name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("this is not a photo") }, { name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from("ftypheic not decodable here") }]) {
      await page.evaluate(() => { document.querySelector("#ownMsg").textContent = ""; });
      await page.setInputFiles("#ownIn", f);
      await page.waitForFunction(() => /Use a JPG, PNG or WebP photo/.test(document.querySelector("#ownMsg").textContent));
      assert.ok(await page.locator("#lineup").isHidden(), `${f.name}: the line-up should not open`);
    }
    assert.strictEqual(await blobCount(page), blobs0, "a photo that can't be read must add nothing");

    await page.setInputFiles("#ownIn", { name: "disc.png", mimeType: "image/png", buffer: await pngOf(page, 2400, 1800) });
    await page.locator("#lineup").waitFor({ state: "visible" });
    const start = await page.evaluate(() => ({ w: LINE.img.width, h: LINE.img.height, zoom: LINE.zoom, cx: LINE.cx, cy: LINE.cy, name: document.querySelector("#ownName").value, max: document.querySelector("#ownName").maxLength }));
    assert.deepStrictEqual([start.w, start.h], [1600, 1200], "the photo should be worked on shrunk to 1600 px on its long side");
    assert.deepStrictEqual([start.zoom, start.cx, start.cy], [1, 800, 600], "the line-up should start centered, the circle fitting the short side");
    assert.strictEqual(start.name, "My photo", "a default name should be offered");
    assert.strictEqual(start.max, 40, "names are up to 40 characters");
    assert.strictEqual(await blobCount(page), blobs0, "nothing is stored before Use this");

    const b = await boxOf(page, "#lineCv"), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.wheel(0, -200);
    await page.waitForFunction(() => LINE.zoom > 1);
    const z = await page.evaluate(() => LINE.zoom);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy + 30, { steps: 8 }); await page.mouse.up();
    const moved = await page.evaluate(() => [LINE.cx, LINE.cy]);
    assert.ok(moved[0] < 800 - 20 && moved[1] < 600 - 10, `dragging should move the photo under the circle, now at ${moved}`);
    await tapEl(page, "computer", "#lineIn");
    await page.waitForFunction(z => LINE.zoom > z, z);

    await page.fill("#ownName", "Sunset swirl");
    await tapEl(page, "computer", "#lineUse");
    await page.waitForFunction(() => /^own:/.test(state.pattern));
    const [doc] = await patternDocs(page);
    assert.strictEqual(doc.name, "Sunset swirl");
    assert.match(doc.photo, /^[0-9a-f]{32}$/);
    assert.strictEqual(await blobCount(page), blobs0 + 1, "one photo file for the pattern");
    const size = await page.evaluate(async id => { const u = await (await window.claude.use("assets")).url(id), im = new Image(); im.src = u; await im.decode(); return [im.naturalWidth, im.naturalHeight]; }, doc.photo);
    assert.strictEqual(size[0], size[1], `the saved picture should be square, was ${size}`);
    assert.ok(size[0] <= 1600 && size[0] < 1200, `the saved square is the zoomed circle, at most 1600 px, was ${size[0]}`);
    assert.strictEqual(await page.evaluate(() => state.pattern), "own:" + doc.id, "the new pattern should be on the disc");
    await page.waitForFunction(() => DiscPreview.photoState(state.pattern) === "ready");
    assert.match(await page.locator("#roles").textContent(), /^Sunset swirl: Color 1 fills the biggest area of the photo.*Your photo\.$/, "the roles line credits Your photo");
    assert.match(await page.locator("#ownPats").textContent(), /Sunset swirl\s*Your photo/);
    assert.ok(await page.locator("#lineup").isHidden(), "the line-up closes after saving");

    /* Every bed lists it (AC-25, AC-22). */
    for (const bed of ["spin", "hotdip"]) {
      await tapEl(page, "computer", `#techSeg [data-tech="${bed}"]`);
      await page.waitForFunction(b => state.tech === b, bed);
      await openMore(page, "computer");
      assert.strictEqual(await page.locator(`#ownPats [data-pat="own:${doc.id}"]`).count(), 1, `${bed}: the own photo should be under More patterns`);
    }
    await tapEl(page, "computer", `#ownPats [data-pat="own:${doc.id}"]`);
    await page.waitForFunction(id => state.pattern === "own:" + id, doc.id);

    await tapEl(page, "computer", `#ownPats [data-owndel="${doc.id}"]`);
    await page.waitForFunction(() => /Tap again to delete/.test(document.querySelector("#ownPats").textContent));
    assert.strictEqual((await patternDocs(page)).length, 1, "one tap must not delete");
    await tapEl(page, "computer", `#ownPats [data-owndel="${doc.id}"]`);
    await page.waitForFunction(() => document.querySelectorAll("#ownPats .ownrow").length === 0);
    assert.strictEqual((await patternDocs(page)).length, 0, "the pattern should be gone");
    await page.waitForFunction(() => /Photo pattern deleted\./.test(document.querySelector("#ownMsg").textContent));
    assert.strictEqual(await blobCount(page), blobs0, "its photo file should be gone too");
    assert.strictEqual(await page.evaluate(() => state.pattern), "full", "the Planner falls back to the bed's first usual pattern");
    assert.match(await page.locator("#logBtnHint").textContent(), /That photo pattern was deleted, so DIPS used Full dip\./);
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("AC-27: Cancel stores nothing, and a pattern that fails to save leaves no photo file behind", async () => {
  const { context, page } = await openApp("computer");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    await openMore(page, "computer");
    const blobs0 = await blobCount(page), png = await pngOf(page, 600, 400);
    await page.setInputFiles("#ownIn", { name: "a.png", mimeType: "image/png", buffer: png });
    await page.locator("#lineup").waitFor({ state: "visible" });
    await tapEl(page, "computer", "#lineCancel");
    await page.locator("#lineup").waitFor({ state: "hidden" });
    assert.strictEqual(await blobCount(page), blobs0, "Cancel must leave no photo file");
    assert.strictEqual((await patternDocs(page)).length, 0);

    await page.evaluate(() => { const orig = db.collection.bind(db); db.collection = c => c === "patterns" ? { add: async () => { throw { code: "unavailable" }; } } : orig(c); });
    await page.setInputFiles("#ownIn", { name: "b.png", mimeType: "image/png", buffer: png });
    await page.locator("#lineup").waitFor({ state: "visible" });
    await tapEl(page, "computer", "#lineUse");
    await page.waitForFunction(() => /Couldn't save\. Try again in a moment\./.test(document.querySelector("#ownMsg").textContent));
    await page.waitForTimeout(500);
    assert.strictEqual(await blobCount(page), blobs0, "a failed save must remove the photo it stored");
    assert.ok(await page.locator("#lineup").isVisible(), "the line-up stays open so the person can try again");
  } finally { await context.close(); }
});

test("AC-24, AC-78 (phone360, touch): the line-up moves with one finger and zooms with two, and every new control is finger-sized with no sideways scroll", async () => {
  const { context, page, errors } = await openApp("phone360");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    await seedOwnPattern(page, "Tiny test photo");
    await page.waitForFunction(() => document.querySelectorAll("#ownPats .ownrow").length === 1);
    await openMore(page, "phone360");
    await page.setInputFiles("#ownIn", { name: "p.png", mimeType: "image/png", buffer: await pngOf(page, 900, 1200) });
    await page.locator("#lineup").waitFor({ state: "visible" });
    const b = await boxOf(page, "#lineCv"), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const cdp = await context.newCDPSession(page);
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    /* Zoom in first (two fingers apart), so the photo has room to move sideways too. */
    await touch("touchStart", [[cx - 30, cy], [cx + 30, cy]]);
    for (let i = 1; i <= 6; i++) await touch("touchMove", [[cx - 30 - i * 10, cy], [cx + 30 + i * 10, cy]]);
    await touch("touchEnd", []);
    await page.waitForFunction(() => LINE.zoom > 1.5);
    const before = await page.evaluate(() => [LINE.cx, LINE.cy]);
    await touch("touchStart", [[cx, cy]]);
    for (let i = 1; i <= 6; i++) await touch("touchMove", [[cx - i * 8, cy - i * 6]]);
    await touch("touchEnd", []);
    const after = await page.evaluate(() => [LINE.cx, LINE.cy]);
    assert.ok(after[0] > before[0] + 5 && after[1] > before[1] + 5, `one finger should move the photo: ${before} -> ${after}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "the page scrolls sideways");
    for (const sel of ["#morePats > summary", "#ownAdd", "#lineOut", "#lineIn", "#lineUse", "#lineCancel", "#ownName", "#ownPats [data-pat]", "#ownPats [data-owndel]"]) {
      const h = (await boxOf(page, sel)).height;
      assert.ok(h >= 40, `${sel} is ${h}px tall on a 360px phone`);
    }
    const fonts = await page.$$eval("#morePats *", els => els.filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => parseFloat(getComputedStyle(e).fontSize)));
    assert.ok(fonts.every(f => f >= 12), `text under 12px under More patterns: ${fonts.filter(f => f < 12)}`);
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("AC-78 (light and dark): the own photo controls use the one tap blue and Delete stays brown-red", async () => {
  for (const scheme of ["light", "dark"]) {
    const { context, page } = await openApp("computer", { colorScheme: scheme });
    try {
      await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
      await seedOwnPattern(page, "Color check");
      await page.waitForFunction(() => document.querySelectorAll("#ownPats .ownrow").length === 1);
      const got = await page.evaluate(() => {
        const t = document.createElement("i"); t.style.color = "var(--tap)"; document.body.appendChild(t);
        const m = document.createElement("i"); m.style.color = "var(--mud)"; document.body.appendChild(m);
        const c = s => getComputedStyle(document.querySelector(s));
        const r = { tap: getComputedStyle(t).color, mud: getComputedStyle(m).color, add: c("#ownAdd").color, addBorder: c("#ownAdd").borderTopColor,
          zoom: c("#lineIn").color, pat: c("#ownPats [data-pat]").color, del: c("#ownPats [data-owndel]").color, useBg: c("#lineUse").backgroundColor };
        t.remove(); m.remove(); return r;
      });
      for (const k of ["add", "addBorder", "zoom", "pat", "useBg"]) assert.strictEqual(got[k], got.tap, `${scheme}: ${k} should be the tap blue`);
      assert.strictEqual(got.del, got.mud, `${scheme}: Delete should be brown-red`);
    } finally { await context.close(); }
  }
});

test("AC-29, AC-59, AC-60: a log entry made with an own photo keeps its name after the photo is deleted; Edit and Save keep it; Load in planner, a saved setup and a technique fall back", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    const own = await seedOwnPattern(page, "Blue lagoon");
    await page.waitForFunction(k => patKnown(k), own.key);
    await openMore(page, "computer");
    await tapEl(page, "computer", `#ownPats [data-pat="${own.key}"]`);
    await page.waitForFunction(k => state.pattern === k, own.key);
    await tapEl(page, "computer", "#logBtn");
    await page.waitForFunction(() => !document.querySelector("#tab-log").hidden && document.querySelectorAll("#logList .entry").length === 1);
    const id = await page.evaluate(() => logDocs[0].id);
    let doc = await getDocP(page, "tests/" + id);
    assert.strictEqual(doc.pattern, own.key);
    assert.strictEqual(doc.patternName, "Blue lagoon", "the entry should record the photo pattern's name (AC-60)");
    const techId = await seedTechnique(page, { name: "Lagoon method", pattern: own.key });

    /* Delete the photo pattern. */
    await page.evaluate(async o => { await (await window.claude.use("db")).doc("patterns/" + o.id).delete(); await (await window.claude.use("assets")).delete(o.photo); }, own);
    await page.waitForFunction(k => !patKnown(k), own.key);
    assert.match(await page.locator(".entry .ehead h3").textContent(), /^Floetrol bed: Blue lagoon$/, "the entry still shows the pattern's name");

    await tapEl(page, "computer", ".entry [data-edit]");
    await page.locator(".eform").waitFor({ state: "visible" });
    const sel = await page.$eval('.eform select[name="pattern"]', s => ({ v: s.value, t: s.selectedOptions[0].textContent }));
    assert.deepStrictEqual(sel, { v: own.key, t: "Blue lagoon (as logged)" });
    await tapEl(page, "computer", '.eform [type="submit"]');
    await page.waitForFunction(() => /Changes saved/.test(document.querySelector("#logStatus").textContent));
    doc = await getDocP(page, "tests/" + id);
    assert.deepStrictEqual([doc.pattern, doc.patternName], [own.key, "Blue lagoon"], "saving must keep the pattern as logged");

    await showTabByTap(page, "computer", "planner");
    await tapEl(page, "computer", '#techSeg [data-tech="hotdip"]');
    await page.waitForFunction(() => state.tech === "hotdip");
    await showTabByTap(page, "computer", "log");
    await tapEl(page, "computer", ".entry [data-load]");
    await page.waitForFunction(() => !document.querySelector("#tab-planner").hidden);
    assert.deepStrictEqual(await page.evaluate(() => [state.tech, state.pattern]), ["floetrol", "cells"], "Load in planner falls back to the bed's first usual pattern");
    assert.match(await page.locator("#logBtnHint").textContent(), /That photo pattern was deleted, so DIPS used Cells\./);

    /* A saved setup that used it. */
    await page.evaluate(k => { const s = JSON.parse(localStorage.getItem("discdye.setup")); s.tech = "spin"; s.pattern = k; localStorage.setItem("discdye.setup", JSON.stringify(s)); }, own.key);
    await reopen(page);
    await page.waitForFunction(() => patsLoaded && state.pattern === "spin");
    assert.match(await page.locator("#logBtnHint").textContent(), /That photo pattern was deleted, so DIPS used Spin rings\./);

    /* A technique that used it: Swirl picture, and it still opens. */
    await showTabByTap(page, "computer", "notes");
    const card = `#mt-${techId}`;
    await page.locator(`${card} canvas.thumb`).waitFor();
    assert.strictEqual(await page.getAttribute(`${card} canvas.thumb`, "data-pattern"), "swirl");
    await tapEl(page, "computer", `${card} > summary`);
    await page.waitForFunction(s => document.querySelector(s).open, card);
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("AC-26: an own photo pattern whose photo is missing draws Swirl and says so under the disc (Decision C)", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    const own = await page.evaluate(async () => {
      const r = await (await window.claude.use("db")).collection("patterns").add({ name: "Lost photo", photo: "c".repeat(32), by: null, createdAt: "2026-01-01" });
      return "own:" + r.id;
    });
    await page.waitForFunction(k => patKnown(k), own);
    await openMore(page, "computer");
    await tapEl(page, "computer", `#ownPats [data-pat="${own}"]`);
    await page.waitForFunction(() => DiscPreview.photoState(state.pattern) === "missing");
    await page.waitForFunction(() => /photo is missing, so the disc shows Swirl\. Delete it and add the photo again\./.test(document.querySelector("#roles").textContent));
    assert.ok(await ink(page, "#disc") > 0.4, "the disc must not be blank");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

/* ----- G. every pattern on every bed in the Test log and My techniques (AC-58..AC-61) ----- */
test("AC-58, AC-59: a Floetrol entry with Starburst loads as Starburst, its form lists the usual patterns then Other patterns, and saving keeps Starburst", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const id = await seedEntry(page, { pattern: "starburst" });
    await showTabByTap(page, "computer", "log");
    await page.waitForFunction(() => document.querySelectorAll("#logList .entry").length === 1);
    assert.match(await page.locator(".entry .ehead h3").textContent(), /Floetrol bed: Starburst/);
    await tapEl(page, "computer", ".entry [data-edit]");
    await page.locator(".eform").waitFor({ state: "visible" });
    const opts = await page.$eval('.eform select[name="pattern"]', s => ({ top: [...s.children].filter(c => c.tagName === "OPTION").map(o => o.value), group: s.querySelector("optgroup")?.label, other: [...s.querySelectorAll("optgroup option")].map(o => o.value), value: s.value }));
    assert.deepStrictEqual(opts.top, ["cells", "swirl", "river"], "the bed's usual patterns come first");
    assert.strictEqual(opts.group, "Other patterns");
    for (const p of ["starburst", "spin", "stencil", "photo-cells", "photo-flames", "photo-spoked"]) assert.ok(opts.other.includes(p), `Other patterns should list ${p}`);
    assert.strictEqual(opts.value, "starburst");
    await tapEl(page, "computer", '.eform [type="submit"]');
    await page.waitForFunction(() => /Changes saved/.test(document.querySelector("#logStatus").textContent));
    assert.strictEqual((await getDocP(page, "tests/" + id)).pattern, "starburst", "saving without changing the pattern must keep it");
    await tapEl(page, "computer", ".entry [data-load]");
    await page.waitForFunction(() => !document.querySelector("#tab-planner").hidden);
    assert.deepStrictEqual(await page.evaluate(() => [state.tech, state.pattern]), ["floetrol", "starburst"]);
    assert.ok(await page.evaluate(() => document.querySelector("#morePats").open), "More patterns opens for an extra pattern");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("AC-60: a log entry made with a shipped photo pattern records its name, and the Test log shows it", async () => {
  const { context, page } = await openApp("computer");
  try {
    await openMore(page, "computer");
    await tapEl(page, "computer", '#patMore [data-pat="photo-cells"]');
    await page.waitForFunction(() => state.pattern === "photo-cells");
    await tapEl(page, "computer", "#logBtn");
    await page.waitForFunction(() => !document.querySelector("#tab-log").hidden && document.querySelectorAll("#logList .entry").length === 1);
    const id = await page.evaluate(() => logDocs[0].id), doc = await getDocP(page, "tests/" + id);
    assert.deepStrictEqual([doc.pattern, doc.patternName], ["photo-cells", "Cells photo"]);
    assert.match(await page.locator(".entry .ehead h3").textContent(), /Floetrol bed: Cells photo/);
  } finally { await context.close(); }
});

test("AC-61: My techniques lists every pattern for the preview (base's usual first), keeps an own photo pattern on save, draws it, and the Style filter names it", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    const own = await seedOwnPattern(page, "Marble photo");
    await page.waitForFunction(k => patKnown(k), own.key);
    await seedTechnique(page, { name: "Other one" });
    await showTabByTap(page, "computer", "notes");
    await tapEl(page, "computer", "#myTechAdd");
    const form = 'form[data-techform="new"]';
    await page.locator(form).waitFor({ state: "visible" });
    await page.selectOption(`${form} select[name="base"]`, "hotdip");
    const all = await page.$$eval(`${form} select[name="pattern"] option`, os => os.map(o => o.value));
    for (const p of ["spin", "cells", "stencil", "photo-flames", own.key]) assert.ok(all.includes(p), `the preview pattern list should include ${p}`);
    await page.fill(`${form} input[name="name"]`, "Marble method");
    await page.selectOption(`${form} select[name="pattern"]`, own.key);
    await tapEl(page, "computer", `${form} [type="submit"]`);
    await page.waitForFunction(() => /Added "Marble method"/.test(document.querySelector("#myTechStatus").textContent));
    const t = await page.evaluate(() => myTechDocs.map(s => s.data()).find(d => d.name === "Marble method"));
    assert.strictEqual(t.pattern, own.key, "the chosen own photo pattern must be kept");
    const tid = await page.evaluate(() => myTechDocs.find(s => s.data().name === "Marble method").id);
    assert.strictEqual(await page.getAttribute(`#mt-${tid} canvas.thumb`, "data-pattern"), own.key);
    await page.waitForFunction(k => DiscPreview.photoState(k) === "ready", own.key);
    assert.ok(await ink(page, `#mt-${tid} canvas.thumb`) > 0.3, "the technique's picture should draw");
    const styles = await page.$$eval("#tfPat option", os => os.map(o => o.textContent));
    assert.ok(styles.includes("Marble photo"), `the Style filter should name the photo pattern: ${styles}`);
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("Thumbnails: a technique with a photo listed before one without does not stop the other pictures drawing", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await seedTechnique(page, { name: "Aaa with photo", photo: "d".repeat(32) });
    const id = await seedTechnique(page, { name: "Bbb drawn", pattern: "river" });
    await page.waitForFunction(() => document.querySelectorAll("#myTechList details.tcard").length === 2);
    await showTabByTap(page, "computer", "notes");
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.waitForTimeout(300);
    assert.ok(await ink(page, `#mt-${id} canvas.thumb`) > 0.3, "the technique without a photo should have its picture");
    assert.deepStrictEqual(errors, [], "drawing the pictures threw an error");
  } finally { await context.close(); }
});

/* ----- D. the Test log form keeps every dye (AC-41, P0) and the view shows them all (AC-42) ----- */
test("AC-41 (P0): editing an entry with 5 dyes and saving keeps all 5 in order, with predictions worked out for all 5", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const dyes = await page.evaluate(() => state.dyes.slice(10, 15).map(d => ({ id: d.id, code: d.code, name: d.name, hex: d.hex, recipe: null })));
    const id = await seedEntry(page, { dyes, predicted: { multiply: [], darken: [] } });
    await showTabByTap(page, "computer", "log");
    await page.waitForFunction(() => document.querySelectorAll("#logList .entry").length === 1);
    await tapEl(page, "computer", ".entry [data-edit]");
    await page.locator(".eform").waitFor({ state: "visible" });
    assert.deepStrictEqual(await slotValues(page, ".eform"), [...dyes.map(d => d.id), ""], "one slot per dye plus one empty");
    await tapEl(page, "computer", '.eform [type="submit"]');
    await page.waitForFunction(() => /Changes saved/.test(document.querySelector("#logStatus").textContent));
    const doc = await getDocP(page, "tests/" + id);
    assert.deepStrictEqual(doc.dyes.map(d => d.id), dyes.map(d => d.id), "all 5 dyes, in order");
    const want = await page.evaluate(d => withPredictions(JSON.parse(JSON.stringify(d))).predicted, doc);
    assert.strictEqual(doc.predicted.multiply.length, 5);
    assert.ok(doc.predicted.multiply.every(h => /^#[0-9a-f]{6}$/i.test(h)) && doc.predicted.darken.every(h => /^#[0-9a-f]{6}$/i.test(h)), "every dye gets both predictions");
    assert.deepStrictEqual(doc.predicted, want);
    assert.strictEqual(await page.locator(`.entry[data-id="${id}"] .ptable .n`).count(), 5, "the entry view shows all 5 dyes (AC-42)");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("AC-41 (P0), AC-42: Add entry manually from a Planner with 8 dyes shows 8 filled slots, saves all 8, and the entry shows all 8", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const ids = await pickN(page, "computer", 8);
    await showTabByTap(page, "computer", "log");
    await tapEl(page, "computer", "#logAdd");
    const form = '.entry[data-id="new"] .eform';
    await page.locator(form).waitFor({ state: "visible" });
    assert.deepStrictEqual(await slotValues(page, form), ids, "8 filled slots and no empty one at the limit");
    await tapEl(page, "computer", `${form} [type="submit"]`);
    await page.waitForFunction(() => /Entry added/.test(document.querySelector("#logStatus").textContent));
    const doc = await page.evaluate(() => logDocs[0].data());
    assert.deepStrictEqual(doc.dyes.map(d => d.id), ids, "all 8 dyes saved, in order");
    assert.strictEqual(doc.predicted.multiply.length, 8);
    await page.waitForFunction(() => document.querySelectorAll(".entry .ptable .n").length === 8);
    const rows = await page.$$eval(".entry .ptable", ts => ts.map(t => t.querySelectorAll(".c").length));
    assert.deepStrictEqual(rows, [24], "each of the 8 dyes shows In the jar, Multiply and Darken");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("AC-41: choosing a dye in the last slot opens another, and Save keeps it", async () => {
  const { context, page } = await openApp("computer");
  try {
    const [first] = await pickN(page, "computer", 1);
    await showTabByTap(page, "computer", "log");
    await tapEl(page, "computer", "#logAdd");
    const form = '.entry[data-id="new"] .eform';
    await page.locator(form).waitFor({ state: "visible" });
    assert.deepStrictEqual(await slotValues(page, form), [first, ""]);
    const second = await page.evaluate(f => state.dyes.find(d => d.id !== f).id, first);
    await page.selectOption(`${form} select[name="dye1"]`, second);
    await page.waitForFunction(f => document.querySelectorAll(`${f} select[data-dyeslot]`).length === 3, form);
    await tapEl(page, "computer", `${form} [type="submit"]`);
    await page.waitForFunction(() => /Entry added/.test(document.querySelector("#logStatus").textContent));
    assert.deepStrictEqual((await page.evaluate(() => logDocs[0].data())).dyes.map(d => d.id), [first, second]);
  } finally { await context.close(); }
});

/* ----- AC-40: the printable sheet ----- */
test("AC-40: the printable sheet has 8 color lines per disc, stays 72 columns, and prefills 8 dyes and photo pattern names", async () => {
  const { context, page } = await openApp("computer");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    const ids = await pickN(page, "computer", 8);
    const names = await page.evaluate(ids => ids.map(id => state.byId[id].dye.name), ids);
    await openMore(page, "computer");
    await tapEl(page, "computer", '#patMore [data-pat="photo-spoked"]');
    await page.waitForFunction(() => state.pattern === "photo-spoked");
    await showTabByTap(page, "computer", "log");
    await tapEl(page, "computer", "#sheetFold > summary");
    await tapEl(page, "computer", "#sheetPrefill");
    await page.waitForFunction(() => /Spoked starburst photo/.test(document.querySelector("#sheetPre").textContent));
    const lines = (await page.locator("#sheetPre").textContent()).split(/\r?\n/);
    const long = lines.filter(l => l.length > 72);
    assert.deepStrictEqual(long, [], "every line fits 72 columns");
    const colorLines = lines.filter(l => /^ [1-9]\. /.test(l));
    assert.strictEqual(colorLines.length, 16, "8 color lines for each of the 2 discs");
    names.forEach((n, i) => assert.ok(colorLines[i].startsWith(` ${i + 1}. ${n.slice(0, 16)}`), `line ${i + 1} should be ${n}`));
    assert.ok(lines.includes("Pattern: Spoked starburst photo".padEnd(49)), "the Pattern line names the photo pattern");

    const longName = "Sunset over the lake, third try, so good!".slice(0, 40);
    const own = await seedOwnPattern(page, longName);
    await page.waitForFunction(k => patKnown(k), own.key);
    await showTabByTap(page, "computer", "planner");
    await openMore(page, "computer");
    await tapEl(page, "computer", `#ownPats [data-pat="${own.key}"]`);
    await showTabByTap(page, "computer", "log");
    await tapEl(page, "computer", "#sheetPrefill");
    await tapEl(page, "computer", "#sheetPrefill");
    await page.waitForFunction(n => document.querySelector("#sheetPre").textContent.includes("Pattern: " + n), longName);
    assert.ok((await page.locator("#sheetPre").textContent()).split(/\r?\n/).every(l => l.length <= 72), "a 40-character own name still fits");
  } finally { await context.close(); }
});

/* ----- H. bench figures (AC-62..AC-68) ----- */
test("AC-62..AC-68: bench figures: DIPS's own ranges in words without a ProChem dot, ProChem's figures only in a Heads up naming ProChem, lamp and set times, and measure-it-yourself wherever heat is used", async () => {
  const { context, page } = await openApp("computer");
  try {
    const texts = [];
    for (const tab of TABS) {
      await showTabByTap(page, "computer", tab);
      if (tab === "notes") { await tapEl(page, "computer", "#expandAll"); await page.waitForFunction(() => [...document.querySelectorAll("#tab-notes details")].every(d => d.open)); }
      texts.push(await page.evaluate(t => document.querySelector("#tab-" + t).innerText, tab));
    }
    const tech = await page.evaluate(() => Object.values(TECH).flatMap(t => [t.recipe, t.note]));
    const sentences = [...texts, ...tech].join("\n").split(/(?<=[.!?])\s+|\n+/);
    for (const phrase of ["120°F or below", "3-4 drops"]) {
      const hits = sentences.filter(s => s.includes(phrase));
      assert.ok(hits.length > 0, `${phrase} should still appear as ProChem's figure`);
      for (const s of hits) assert.ok(/ProChem/.test(s) && /Heads up/.test(s), `"${phrase}" is not ProChem's figure in a Heads up: ${s}`);
    }
    const all = texts.join("\n");
    assert.doesNotMatch(all, /AI chat says|120-125°F|90 minutes/, "the old AI-chat wording and lamp time are gone");

    const info = await page.evaluate(() => {
      const dd = (card, label) => [...document.querySelectorAll(`${card} .facts dt`)].find(d => d.textContent.trim() === label).nextElementSibling;
      const ownRangeSegments = [...document.querySelectorAll("li, p, dd")].filter(e => !e.querySelector("li, p, dd") && e.textContent.includes("DIPS's own range"))
        .flatMap(e => e.innerHTML.split(/<br\s*\/?>/).filter(s => s.includes("DIPS's own range")));
      return {
        ownRangeSegments,
        safety: [...document.querySelectorAll("#tab-planner .info li")].map(l => l.textContent).find(t => t.includes("120°F")),
        stay: document.querySelector(".rule.safety p").textContent,
        fHeat: dd("#t-floetrol", "Heat").textContent, fSet: dd("#t-floetrol", "Set").textContent, fMix: dd("#t-floetrol", "Mix").innerHTML,
        gHeat: dd("#t-glue", "Heat").textContent, hHeat: dd("#t-hotdip", "Heat").textContent,
        sHeat: dd("#t-spin", "Heat").textContent, cHeat: dd("#t-cream", "Heat").textContent, cSet: dd("#t-cream", "Set").textContent,
        notes: { f: TECH.floetrol.note, g: TECH.glue.note, h: TECH.hotdip.note }, recipe: TECH.floetrol.recipe
      };
    });
    assert.ok(info.ownRangeSegments.length >= 6, "DIPS's own ranges should be labeled in words");
    for (const s of info.ownRangeSegments) assert.doesNotMatch(s, /dot pc/, `a DIPS's own range figure carries the ProChem dot: ${s}`);
    assert.match(info.fMix, /dot pc/, "ProChem's recipe keeps its green dot");
    for (const [what, t] of [["Planner Safety", info.safety], ["Stay safe", info.stay], ["Floetrol heat", info.fHeat], ["Hot dip heat", info.hHeat]]) {
      assert.match(t, /120°F/, `${what}: aim for 120°F`);
      assert.match(t, /115-125°F/, `${what}: working range 115-125°F`);
    }
    for (const [what, t] of [["Planner Safety", info.safety], ["Stay safe", info.stay], ["Floetrol heat", info.fHeat], ["Glue heat", info.gHeat], ["Hot dip heat", info.hHeat], ["Floetrol note", info.notes.f], ["Glue note", info.notes.g], ["Hot dip note", info.notes.h]])
      assert.match(t, /measure the disc/i, `${what}: tell the dyer to measure the disc's temperature`);
    assert.match(info.fHeat, /12-18 inches/);
    const lampSentences = sentences.filter(s => s.includes("12-18 inches"));
    assert.ok(lampSentences.length >= 2, "the lamp distance appears on the Notes card and in the Floetrol note");
    for (const s of lampSentences) assert.match(s, /DIPS's own range/, `a lamp distance is not labeled as DIPS's own range: ${s}`);
    assert.match(info.fSet, /2-4 hours under a heat lamp/);
    assert.match(info.fSet, /24-48 hours without/);
    assert.match(info.notes.f, /12-18 inches/);
    assert.match(info.notes.f, /2-4 hours/);
    assert.match(info.recipe, /3-6 drops/);
    assert.strictEqual(info.sHeat.trim(), "None needed.", "Spin heat is unchanged (Decision G)");
    assert.match(info.cHeat, /^Avoid; heat can collapse the foam\.$/, "Shaving cream heat is unchanged (Decision G)");
    assert.doesNotMatch(info.sHeat + info.cHeat, /measure/i);
    assert.match(info.cSet, /8-24 hours/, "shaving cream set time stays 8-24 hours (AC-65)");

    /* AC-67: form examples. */
    assert.strictEqual((INDEX_HTML.match(/placeholder="e\.g\. 3 hr under a heat lamp"/g) || []).length, 2, "both Set time examples");
    assert.match(INDEX_HTML, /placeholder="e\.g\. Heat lamp 12-18 in, disc at 120°F"/);
    assert.doesNotMatch(INDEX_HTML, /under 120°F"/);

    /* AC-64: a new Floetrol log entry carries the new recipe. */
    await showTabByTap(page, "computer", "planner");
    await tapEl(page, "computer", '#techSeg [data-tech="floetrol"]');
    await tapEl(page, "computer", "#logBtn");
    await page.waitForFunction(() => document.querySelectorAll("#logList .entry").length === 1);
    assert.match(await page.evaluate(() => logDocs[0].data().mix), /3-6 drops of silicone oil/);
  } finally { await context.close(); }
});

/* A remembered own photo pattern or technique waits for its collection; the first renders must not
   overwrite discdye.setup with the stand-in shown meanwhile. */
test("Setup: a remembered own photo pattern or technique survives the first renders before its collection loads", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    const own = await seedOwnPattern(page, "Remembered photo");
    const techId = await seedTechnique(page, { name: "Remembered method", pattern: "swirl" });
    await page.waitForFunction(k => patKnown(k), own.key);
    await page.waitForFunction(id => !!techInfo("my:" + id), techId);
    await page.addInitScript(() => {
      window.__setupWrites = []; const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "discdye.setup") { let early = false; try { early = !patsLoaded || !techLoaded; } catch (e) { early = true; } window.__setupWrites.push({ early, v }); }
        return set.call(this, k, v);
      };
    });
    const scenarios = [
      { what: "own photo pattern", patch: { tech: "floetrol", pattern: own.key }, field: "pattern", want: own.key },
      { what: "technique", patch: { tech: "my:" + techId, pattern: "swirl" }, field: "tech", want: "my:" + techId }
    ];
    for (const sc of scenarios) {
      await page.evaluate(patch => { const s = JSON.parse(localStorage.getItem("discdye.setup")); localStorage.setItem("discdye.setup", JSON.stringify({ ...s, ...patch })); }, sc.patch);
      await reopen(page);
      await page.waitForFunction(() => patsLoaded && techLoaded);
      const writes = await page.evaluate(() => window.__setupWrites);
      for (const w of writes.filter(w => w.early)) assert.strictEqual(JSON.parse(w.v)[sc.field], sc.want, `${sc.what}: an early render overwrote the remembered choice with ${JSON.parse(w.v)[sc.field]}`);
      assert.strictEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("discdye.setup")))[sc.field], sc.want, `${sc.what}: the remembered choice is kept once everything has loaded`);
    }
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

/* ----- AC-77: technical words, extended for 0.5.0 ----- */
test("AC-77: no tab shows graphics or photo-sorting words, with a photo pattern in use and own photos listed", async () => {
  const { context, page } = await openApp("computer");
  try {
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    await seedOwnPattern(page, "Word check");
    await openMore(page, "computer");
    await tapEl(page, "computer", '#patMore [data-pat="photo-flames"]');
    await page.waitForFunction(() => state.pattern === "photo-flames");
    const banned = /WebGL|shader|graphics|canvas|k-means|\bGPU\b/i;
    for (const tab of TABS) {
      await showTabByTap(page, "computer", tab);
      const text = await page.evaluate(t => document.querySelector("#tab-" + t).textContent, tab);
      assert.doesNotMatch(text, banned, `the ${tab} tab shows ${text.match(banned) && text.match(banned)[0]}`);
    }
    const labels = await page.$$eval("[aria-label],[title],[placeholder]", els => els.map(e => [e.getAttribute("aria-label"), e.getAttribute("title"), e.getAttribute("placeholder")].join(" ")).join(" "));
    assert.doesNotMatch(labels, banned, "a label or tooltip uses a technical word");
  } finally { await context.close(); }
});

/* A redraw alone must not save the Planner setup: every setup write schedules a folder save, and in
   0.5.0 the disc drawing becoming ready redraws the Planner (found by D21: such a save overwrote a file). */
test("Setup: a redraw with nothing changed writes no setup and so schedules no folder save; a real change still saves", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const writes = await page.evaluate(() => {
      let n = 0; const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === "discdye.setup") n++; return set.call(this, k, v); };
      try { render(); render(); redrawPictures(); const quiet = n; state.depth = state.depth === 0.8 ? 0.7 : 0.8; render(); return { quiet, afterChange: n }; }
      finally { Storage.prototype.setItem = set; }
    });
    assert.strictEqual(writes.quiet, 0, "redrawing with nothing changed wrote the setup again");
    assert.strictEqual(writes.afterChange, 1, "a real change must still save the setup once");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});
/* Combos are worked out again only when something they depend on changes (Sean, 2026-10-04): putting dyes
   on the disc never recalculates them; changing the depth, pattern or Dyes per combo does. */
test("Combos: tapping dyes onto the disc does not work the combos out again; a setting change does", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const r = await page.evaluate(() => {
      let n = 0; const real = window.buildCombos;
      window.buildCombos = (...a) => { n++; return real(...a); };
      try {
        const ids = state.dyes.filter(d => d.fam !== "c").slice(0, 3).map(d => d.id);
        n = 0; ids.forEach(id => toggleDye(id)); ids.forEach(id => toggleDye(id)); render();
        const taps = n;
        n = 0; state.depth = state.depth === 0.8 ? 0.7 : 0.8; render();
        const depth = n;
        n = 0; state.perCombo = 5; render();
        return { taps, depth, perCombo: n };
      } finally { window.buildCombos = real; }
    });
    assert.strictEqual(r.taps, 0, "putting dyes on and off the disc worked the combos out again");
    assert.strictEqual(r.depth, 1, "changing the depth must work the combos out again");
    assert.ok(r.perCombo >= 1, "changing Dyes per combo must work the combos out again");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});
/* Every input the combos depend on works them out again (Custodian S1), and with no combos at all, taps
   still never re-run the searches behind the "no combos" message (Custodian S2). */
test("Combos: each thing they depend on works them out again; with no combos, taps run no extra searches", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const r = await page.evaluate(() => {
      let n = 0; const real = window.buildCombos;
      window.buildCombos = (...a) => { n++; return real(...a); };
      const after = f => { n = 0; f(); render(); return n; };
      try {
        const out = {};
        out.base = after(() => { state.base = state.base === "#f2dc3c" ? "#f5f5f1" : "#f2dc3c"; });
        out.blend = after(() => { state.blend = state.blend === "multiply" ? "darken" : "multiply"; });
        out.pattern = after(() => { state.pattern = state.pattern === "swirl" ? "cells" : "swirl"; });
        out.translucent = after(() => { state.translucent = !state.translucent; });
        out.pool = after(() => { state.pool = state.pool === "owned" ? "all" : "owned"; });
        state.pool = "owned"; render();
        const first = state.dyes.find(d => d.fam !== "c" && !state.owned.has(d.id));
        out.owned = after(() => { state.owned.add(first.id); });
        /* No combos: a black disc with Dyes per combo 8 leaves nothing clean. */
        state.pool = "all"; state.base = "#26272a"; state.perCombo = 8; render();
        const empty = state.combos.length === 0;
        const ids = state.dyes.filter(d => d.fam !== "c").slice(0, 2).map(d => d.id);
        let m = 0; const realMsg = window.noCombosText; window.noCombosText = (...a) => { m++; return realMsg(...a); };
        try { out.emptyTaps = after(() => { ids.forEach(id => toggleDye(id)); ids.forEach(id => toggleDye(id)); }); out.msgRuns = m; }
        finally { window.noCombosText = realMsg; }
        return { out, empty, msg: document.querySelector("#combos").textContent };
      } finally { window.buildCombos = real; }
    });
    for (const k of ["base", "blend", "pattern", "translucent", "pool", "owned"]) assert.ok(r.out[k] >= 1, `changing ${k} did not work the combos out again`);
    assert.ok(r.empty, "the black-disc setup was meant to leave no combos");
    assert.strictEqual(r.out.emptyTaps, 0, "with no combos, taps re-ran the searches behind the message");
    assert.strictEqual(r.out.msgRuns, 0, "with no combos, taps worked the no-combos message out again");
    assert.ok(r.msg.trim().length > 0, "the no-combos message is missing");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});
/* Counts read as plain English: "1 entry", "1 technique" (found in the 0.5.0 walkthrough; 0.4.1 said "1 entries"). */
test("Counts: one log entry reads \"1 entry\" and one technique reads \"1 technique\"", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await page.evaluate(async () => {
      const db = await window.claude.use("db"), now = new Date().toISOString();
      await db.collection("tests").add({ createdAt: now, note: "one" });
      await db.collection("techniques").add({ name: "Solo", pattern: "swirl", base: "floetrol", createdAt: now, updatedAt: now });
    });
    await page.waitForFunction(() => document.querySelector("#lfCount").textContent === "1 entry");
    await page.waitForFunction(() => document.querySelector("#tfCount").textContent === "1 technique");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});