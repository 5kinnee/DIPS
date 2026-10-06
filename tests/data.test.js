"use strict";
/* Data-safety checks (0.4.0): what happens to a person's data when saves fail, windows overlap,
   folders misbehave and backup files are damaged. Like screen.test.js, these open the real app in
   Edge and use real taps; storage failures are made by replacing browser calls inside the page. */
const fs = require("fs");
const { test, assert, openApp, tapEl } = require("./harness.js");

const ready = page => page.waitForFunction(() => /^#[0-9a-f]{6}$/.test(document.querySelector("#baseHex").value));
const openData = async (page, device) => { await tapEl(page, device, "#tabbtn-data"); await page.locator("#tab-data").waitFor({ state: "visible" }); };
const setDoc = (page, path, data) => page.evaluate(async ([p, d]) => { await (await window.claude.use("db")).doc(p).set(d); }, [path, data]);
const getDoc = (page, path) => page.evaluate(async p => { const s = await (await window.claude.use("db")).doc(p).get(); return s.exists ? s.data() : null; }, path);
const nudgeText = page => page.evaluate(() => { const n = document.querySelector("#nudge"); return n.hidden ? "" : n.textContent; });
const backupFile = (o, raw) => ({ name: "backup.json", mimeType: "application/json",
  buffer: Buffer.from(raw !== undefined ? raw : JSON.stringify({ app: "DIPS", format: 2, savedAt: "2026-01-01T00:00:00.000Z", docs: [], local: {}, names: {}, ...o })) });
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting"); await new Promise(r => setTimeout(r, 100)); }
};
/* Restores a file the way a person does (the file chooser), then waits for the page to reload with its message. */
async function restoreWith(page, file) {
  await page.setInputFiles("#restoreIn", file);
  await page.waitForFunction(() => /Restored|nothing new/.test((document.querySelector("#nudge") || {}).textContent || ""));
  await ready(page);
}
/* Saves a backup file the way a person does and returns what is inside it. */
async function saveBackup(page, device) {
  await openData(page, device);
  const [dl] = await Promise.all([page.waitForEvent("download"), tapEl(page, device, "#backupBtn")]);
  return JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
}

/* Folder stubs. The app's own private file system (real handles, real writes, nothing on the user's disk)
   stands in for the folder a person picks, and permission reads as granted unless a check sets window.__perm. */
function stubPermission() {
  FileSystemHandle.prototype.queryPermission = async () => window.__perm || "granted";
  FileSystemHandle.prototype.requestPermission = async () => window.__perm || "granted";
}
async function chooseFolder(context, page, device, name = "DIPS") {
  await context.addInitScript(stubPermission);
  await page.evaluate(stubPermission);
  await page.evaluate(n => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(n, { create: true }); }, name);
  await openData(page, device);
  await tapEl(page, device, "#folderBtn");
  await page.locator("#folderConfirm").waitFor({ state: "visible" });
  await tapEl(page, device, "#folderYes");
}
const opfsRead = (page, dir, file) => page.evaluate(async ([d, f]) => {
  try { const h = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(d)).getFileHandle(f); return await (await h.getFile()).text(); }
  catch (_) { return null; }
}, [dir, file]);
const opfsWrite = (page, dir, file, text) => page.evaluate(async ([d, f, t]) => {
  const dh = await (await navigator.storage.getDirectory()).getDirectoryHandle(d, { create: true });
  const w = await (await dh.getFileHandle(f, { create: true })).createWritable(); await w.write(t); await w.close();
}, [dir, file, text]);
const folderHas = async (page, id) => { try { return JSON.parse(await opfsRead(page, "DIPS", "data.json")).docs.some(d => d.id === id); } catch (_) { return false; } };

for (const device of ["computer", "phone"]) {
  test(`D1 (${device}): tapping Install DIPS on the Your data tab opens the install prompt once and hides the button`, async () => {
    const { context, page, errors } = await openApp(device);
    try {
      await openData(page, device);
      await page.evaluate(() => {
        const e = new Event("beforeinstallprompt");
        e.prompt = () => { window.__p = (window.__p || 0) + 1; return Promise.resolve(); };
        e.userChoice = Promise.resolve({ outcome: "dismissed" });
        dispatchEvent(e);
      });
      await page.waitForFunction(() => !document.querySelector("#installBtn").hidden);
      await tapEl(page, device, "#installBtn");
      await page.waitForFunction(() => window.__p === 1 && document.querySelector("#installBtn").hidden);
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally { await context.close(); }
  });
}

test("D2: a save that fails because the device is full says so and leaves no ghost entry", async () => {
  const { context, page } = await openApp("computer");
  try {
    const r = await page.evaluate(async () => {
      const db = await window.claude.use("db"), assets = await window.claude.use("assets");
      const orig = IDBObjectStore.prototype.put;
      let fail = null;
      IDBObjectStore.prototype.put = function () { if (fail) throw fail; return orig.apply(this, arguments); };
      const code = async fn => { try { await fn(); return "ok"; } catch (e) { return e && e.code; } };
      const img = await new Promise(res => { const c = document.createElement("canvas"); c.width = c.height = 8; c.toBlob(res, "image/png"); });
      const out = {};
      fail = new DOMException("full", "QuotaExceededError");
      out.docFull = await code(() => db.doc("tests/ghost").set({ a: 1 }));
      out.photoFull = await code(() => assets.upload(img));
      fail = new Error("boom");
      out.docOther = await code(() => db.doc("tests/ghost2").set({ a: 1 }));
      fail = null;
      IDBObjectStore.prototype.put = orig;
      out.ghost = (await db.doc("tests/ghost").get()).exists;
      out.ghost2 = (await db.doc("tests/ghost2").get()).exists;
      out.size = (await db.collection("tests").get()).size;
      return out;
    });
    assert.strictEqual(r.docFull, "quota_exceeded", "a full device should say so");
    assert.strictEqual(r.photoFull, "quota_exceeded", "a photo that doesn't fit should say so");
    assert.strictEqual(r.docOther, "unavailable", "any other storage failure should be reported as unavailable");
    assert.strictEqual(r.ghost, false, "a failed save must not leave an entry on screen");
    assert.strictEqual(r.ghost2, false);
    assert.strictEqual(r.size, 0, "no entry should exist after failed saves");
  } finally { await context.close(); }
});

test("D2: a transaction that aborts because the device is full says 'out of space', not 'couldn't save'", async () => {
  const { context, page } = await openApp("computer");
  try {
    /* A real full device aborts the whole transaction: the transaction's error is QuotaExceededError and
       its pending requests report AbortError. The stub reproduces exactly that: put aborts the real
       transaction, and the transaction's error reads as QuotaExceededError while the stub is on. */
    await page.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "error"), put = IDBObjectStore.prototype.put;
      window.__undo = () => { Object.defineProperty(IDBTransaction.prototype, "error", desc); IDBObjectStore.prototype.put = put; };
      Object.defineProperty(IDBTransaction.prototype, "error", { configurable: true, get() { return new DOMException("full", "QuotaExceededError"); } });
      IDBObjectStore.prototype.put = function () { const r = put.apply(this, arguments); this.transaction.abort(); return r; };
    });
    await tapEl(page, "computer", "#logBtn");
    await page.waitForFunction(() => /out of space/.test(document.querySelector("#logBtnHint").textContent));
    assert.match(await page.locator("#logBtnHint").textContent(), /out of space for DIPS/);
    await page.evaluate(() => window.__undo());
  } finally { await context.close(); }
});

