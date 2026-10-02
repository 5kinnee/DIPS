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