test("D3: a change made in one window shows up in a second window", async () => {
  const { context, page } = await openApp("computer");
  try {
    const page2 = await context.newPage();
    await page2.goto(page.url());
    await ready(page2);
    await page2.evaluate(async () => {
      const db = await window.claude.use("db");
      window.__sizes = []; window.__note = null;
      db.collection("tests").onSnapshot(s => { window.__sizes.push(s.size); const d = s.docs[0]; window.__note = d ? d.data().note : null; });
    });
    await setDoc(page, "tests/w1", { createdAt: "2026-01-01", note: "from window one" });
    await page2.waitForFunction(() => window.__sizes.at(-1) === 1 && window.__note === "from window one");
    await page.evaluate(async () => { await (await window.claude.use("db")).doc("tests/w1").update({ note: "changed" }); });
    await page2.waitForFunction(() => window.__note === "changed");
    await page.evaluate(async () => { await (await window.claude.use("db")).doc("tests/w1").delete(); });
    await page2.waitForFunction(() => window.__sizes.at(-1) === 0);
  } finally { await context.close(); }
});

test("D3: a backup file holds what is stored on the device, not just what this window has loaded", async () => {
  const { context, page } = await openApp("computer");
  try {
    await setDoc(page, "tests/mem1", { createdAt: "2026-01-01", note: "in this window" });
    /* An entry written by another window that this one hasn't heard about: put straight into the database. */
    await page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open("dips");
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const d = r.result, t = d.transaction("docs", "readwrite");
        t.objectStore("docs").put({ key: "tests/raw1", col: "tests", id: "raw1", data: { createdAt: "2026-01-02", note: "only in the database" } });
        t.oncomplete = () => { d.close(); res(); };
        t.onerror = () => rej(t.error);
      };
    }));
    const body = await saveBackup(page, "computer");
    const ids = body.docs.map(d => d.id);
    assert.ok(ids.includes("mem1"), "the backup should hold the entry this window saved");
    assert.ok(ids.includes("raw1"), "the backup should hold the entry that is only in the database");
  } finally { await context.close(); }
});

test("D4: a change made while a folder save is running is saved right after it", async () => {
  const { context, page } = await openApp("computer");
  try {
    await chooseFolder(context, page, "computer");
    await until(() => opfsRead(page, "DIPS", "data.json"));
    /* Hold the first save open at the moment it finishes writing the data file. */
    await page.evaluate(() => {
      const orig = FileSystemWritableFileStream.prototype.close;
      window.__held = false;
      const gate = new Promise(r => { window.__release = r; });
      FileSystemWritableFileStream.prototype.close = async function () {
        if (!window.__held) { window.__held = true; await gate; }
        return orig.call(this);
      };
    });
    await setDoc(page, "tests/a1", { createdAt: "2026-01-01", note: "first" });
    await page.waitForFunction(() => window.__held === true);
    await setDoc(page, "tests/b2", { createdAt: "2026-01-02", note: "second" });
    /* Longer than the 1.5 s save delay, so the second change's timer fires while the first save is still held. */
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.__release());
    await until(() => folderHas(page, "b2"));
    assert.ok(await folderHas(page, "a1"), "the first change should be in the folder too");
  } finally { await context.close(); }
});

test("D5: a damaged or hostile backup file restores the good items, skips the rest, and says how many", async () => {
  const { context, page } = await openApp("computer");
  try {
    const requests = [];
    page.on("request", r => requests.push(r.url()));
    const photoId = "a".repeat(32);
    await restoreWith(page, backupFile({
      docs: [
        { col: "tests", id: "ok1", data: { createdAt: "2026-01-01", note: "fine" } },
        { col: "tests", id: "ph1", data: { createdAt: "2026-01-02", note: "photo link", photo: photoId } },
        null,
        { col: "", id: "x", data: {} },
        { col: "tests", id: "b2", data: "just text" },
        { col: "tests", id: "b3", data: { photo: "../../steal" } }
      ],
      photos: { [photoId]: "https://example.com/evil.png" }
    }));
    const msg = await nudgeText(page);
    assert.match(msg, /Restored 3 items/, "the two good items and the entry with a made-up photo id should be restored");
    assert.match(msg, /3 items couldn't be restored/, "the three bad items should be counted in plain words");
    assert.ok(await getDoc(page, "tests/ok1"), "a good entry should be there");
    const b3 = await getDoc(page, "tests/b3");
    assert.ok(b3, "an entry with a made-up photo id is kept: a dye job is never dropped over one field");
    assert.strictEqual(b3.photo, null, "the made-up photo id must not be kept");
    assert.deepStrictEqual(requests.filter(u => u.includes("example.com")), [], "a photo link that isn't an embedded image must never be fetched");

    /* A file over 200 MB is turned away before it is read. */
    await openData(page, "computer");
    await page.evaluate(() => {
      const size = Object.getOwnPropertyDescriptor(Blob.prototype, "size").get;
      Object.defineProperty(File.prototype, "size", { get() { return this.name === "huge.json" ? 201 * 1024 * 1024 : size.call(this); } });
      const dt = new DataTransfer(); dt.items.add(new File(["{}"], "huge.json"));
      const i = document.querySelector("#restoreIn");
      i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => /too big/.test(document.querySelector("#backupState").textContent));
  } finally { await context.close(); }
});

test("D6: a folder whose data file can't be read is left untouched and the user is told", async () => {
  const bad = "{oops this is not a data file";
  const a = await openApp("computer");
  try {
    /* Picking a folder that already holds a data file DIPS can't read. */
    await setDoc(a.page, "tests/keep1", { createdAt: "2026-01-01", note: "mine" });
    await opfsWrite(a.page, "DIPS", "data.json", bad);
    await chooseFolder(a.context, a.page, "computer");
    await a.page.waitForFunction(() => /couldn't read the data file/.test(document.querySelector("#folderState").textContent), null, { timeout: 8000 });
    assert.strictEqual(await opfsRead(a.page, "DIPS", "data.json"), bad, "the unreadable file must not be overwritten");
    assert.strictEqual(await a.page.textContent("#folderBtn"), "Choose where to keep it", "the folder must not be adopted");
    assert.ok(await getDoc(a.page, "tests/keep1"), "the user's own data must be untouched");
  } finally { await a.context.close(); }

  /* The start-up case (a folder already in use whose data file becomes unreadable before the next visit)
     needs the stored folder read back after a reload. With the private file system standing in for a picked
     folder, headless Edge crashes on that reload even on a blank page with no DIPS code, so the start-up
     guard (the first save of a visit reads data.json first) is checked by review and on a real folder. */
});

test("D6: an unreadable place picked while a healthy folder is in use is reported for that pick only", async () => {
  const bad = "{oops this is not a data file";
  const { context, page } = await openApp("computer");
  try {
    await chooseFolder(context, page, "computer");
    await until(() => opfsRead(page, "DIPS", "data.json"));
    await opfsWrite(page, "Other", "data.json", bad);
    await page.evaluate(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("Other", { create: true }); });
    await openData(page, "computer");
    await tapEl(page, "computer", "#folderBtn");
    await page.locator("#folderConfirm").waitFor({ state: "visible" });
    await tapEl(page, "computer", "#folderYes");
    await page.waitForFunction(() => /couldn't read the data file/.test(document.querySelector("#folderState").textContent), null, { timeout: 8000 });
    const t = await page.textContent("#folderState");
    assert.match(t, /Keeping a copy here/, "the folder in use is still healthy and still reported as saving");
    assert.match(await page.textContent("#folderName"), /"DIPS"/, "the folder line still names the folder in use");
    assert.doesNotMatch(t, /last save didn't work/);
    assert.strictEqual(await nudgeText(page), "", "a healthy folder must not get the 'isn't saving' reminder");
    assert.strictEqual(await opfsRead(page, "Other", "data.json"), bad, "the unreadable file must not be overwritten");
    assert.strictEqual(await page.textContent("#folderBtn"), "Use a different place", "the old folder stays in use");
  } finally { await context.close(); }
});

test("D7: failures on the Your data tab are told in plain words with no browser error text", async () => {
  const { context, page } = await openApp("computer");
  try {
    await openData(page, "computer");
    await page.setInputFiles("#restoreIn", backupFile(null, "this is not a backup {"));
    await page.waitForFunction(() => /couldn't be restored/.test(document.querySelector("#backupState").textContent));
    const t = await page.textContent("#backupState");
    assert.match(t, /doesn't look like a DIPS backup/);
    assert.doesNotMatch(t, /JSON|Unexpected|token|position|SyntaxError/i, "browser error text must not reach the screen");

    await chooseFolder(context, page, "computer");
    await until(() => opfsRead(page, "DIPS", "data.json"));
    await page.evaluate(() => { FileSystemFileHandle.prototype.createWritable = async () => { throw new Error("secret browser words"); }; });
    await setDoc(page, "tests/e1", { createdAt: "2026-01-01", note: "x" });
    await page.waitForFunction(() => /last save didn't work/.test(document.querySelector("#folderState").textContent));
    const f = await page.textContent("#folderState");
    assert.doesNotMatch(f, /secret browser words/, "browser error text must not reach the screen");
    for (const sel of ["#folderState", "#backupState", "#nudge"]) assert.doesNotMatch(await page.textContent(sel), /JSON/i, `${sel} should not say JSON`);
  } finally { await context.close(); }
});

test("D8: restoring a backup keeps a local custom dye that shares an id with a different incoming dye", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await page.evaluate(() => {
      localStorage.setItem("discdye.custom", JSON.stringify([
        { id: "custom-1", code: "Custom", name: "Local Red", hex: "#ff0000", recipe: null },
        { id: "custom-2", code: "Custom", name: "Same Dye", hex: "#00ff00", recipe: null }]));
      localStorage.setItem("discdye.owned", JSON.stringify(["custom-1"]));
    });
    const blue = { id: "custom-1", code: "Custom", name: "Their Blue", hex: "#0000ff", recipe: null };
    await restoreWith(page, backupFile({
      docs: [{ col: "tests", id: "t1", data: { createdAt: "2026-01-01", note: "n", dyes: [blue] } }],
      local: {
        "discdye.custom": JSON.stringify([blue,
          { id: "custom-2", code: "Custom", name: "Same Dye", hex: "#00FF00", recipe: null },
          { id: "custom-9", code: "Custom", name: "Brand New", hex: "#123456", recipe: null }]),
        "discdye.owned": JSON.stringify(["custom-1", "custom-2"])
      }
    }));
    assert.match(await nudgeText(page), /Restored 3 items/, "the entry and the two new dyes should be counted");
    const { custom, owned } = await page.evaluate(() => ({ custom: JSON.parse(localStorage.getItem("discdye.custom")), owned: JSON.parse(localStorage.getItem("discdye.owned")) }));
    assert.strictEqual(custom.length, 4, "local dyes plus the colliding dye and the new one; the same dye is not added twice");
    assert.strictEqual(custom.find(c => c.id === "custom-1").name, "Local Red", "the local dye must keep its id and name");
    const theirs = custom.find(c => c.name === "Their Blue");
    assert.match(theirs.id, /^custom-[0-9a-f]{8}$/, "the colliding dye should get a fresh id");
    assert.strictEqual(custom.filter(c => c.name === "Same Dye").length, 1);
    assert.deepStrictEqual([...owned].sort(), ["custom-1", "custom-2", theirs.id].sort(), "the incoming shelf entry should follow the dye to its new id");
    assert.strictEqual((await getDoc(page, "tests/t1")).dyes[0].id, theirs.id, "the restored log entry should point at the dye's new id");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D8: two incoming dyes with one new id: an exact repeat is skipped quietly, a different one gets its own id", async () => {
  const { context, page } = await openApp("computer");
  try {
    const foo = { id: "custom-5", code: "Custom", name: "Foo", hex: "#111111", recipe: null };
    const bar = { id: "custom-5", code: "Custom", name: "Bar", hex: "#222222", recipe: null };
    await restoreWith(page, backupFile({ local: { "discdye.custom": JSON.stringify([foo, { ...foo, hex: "#111111" }, bar]) } }));
    const msg = await nudgeText(page);
    assert.match(msg, /Restored 2 items/, "Foo and Bar should be restored");
    assert.doesNotMatch(msg, /couldn't be restored/, "the repeated Foo is harmless and is skipped without a complaint");
    const custom = await page.evaluate(() => JSON.parse(localStorage.getItem("discdye.custom")));
    assert.strictEqual(custom.length, 2);
    assert.strictEqual(custom.find(c => c.name === "Foo").id, "custom-5");
    assert.match(custom.find(c => c.name === "Bar").id, /^custom-[0-9a-f]{8}$/, "the different dye should get a fresh id");
  } finally { await context.close(); }
});

test("D12: a log entry whose color carries CSS is restored without that color and never reaches a style", async () => {
  const { context, page } = await openApp("computer");
  try {
    const requests = [];
    page.on("request", r => requests.push(r.url()));
    const evil = "#fff;background-image:url(https://example.com/x)";
    const entry = hex => ({
      date: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z", disc: { hex, name: "yellow" },
      plastic: { brand: "Innova", name: "Star / Shimmer", rating: "-", translucent: false },
      tech: "floetrol", pattern: "cells", depth: 0.8, dyes: [{ id: "x", code: "C", name: "Dye", hex: "#112233", recipe: null }], closer: ""
    });
    await restoreWith(page, backupFile({ docs: [{ col: "tests", id: "evil1", data: entry(evil) }, { col: "tests", id: "good1", data: entry("#f2dc3c") }] }));
    assert.match(await nudgeText(page), /Restored 2 items\./, "both entries should be restored: a dye job is never dropped over a color");
    const kept = await getDoc(page, "tests/evil1");
    assert.ok(kept, "the entry with the bad color should be kept");
    assert.strictEqual(kept.disc.hex, null, "the bad color should be removed from the entry");
    assert.strictEqual(kept.dyes[0].hex, "#112233", "good colors in the same entry should stay");

    /* Defense in depth: an entry that is already stored with such a color still never reaches a style. */
    await setDoc(page, "tests/evil2", entry(evil));
    await tapEl(page, "computer", "#tabbtn-log");
    await page.waitForFunction(() => document.querySelectorAll(".entry").length === 3);
    await page.waitForTimeout(500);
    assert.deepStrictEqual(requests.filter(u => u.includes("example.com")), [], "a stored color must never load anything from the web");
  } finally { await context.close(); }
});

const fullEntry = over => ({
  date: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z", disc: { hex: "#f2dc3c", name: "yellow" },
  plastic: { brand: "Innova", name: "Star / Shimmer", rating: "-", translucent: false },
  tech: "floetrol", pattern: "cells", depth: 0.8, dyes: [{ id: "x", code: "C", name: "Dye", hex: "#112233", recipe: null }], closer: "", ...over
});

test("D13: a restored log entry with malformed dyes, disc and predictions still shows in the Test log, before and after a reload", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const bad = fullEntry({ dyes: [null, { name: "A", hex: "#112233", recipe: "x" }], disc: { name: "yellow" }, predicted: { multiply: ["#zzz"], darken: "nope" } });
    await restoreWith(page, backupFile({ docs: [{ col: "tests", id: "m1", data: bad }] }));
    await tapEl(page, "computer", "#tabbtn-log");
    await page.waitForFunction(() => document.querySelectorAll(".entry").length === 1);
    assert.strictEqual(await page.locator(".entry").count(), 1, "the entry should show in the Test log");
    await page.reload();
    await ready(page);
    await tapEl(page, "computer", "#tabbtn-log");
    await page.waitForFunction(() => document.querySelectorAll(".entry").length === 1);
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D14: saving an edit to a restored entry whose dye color was invalid saves with a message instead of doing nothing", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await restoreWith(page, backupFile({ docs: [{ col: "tests", id: "m2", data: fullEntry({ dyes: [{ id: "x", code: "C", name: "Dye", hex: "red;x", recipe: null }] }) }] }));
    await tapEl(page, "computer", "#tabbtn-log");
    await page.waitForFunction(() => document.querySelectorAll(".entry").length === 1);
    await tapEl(page, "computer", ".entry [data-edit]");
    await page.locator(".eform").waitFor({ state: "visible" });
    await tapEl(page, "computer", '.eform [type="submit"]');
    await page.waitForFunction(() => document.querySelector("#logStatus").textContent.trim().length > 0);
    assert.match(await page.textContent("#logStatus"), /Changes saved|Couldn't save/, "the save should end in a plain message");
    assert.strictEqual(await page.locator('.eform [type="submit"]').count() === 0 || await page.locator('.eform [type="submit"]').isEnabled(), true, "the button should not stay stuck");
    assert.deepStrictEqual((await getDoc(page, "tests/m2")).predicted.multiply, [null], "the dye without a color should predict nothing");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D15: restoring a backup never replaces a name this device already has for a person", async () => {
  const { context, page } = await openApp("computer");
  try {
    await restoreWith(page, backupFile({ docs: [{ col: "tests", id: "n0", data: fullEntry({}) }, { col: "tests", id: "n00", data: fullEntry({}) }], names: { "person-1": "Local Name" } }));
    assert.match(await nudgeText(page), /Restored 2 items/);
    await page.setInputFiles("#restoreIn", backupFile({ docs: [{ col: "tests", id: "n1", data: fullEntry({}) }], names: { "person-1": "Incoming Name", "person-2": "New Person" } }));
    await page.waitForFunction(() => /Restored 1 item\b/.test((document.querySelector("#nudge") || {}).textContent || ""));
    await ready(page);
    const body = await saveBackup(page, "computer");
    assert.strictEqual(body.names["person-1"], "Local Name", "the name already on this device stays");
    assert.strictEqual(body.names["person-2"], "New Person", "a name the device lacks is added");
  } finally { await context.close(); }
});

test("D16: a restored log entry with every field the wrong type is rebuilt, shows with the good ones, can be edited and saved, before and after a reload", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const sink = { date: 5, createdAt: {}, techName: 7, tech: [], pattern: 1, depth: "x", plastic: "x", dyes: [null, 5], predicted: "x",
      closer: {}, notes: [], photo: {}, by: 3, mix: 4, setTime: 6, disc: "x" };
    await restoreWith(page, backupFile({ docs: [
      { col: "tests", id: "k1", data: sink },
      { col: "tests", id: "g1", data: fullEntry({ createdAt: "2026-01-02T00:00:00.000Z" }) },
      { col: "tests", id: "g2", data: fullEntry({ createdAt: "2026-01-03T00:00:00.000Z" }) }] }));
    assert.match(await nudgeText(page), /Restored 3 items\./, "all three entries should be restored");
    const blank = { id: "", code: "", name: "", hex: null, recipe: null };
    const k1 = await getDoc(page, "tests/k1");
    assert.deepStrictEqual(k1.dyes, [blank, blank], "dye positions stay lined up, each a blank dye");
    assert.strictEqual(k1.photo, null, "a bad photo is dropped and the entry kept");
    assert.strictEqual(k1.date, "", "a bad date takes the default");
    assert.strictEqual(k1.depth, 0.8, "a bad depth takes the app's default");
    const shown = async () => {
      await tapEl(page, "computer", "#tabbtn-log");
      await page.waitForFunction(() => document.querySelectorAll(".entry").length === 3);
      assert.doesNotMatch(await page.locator("#logList").textContent(), /couldn't be shown/, "import rebuilt the entry, so no stand-in card is needed");
    };
    await shown();
    await tapEl(page, "computer", '.entry[data-id="k1"] [data-edit]');
    await page.locator(".eform").waitFor({ state: "visible" });
    await tapEl(page, "computer", '.eform [type="submit"]');
    await page.waitForFunction(() => /Changes saved/.test(document.querySelector("#logStatus").textContent));
    await page.reload();
    await ready(page);
    await shown();
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D17: a restored technique with every field the wrong type is rebuilt, shows in My techniques, and the Planner still works", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const sink = { name: 7, looks: [], description: {}, base: 5, plastics: 1, dyes: ["x"], tags: "x", how: 2, mix: 3, heat: 4,
      setTime: 5, notes: 6, pattern: 9, photo: {}, by: 8, createdAt: {}, updatedAt: [] };
    await restoreWith(page, backupFile({ docs: [{ col: "techniques", id: "t1", data: sink }] }));
    assert.match(await nudgeText(page), /Restored 1 item\b/);
    const t1 = await getDoc(page, "techniques/t1");
    assert.deepStrictEqual([t1.name, t1.dyes, t1.tags, t1.pattern, t1.photo, t1.by], ["", "", [], "swirl", null, null], "each field is rebuilt with the type the app writes");
    await page.waitForFunction(() => document.querySelectorAll("#myTechList details.tcard").length === 1);
    assert.doesNotMatch(await page.locator("#myTechList").textContent(), /couldn't be shown/);
    await page.selectOption("#myTechPick", "my:t1");
    await page.waitForFunction(() => state.tech === "my:t1");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D18: an incoming dye that matches a local one keeps its id, and a different incoming dye with that id gets a new one without moving the references", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const x = { id: "custom-3", code: "Custom", name: "Same", hex: "#00ff00", recipe: null };
    const other = { id: "custom-3", code: "Custom", name: "Other", hex: "#0000ff", recipe: null };
    await page.evaluate(d => localStorage.setItem("discdye.custom", JSON.stringify([d])), x);
    await restoreWith(page, backupFile({
      docs: [{ col: "tests", id: "r1", data: fullEntry({ dyes: [x] }) }],
      local: { "discdye.custom": JSON.stringify([x, other]), "discdye.owned": JSON.stringify(["custom-3"]) }
    }));
    assert.match(await nudgeText(page), /Restored 2 items/, "the entry and the different dye");
    const { custom, owned } = await page.evaluate(() => ({ custom: JSON.parse(localStorage.getItem("discdye.custom")), owned: JSON.parse(localStorage.getItem("discdye.owned")) }));
    assert.strictEqual(custom.length, 2, "the matching dye is not added twice");
    const o = custom.find(c => c.name === "Other");
    assert.match(o.id, /^custom-[0-9a-f]{8}$/, "the different dye gets its own id");
    assert.deepStrictEqual(owned, ["custom-3"], "the shelf entry stays with the first dye");
    assert.strictEqual((await getDoc(page, "tests/r1")).dyes[0].id, "custom-3", "the log entry stays with the first dye");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D19: a folder holding the proof of concept's data file is used and saved to, and any old notes in it are kept", async () => {
  /* The proof of concept's exact data file (format 1, no entries). */
  const poc = JSON.stringify({ app: "DIPS", format: 1, savedAt: "2026-09-29T00:14:52.508Z", entries: [] }, null, 2);
  const a = await openApp("computer");
  try {
    await setDoc(a.page, "tests/mine1", { createdAt: "2026-09-01T00:00:00.000Z", date: "2026-09-01", dyes: [] });
    await opfsWrite(a.page, "DIPS", "data.json", poc);
    await chooseFolder(a.context, a.page, "computer");
    await until(async () => { const t = await opfsRead(a.page, "DIPS", "data.json"); return t && /"docs"/.test(t); });
    const saved = JSON.parse(await opfsRead(a.page, "DIPS", "data.json"));
    assert.ok(saved.docs.some(d => d.id === "mine1"), "the folder should now hold this device's data");
    assert.doesNotMatch(await a.page.textContent("#folderState"), /couldn't read/, "a DIPS-made file must not be called unreadable");
    assert.strictEqual(await a.page.textContent("#folderBtn"), "Use a different place", "the folder should be in use");
  } finally { await a.context.close(); }

  const b = await openApp("computer");
  try {
    /* A proof of concept file that does hold notes: they are kept beside it before the first save. */
    const withNotes = JSON.stringify({ app: "DIPS", format: 1, savedAt: "2026-09-29T00:14:52.508Z", entries: [{ id: "e1", note: "first test", photoId: null, createdAt: "2026-09-28T00:00:00.000Z" }] });
    await opfsWrite(b.page, "DIPS", "data.json", withNotes);
    await chooseFolder(b.context, b.page, "computer");
    await until(async () => { const t = await opfsRead(b.page, "DIPS", "data.json"); return t && /"docs"/.test(t); });
    assert.strictEqual(await opfsRead(b.page, "DIPS", "data-format1.json"), withNotes, "the old notes should be kept unchanged");
  } finally { await b.context.close(); }
});

test("D20: re-picking the folder in use shows its problem once; a different unreadable place gets its own labeled message", async () => {
  const bad = "{oops this is not a data file";
  const count = (t, re) => (t.match(re) || []).length;
  const a = await openApp("computer");
  try {
    await chooseFolder(a.context, a.page, "computer");
    await until(() => opfsRead(a.page, "DIPS", "data.json"));
    await opfsWrite(a.page, "DIPS", "data.json", bad);
    await chooseFolder(a.context, a.page, "computer");
    await a.page.waitForFunction(() => /couldn't read the data file/.test(document.querySelector("#folderState").textContent), null, { timeout: 8000 });
    assert.strictEqual(count(await a.page.textContent("#folderState"), /couldn't read the data file/g), 1, "the message should appear once");
    assert.strictEqual(await opfsRead(a.page, "DIPS", "data.json"), bad, "the unreadable file must not be overwritten");

    await opfsWrite(a.page, "Other", "data.json", bad);
    await chooseFolder(a.context, a.page, "computer", "Other");
    await a.page.waitForFunction(() => /The place you just picked:/.test(document.querySelector("#folderState").textContent), null, { timeout: 8000 });
    assert.strictEqual(count(await a.page.textContent("#folderState"), /The place you just picked:/g), 1, "the new pick should get one labeled message");
  } finally { await a.context.close(); }
});

test("D21: the folder line always shows: none chosen, then the folder's name and the location the person noted, even while an error shows", async () => {
  const bad = "{oops this is not a data file";
  const a = await openApp("computer");
  try {
    await openData(a.page, "computer");
    assert.strictEqual(await a.page.textContent("#folderName"), "None chosen yet");
    assert.ok(await a.page.locator("#folderLocRow").isHidden(), "no location to note without a folder");

    await chooseFolder(a.context, a.page, "computer");
    await until(() => opfsRead(a.page, "DIPS", "data.json"));
    await a.page.waitForFunction(() => /"DIPS"/.test(document.querySelector("#folderName").textContent));
    assert.match(await a.page.textContent("#folderName"), /isn't noted yet/, "with no note, the line says so");
    assert.strictEqual(await a.page.getAttribute("#folderLoc", "placeholder"), "e.g. OneDrive > Documents > DIPS");

    await a.page.fill("#folderLoc", "OneDrive > Documents > DIPS");
    await tapEl(a.page, "computer", "#folderLocSave");
    await a.page.waitForFunction(() => /OneDrive > Documents > DIPS/.test(document.querySelector("#folderName").textContent));

    /* Re-picking the same folder without typing a note keeps the note. */
    await chooseFolder(a.context, a.page, "computer");
    await until(async () => /Keeping a copy here/.test(await a.page.textContent("#folderState")));
    assert.match(await a.page.textContent("#folderName"), /OneDrive > Documents > DIPS/, "re-picking the same folder must not wipe the note");

    /* An error on the folder in use: the folder line is still there, above the message. */
    await opfsWrite(a.page, "DIPS", "data.json", bad);
    await chooseFolder(a.context, a.page, "computer");
    await a.page.waitForFunction(() => /couldn't read the data file/.test(document.querySelector("#folderState").textContent), null, { timeout: 8000 });
    assert.match(await a.page.textContent("#folderName"), /"DIPS" - OneDrive > Documents > DIPS/, "the folder line stays visible while an error shows");
    assert.ok(await a.page.locator("#folderName").isVisible());
  } finally { await a.context.close(); }
});

test("D9: the overdue backup reminder shows even when the install tip applies", async () => {
  const { context, page } = await openApp("computer");
  try {
    await page.evaluate(() => dispatchEvent(new Event("beforeinstallprompt")));
    await setDoc(page, "tests/n1", { createdAt: "2026-01-01", note: "x" });
    await page.waitForFunction(() => /backup/i.test(document.querySelector("#nudge").textContent), null, { timeout: 8000 });
    assert.doesNotMatch(await nudgeText(page), /install DIPS/, "the backup reminder should come before the install tip");
  } finally { await context.close(); }
});

test("D9: a folder that stopped saving gets its own reminder, hidden separately from the backup one", async () => {
  const { context, page } = await openApp("computer");
  try {
    await chooseFolder(context, page, "computer");
    await until(() => opfsRead(page, "DIPS", "data.json"));
    await setDoc(page, "tests/f1", { createdAt: "2026-01-01", note: "x" });
    await until(() => folderHas(page, "f1"));
    assert.strictEqual(await nudgeText(page), "", "a working folder needs no reminder");

    await page.evaluate(() => { window.__perm = "prompt"; });
    await setDoc(page, "tests/f2", { createdAt: "2026-01-02", note: "y" });
    await page.waitForFunction(() => /isn't saving to your folder right now/.test(document.querySelector("#nudge").textContent), null, { timeout: 8000 });
    assert.ok(await page.locator('#nudge [data-goto="data"]').count(), "the reminder should lead to the Your data tab");

    await tapEl(page, "computer", "#nudge .nudgex");
    await page.waitForFunction(() => /haven't saved a backup/.test(document.querySelector("#nudge").textContent), null, { timeout: 8000 });
  } finally { await context.close(); }
});

test("D9: a device with only custom dyes still gets the backup reminder", async () => {
  const { context, page } = await openApp("computer");
  try {
    assert.strictEqual(await nudgeText(page), "", "a fresh device has nothing to back up");
    await page.evaluate(() => localStorage.setItem("discdye.custom", JSON.stringify([{ id: "custom-1", code: "Custom", name: "Solo", hex: "#ff0000", recipe: null }])));
    await page.waitForFunction(() => /backup/i.test(document.querySelector("#nudge").textContent), null, { timeout: 8000 });
  } finally { await context.close(); }
});

test("D10: the log filter setting is kept in backups and restored", async () => {
  const filter = JSON.stringify({ sort: "old" });
  const a = await openApp("computer");
  let body;
  try {
    await a.page.evaluate(f => localStorage.setItem("discdye.logfilter", f), filter);
    body = await saveBackup(a.page, "computer");
    assert.strictEqual(body.local["discdye.logfilter"], filter, "the backup should hold the log filter setting");
  } finally { await a.context.close(); }
  const b = await openApp("computer");
  try {
    await restoreWith(b.page, backupFile({ local: body.local }));
    assert.strictEqual(await b.page.evaluate(() => localStorage.getItem("discdye.logfilter")), filter);
  } finally { await b.context.close(); }
});

/* ---------- 0.5.0: own photo patterns, 8+ dye entries, 0.4.1 data (Story 0.5.0 AC-30..AC-32, AC-41, AC-60, AC-72..AC-74) ---------- */
/* An own photo pattern stored the way the app stores one (a photo in assets, then the pattern doc). */
const seedOwnPattern = (page, name) => page.evaluate(async name => {
  const db = await window.claude.use("db"), assets = await window.claude.use("assets");
  const c = document.createElement("canvas"); c.width = c.height = 96;
  const x = c.getContext("2d"); x.fillStyle = "#d02020"; x.fillRect(0, 0, 96, 48); x.fillStyle = "#2040d0"; x.fillRect(0, 48, 96, 48);
  const ph = await assets.upload(await new Promise(r => c.toBlob(r, "image/png")));
  const ref = await db.collection("patterns").add({ name, photo: ph.id, by: null, createdAt: new Date().toISOString() });
  return { id: ref.id, key: "own:" + ref.id, photo: ph.id };
}, name);
const smallPhotoDataURL = page => page.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d"); x.fillStyle = "#e0a000"; x.fillRect(0, 0, 32, 32); return c.toDataURL("image/png"); });

test("D22 (AC-30, P0): an own photo pattern and a log entry using it survive backup, clearing everything, and restore, with the photo showing", async () => {
  const a = await openApp("computer");
  let body, own;
  try {
    await a.page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    own = await seedOwnPattern(a.page, "Sunset disc");
    await a.page.waitForFunction(k => patKnown(k), own.key);
    await a.page.evaluate(k => { state.pattern = k; render(); }, own.key);
    await tapEl(a.page, "computer", "#logBtn");
    await a.page.waitForFunction(() => document.querySelectorAll("#logList .entry").length === 1);
    body = await saveBackup(a.page, "computer");
    assert.ok(body.docs.some(d => d.col === "patterns" && d.id === own.id && d.data.photo === own.photo), "the backup should hold the pattern");
    assert.match(body.photos[own.photo] || "", /^data:image\//, "the backup should hold the pattern's photo");
  } finally { await a.context.close(); }

  /* A fresh profile is a device with all site data cleared. */
  const b = await openApp("computer");
  try {
    await restoreWith(b.page, backupFile(null, JSON.stringify(body)));
    assert.match(await nudgeText(b.page), /Restored 2 items\./, "the pattern and the entry");
    await b.page.waitForFunction(k => patKnown(k), own.key);
    assert.strictEqual(await b.page.evaluate(k => patLabel(k), own.key), "Sunset disc");
    await b.page.waitForFunction(k => DiscPreview.photoState(k) !== "loading", own.key);
    assert.strictEqual(await b.page.evaluate(k => DiscPreview.photoState(k), own.key), "ready", "the restored pattern's photo should be there to draw");
    const entry = await b.page.evaluate(() => window.claude.use("db").then(db => db.collection("tests").get()).then(s => s.docs[0].data()));
    assert.deepStrictEqual([entry.pattern, entry.patternName], [own.key, "Sunset disc"], "the entry keeps its pattern and its name");
    await tapEl(b.page, "computer", "#tabbtn-log");
    await b.page.waitForFunction(() => /Sunset disc/.test(document.querySelector("#logList").textContent));
  } finally { await b.context.close(); }
});

test("D23 (AC-30): the DIPS folder copy holds the own photo pattern and its photo file", async () => {
  const { context, page } = await openApp("computer");
  try {
    await chooseFolder(context, page, "computer");
    await until(() => opfsRead(page, "DIPS", "data.json"));
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    const own = await seedOwnPattern(page, "Folder photo");
    await until(async () => { try { return JSON.parse(await opfsRead(page, "DIPS", "data.json")).docs.some(d => d.col === "patterns" && d.id === own.id && d.data.photo === own.photo); } catch (_) { return false; } });
    const size = await until(() => page.evaluate(async id => {
      try { const f = await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("DIPS")).getDirectoryHandle("photos")).getFileHandle(id + ".jpg")).getFile(); return f.size; }
      catch (_) { return 0; }
    }, own.photo));
    assert.ok(size > 0, "the pattern's photo file should be in the folder's photos");
  } finally { await context.close(); }
});

test("D24 (AC-31, AC-74): damaged own photo patterns in a backup are rebuilt or skipped and counted, never break a tab, and photos come only from the file", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const requests = [];
    page.on("request", r => requests.push(r.url()));
    const url = await smallPhotoDataURL(page), p1 = "1".repeat(32), p2 = "2".repeat(32), p6 = "6".repeat(32);
    const cssName = "<img src=x onerror=window.__hit=1><style>body{display:none}</style>" + "x".repeat(40);
    await restoreWith(page, backupFile({
      docs: [
        { col: "patterns", id: "p1", data: { name: 7, photo: p1, by: 5, createdAt: [] } },
        { col: "patterns", id: "p2", data: { name: cssName, photo: p2 } },
        { col: "patterns", id: "p3", data: { name: "No photo at all" } },
        { col: "patterns", id: "p4", data: { name: "Bad photo id", photo: "../../steal" } },
        { col: "patterns", id: "p5", data: "just text" },
        { col: "patterns", id: "p6", data: { name: "Photo from the web", photo: p6 } }
      ],
      photos: { [p1]: url, [p2]: url, [p6]: "https://example.com/evil.png" }
    }));
    const msg = await nudgeText(page);
    assert.match(msg, /Restored 3 items/, "the two repairable patterns and the one whose photo isn't in the file");
    assert.match(msg, /3 items couldn't be restored/, "no photo reference, a bad photo id and a non-object are skipped and counted");
    const d1 = await getDoc(page, "patterns/p1");
    assert.deepStrictEqual(d1, { name: "My photo", photo: p1, by: null, createdAt: "" }, "each field rebuilt with the type the app writes");
    assert.strictEqual((await getDoc(page, "patterns/p2")).name.length, 40, "a name is at most 40 characters");
    for (const id of ["p3", "p4", "p5"]) assert.strictEqual(await getDoc(page, "patterns/" + id), null, `${id} should be skipped`);
    assert.deepStrictEqual(requests.filter(u => u.includes("example.com")), [], "a photo link that isn't an embedded image must never be fetched");
    await page.waitForFunction(() => document.querySelectorAll("#ownPats .ownrow").length === 3);
    assert.strictEqual(await page.evaluate(() => window.__hit || 0), 0, "a name must never run as page code");
    assert.strictEqual(await page.locator("#ownPats img, #ownPats style").count(), 0, "a name must show as text");
    for (const tab of ["planner", "notes", "log", "data"]) {
      await tapEl(page, "computer", `#tabbtn-${tab}`);
      await page.locator(`#tab-${tab}`).waitFor({ state: "visible" });
    }
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D25 (AC-32): an own photo pattern added in one window appears in a second window", async () => {
  const { context, page } = await openApp("computer");
  try {
    const page2 = await context.newPage();
    await page2.goto(page.url());
    await ready(page2);
    await page2.waitForFunction(() => patsLoaded);
    await page.waitForFunction(() => !document.querySelector("#ownAdd").hidden);
    const own = await seedOwnPattern(page, "Shared photo");
    await page2.waitForFunction(k => !!document.querySelector(`#ownPats [data-pat="${k}"]`) && DiscPreview.photoState(k) !== "loading", own.key);
    assert.strictEqual(await page2.evaluate(k => DiscPreview.photoState(k), own.key), "ready", "the second window can draw it");
    await page.evaluate(async o => { await (await window.claude.use("db")).doc("patterns/" + o.id).delete(); }, own);
    await page2.waitForFunction(k => !document.querySelector(`#ownPats [data-pat="${k}"]`), own.key);
  } finally { await context.close(); }
});

test("D26 (AC-60): restored log entries made with photo patterns keep their pattern names", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await restoreWith(page, backupFile({ docs: [
      { col: "tests", id: "ph1", data: fullEntry({ createdAt: "2026-01-02T00:00:00.000Z", pattern: "photo-flames", patternName: "Flames photo" }) },
      { col: "tests", id: "ph2", data: fullEntry({ createdAt: "2026-01-03T00:00:00.000Z", pattern: "own:gone123", patternName: "Old favorite" }) },
      { col: "tests", id: "ph3", data: fullEntry({ createdAt: "2026-01-04T00:00:00.000Z", pattern: "own:gone456", patternName: 9 }) }] }));
    assert.match(await nudgeText(page), /Restored 3 items\./);
    assert.strictEqual((await getDoc(page, "tests/ph2")).patternName, "Old favorite", "the restore must keep the logged pattern name");
    assert.strictEqual((await getDoc(page, "tests/ph3")).patternName, "", "a name that isn't text takes the default");
    await tapEl(page, "computer", "#tabbtn-log");
    await page.waitForFunction(() => document.querySelectorAll(".entry").length === 3);
    const heads = await page.$$eval(".entry .ehead h3", hs => hs.map(h => h.textContent));
    assert.ok(heads.includes("Floetrol bed: Flames photo") && heads.includes("Floetrol bed: Old favorite"), `heads: ${heads}`);
    assert.ok(heads.includes("Floetrol bed: Deleted photo"), "a deleted photo with no name left says so in words");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D27 (AC-41, P0): a restored entry with 10 dyes keeps all 10, in order, when edited and saved", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const mine = await page.evaluate(() => state.dyes.slice(0, 8).map(d => ({ id: d.id, code: d.code, name: d.name, hex: d.hex, recipe: null })));
    const dyes = [...mine, { id: "custom-gone0001", code: "Custom", name: "Gone A", hex: "#123456", recipe: null }, { id: "custom-gone0002", code: "Mix", name: "Gone B", hex: "#654321", recipe: null }];
    await restoreWith(page, backupFile({ docs: [{ col: "tests", id: "ten", data: fullEntry({ dyes }) }] }));
    await tapEl(page, "computer", "#tabbtn-log");
    await page.waitForFunction(() => document.querySelectorAll(".entry").length === 1);
    assert.strictEqual(await page.locator(".entry .ptable .n").count(), 10, "the entry view shows all 10 dyes (AC-42)");
    await tapEl(page, "computer", ".entry [data-edit]");
    await page.locator(".eform").waitFor({ state: "visible" });
    assert.strictEqual(await page.locator(".eform select[data-dyeslot]").count(), 10, "one slot per dye and no empty one past the limit");
    await tapEl(page, "computer", '.eform [type="submit"]');
    await page.waitForFunction(() => /Changes saved/.test(document.querySelector("#logStatus").textContent));
    const doc = await getDoc(page, "tests/ten");
    assert.deepStrictEqual(doc.dyes.map(d => [d.id, d.name, d.hex]), dyes.map(d => [d.id, d.name, d.hex]), "all 10 dyes, in order, as logged");
    assert.strictEqual(doc.predicted.multiply.length, 10);
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});

test("D28 (AC-72, P0): data saved by 0.4.1 (setup, shelf, custom mix, 3-dye log entries, a technique) loads unchanged", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const mix = { id: "custom-1a2b3c4d", code: "Mix", name: "2 Caribbean + 1 Royal", hex: "#0a6fc8", recipe: [{ id: "DGD401", code: "DGD401", name: "Caribbean", parts: 2 }, { id: "DGD408", code: "DGD408", name: "Royal", parts: 1 }] };
    const setup = { base: "#86c6ea", baseName: "Light blue", brand: "Discraft", plastic: "ESP", translucent: false, tech: "glue", pattern: "river", blend: "darken", depth: 0.65, pool: "owned", sel: ["DGD401", "DGD408", mix.id] };
    const dye = (id, code, name, hex) => ({ id, code, name, hex, recipe: null });
    /* Log entries exactly as 0.4.1 wrote them: no patternName, 3 dyes. */
    const e1 = { date: "2026-09-20", createdAt: "2026-09-20T10:00:00.000Z", disc: { hex: "#f5f5f1", name: "white" }, plastic: { brand: "Innova", name: "Star / Shimmer", rating: "E", translucent: false },
      tech: "floetrol", pattern: "cells", depth: 0.8, techName: "Floetrol bed", dyes: [dye("DGD401", "DGD401", "Caribbean", "#03a4c1"), dye("DGD201", "DGD201", "Neon Hot Orange", "#e75001"), { ...mix }],
      predicted: { multiply: ["#03a1bd", "#e24e01", "#0a6dc4"], darken: ["#03a4c1", "#e75001", "#0a6fc8"] }, mix: "½ tsp dye + 1 tsp hot water + 4 oz Floetrol. Add 3-4 drops of silicone oil for cells.",
      setTime: "3 hr", notes: "first try", closer: "darken", photo: null, by: null };
    const e2 = { ...e1, date: "2026-09-21", createdAt: "2026-09-21T10:00:00.000Z", tech: "hotdip", techName: "Hot dip", pattern: "stencil", closer: "", notes: "" };
    const tech = { name: "Lazy wave", looks: "Soft waves", description: "", base: "floetrol", plastics: "Star", dyes: "DGD401", tags: ["favorite"], how: "", mix: "", heat: "Heat lamp, under 120°F", setTime: "3 hr", notes: "", pattern: "cells", photo: null, by: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
    /* The documents first: their arrival re-renders this window, which saves its own setup; the 0.4.1 setup
       is written after that, right before the reload. */
    await setDoc(page, "tests/e1", e1); await setDoc(page, "tests/e2", e2); await setDoc(page, "techniques/t1", tech);
    await page.waitForTimeout(300);
    await page.evaluate(({ setup, mix }) => {
      localStorage.setItem("discdye.setup", JSON.stringify(setup));
      localStorage.setItem("discdye.owned", JSON.stringify(["DGD401", "DGD408", "DGD101", mix.id]));
      localStorage.setItem("discdye.custom", JSON.stringify([mix]));
    }, { setup, mix });
    await page.reload(); await ready(page);
    await page.waitForFunction(() => techLoaded && patsLoaded);
    const s = await page.evaluate(() => ({ base: state.base, tech: state.tech, pattern: state.pattern, blend: state.blend, depth: state.depth, pool: state.pool, sel: state.sel.slice(), perCombo: state.perCombo,
      perComboShown: document.querySelector("#perCombo").value, brand: state.brand, plastic: state.plastic, shelf: document.querySelector("#shelfTitle").textContent,
      mix: state.dyes.find(d => d.id === "custom-1a2b3c4d") }));
    assert.deepStrictEqual([s.base, s.tech, s.pattern, s.blend, s.depth, s.pool, s.brand, s.plastic], ["#86c6ea", "glue", "river", "darken", 0.65, "owned", "Discraft", "ESP"]);
    assert.deepStrictEqual(s.sel, setup.sel, "the 3 picked colors, in order");
    assert.deepStrictEqual([s.perCombo, s.perComboShown], [0, "0"], "a 0.4.x setup opens on As now");
    assert.strictEqual(s.shelf, "My dye shelf (4)");
    assert.deepStrictEqual(s.mix && s.mix.recipe, mix.recipe, "the custom mix keeps its recipe");

    await tapEl(page, "computer", "#tabbtn-log");
    await page.waitForFunction(() => document.querySelectorAll(".entry").length === 2);
    const heads = await page.$$eval(".entry .ehead h3", hs => hs.map(h => h.textContent));
    assert.deepStrictEqual(heads, ["Hot dip: Stencil", "Floetrol bed: Cells"]);
    assert.deepStrictEqual(await page.$$eval(".entry .ptable", ts => ts.map(t => t.querySelectorAll(".n").length)), [3, 3]);
    await tapEl(page, "computer", '.entry[data-id="e1"] [data-edit]');
    await page.locator(".eform").waitFor({ state: "visible" });
    assert.deepStrictEqual(await page.$$eval(".eform select[data-dyeslot]", ss => ss.map(x => x.value)), ["DGD401", "DGD201", "custom-1a2b3c4d", ""]);
    assert.strictEqual(await page.$eval('.eform select[name="pattern"]', x => x.value), "cells");
    await tapEl(page, "computer", ".eform [data-cancel]");
    assert.deepStrictEqual(await getDoc(page, "tests/e1"), e1, "viewing must not change a stored entry");

    await tapEl(page, "computer", "#tabbtn-notes");
    await page.waitForFunction(() => document.querySelectorAll("#myTechList details.tcard").length === 1);
    assert.match(await page.locator("#myTechList").textContent(), /Lazy wave/);
    assert.strictEqual(await page.getAttribute("#mt-t1 canvas.thumb", "data-pattern"), "cells");
    assert.deepStrictEqual(await getDoc(page, "techniques/t1"), tech, "viewing must not change a stored technique");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally { await context.close(); }
});
