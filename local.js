/* DIPS local layer.
   The planner was first built as a claude.ai page and calls claude.ai's storage through
   window.claude.use("db" | "assets" | "user" | "downloads"). This file answers those same calls
   from this device instead (IndexedDB), so the planner code runs unchanged. It also owns
   everything on the "Your data" tab: install help, name, the DIPS folder copy, and backups. */
(function () {
  "use strict";

  /* ---------- IndexedDB ----------
     v1 was the proof of concept (test entries only, nothing worth keeping); v2 drops its stores. */
  const DB_NAME = "dips", DB_VERSION = 2;
  let dbPromise = null;
  function idb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ["entries", "photos"]) if (d.objectStoreNames.contains(s)) d.deleteObjectStore(s);
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
        if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs", { keyPath: "key" });
        if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs", { keyPath: "id" });
      };
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => d.close(); resolve(d); };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("DIPS is open in another window. Close it and try again."));
    });
    return dbPromise;
  }
  function run(store, mode, fn) {
    return idb().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode), req = fn(t.objectStore(store));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const getAll = s => run(s, "readonly", st => st.getAll());
  const getOne = (s, k) => run(s, "readonly", st => st.get(k));
  const putOne = (s, v) => run(s, "readwrite", st => st.put(v));
  const delOne = (s, k) => run(s, "readwrite", st => st.delete(k));
  const meta = {
    get: async k => (await getOne("meta", k))?.value,
    set: (k, v) => putOne("meta", { key: k, value: v }),
    del: k => delOne("meta", k)
  };
  const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- documents (the "db" the planner uses) ----------
     Collections live in memory for instant reads and are written through to IndexedDB. */
  const cols = new Map(), listeners = new Map();
  let loaded = null;
  const colMap = c => { if (!cols.has(c)) cols.set(c, new Map()); return cols.get(c); };
  const load = () => loaded || (loaded = getAll("docs").then(rows => rows.forEach(r => colMap(r.col).set(r.id, r.data))));
  const notify = col => { const s = listeners.get(col); if (s) s.forEach(fn => fn()); };
  function merge(a, b) {
    const o = { ...a };
    for (const [k, v] of Object.entries(b)) {
      const both = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k]);
      o[k] = both ? merge(a[k], v) : v;
    }
    return o;
  }
  async function write(col, id, data) {
    await load();
    if (data === null) { colMap(col).delete(id); await delOne("docs", col + "/" + id); }
    else { const v = clone(data); colMap(col).set(id, v); await putOne("docs", { key: col + "/" + id, col, id, data: v }); }
    notify(col); changed();
  }
  const snap = (id, data) => ({ id, exists: true, data: () => clone(data) });
  function docRef(col, id) {
    return {
      id, path: col + "/" + id,
      async get() { await load(); const d = colMap(col).get(id); return d ? snap(id, d) : { id, exists: false, data: () => undefined }; },
      set: data => write(col, id, data),
      async update(patch) {
        await load();
        const d = colMap(col).get(id);
        if (!d) throw { code: "invalid_argument", message: "That entry no longer exists." };
        await write(col, id, merge(d, patch));
      },
      delete: () => write(col, id, null)
    };
  }
  function query(col, ord, lim) {
    const build = () => {
      let rows = [...colMap(col).entries()];
      if (ord) rows.sort((a, b) => {
        const x = a[1][ord.f], y = b[1][ord.f];
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return ord.dir === "desc" ? -c : c;
      });
      if (lim) rows = rows.slice(0, lim);
      const docs = rows.map(([id, d]) => snap(id, d));
      return { docs, size: docs.length, empty: !docs.length };
    };
    return {
      orderBy: (f, dir = "asc") => query(col, { f, dir }, lim),
      limit: n => query(col, ord, n),
      async get() { await load(); return build(); },
      onSnapshot(next, onError) {
        let live = true;
        const fire = () => load().then(() => { if (live) next(build()); }).catch(e => onError && onError({ code: "unavailable", message: String(e) }));
        if (!listeners.has(col)) listeners.set(col, new Set());
        listeners.get(col).add(fire);
        fire();
        return () => { live = false; listeners.get(col).delete(fire); };
      },
      async add(data) { const id = hex(10); await write(col, id, data); return docRef(col, id); },
      doc: id => docRef(col, id || hex(10))
    };
  }
  const dbApi = {
    collection: c => query(c, null, 0),
    doc: p => { const i = p.lastIndexOf("/"); return docRef(p.slice(0, i), p.slice(i + 1)); }
  };

  /* ---------- photos (the "assets" the planner uses) ----------
     Shrunk to 1600px JPEG on the way in: full-size phone photos make backups too big to build or share. */
  const urls = new Map();
  async function blobURL(id) {
    if (urls.has(id)) return urls.get(id);
    const r = await getOne("blobs", id);
    if (!r) return "";
    const u = URL.createObjectURL(r.blob); urls.set(id, u); return u;
  }
  async function shrink(blob) {
    const img = await createImageBitmap(blob);
    const s = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.85));
  }
  const assetsApi = {
    async upload(blob) {
      let out;
      try { out = await shrink(blob); } catch (_) { throw { code: "unsupported_type", message: "That photo can't be read." }; }
      const id = hex(16);
      await putOne("blobs", { id, blob: out });
      changed();
      return { id, url: await blobURL(id), sizeBytes: out.size, contentType: out.type };
    },
    async delete(id) {
      await delOne("blobs", id);
      const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); }
      changed();
      return { deleted: true };
    }
  };
  /* The planner renders photos as <img data-blob="id">; fill in their sources as they appear. */
  function hydrate() {
    document.querySelectorAll("img[data-blob]").forEach(async im => {
      const id = im.dataset.blob;
      if (im.dataset.blobDone === id) return;
      im.dataset.blobDone = id;
      const u = await blobURL(id);
      if (u) im.src = u; else im.alt = "Photo not found";
    });
  }
  new MutationObserver(hydrate).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- name ("user") ---------- */
  const userApi = {
    async id() { let i = await meta.get("profileId"); if (!i) { i = "me-" + hex(6); await meta.set("profileId", i); } return i; },
    async profiles(ids) {
      const names = (await meta.get("names")) || {}, me = await userApi.id(), mine = (await meta.get("myName")) || "";
      const out = {};
      ids.forEach(i => { out[i] = { name: i === me ? (mine || "you") : (names[i] || "") }; });
      return out;
    }
  };

  /* ---------- saving files ("downloads") ----------
     Phones use the share sheet: plain downloads are unreliable in installed iPhone apps. */
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  async function saveFile(filename, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || "text/plain" });
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    try {
      if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return { status: "saved" }; }
    } catch (e) { if (e && e.name === "AbortError") throw { code: "declined", message: "Canceled" }; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return { status: "saved" };
  }
  const downloadsApi = { save: ({ filename, data }) => saveFile(filename, data) };

  window.claude = { use: async name => (typeof indexedDB === "undefined" ? null : ({ db: dbApi, assets: assetsApi, user: userApi, downloads: downloadsApi })[name] || null) };

  /* ---------- export / import: everything a user has ---------- */
  const LOCAL_KEYS = ["discdye.owned", "discdye.custom", "discdye.setup", "discdye.techsort"];
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === window.localStorage && LOCAL_KEYS.includes(k)) changed(); };
  async function exportData() {
    await load();
    const docs = [];
    cols.forEach((m, col) => m.forEach((data, id) => docs.push({ col, id, data })));
    const local = {};
    LOCAL_KEYS.forEach(k => { try { const v = localStorage.getItem(k); if (v != null) local[k] = v; } catch (_) {} });
    const names = { ...((await meta.get("names")) || {}) }, mine = await meta.get("myName");
    if (mine) names[await userApi.id()] = mine;
    return { app: "DIPS", format: 2, savedAt: new Date().toISOString(), docs, local, names };
  }
  /* Restore and folder import only ADD what this device doesn't have; they never delete or overwrite. */
  async function importData(data, getBlob) {
    if (!data || data.app !== "DIPS") throw new Error("That isn't a DIPS file.");
    await load();
    let added = 0;
    for (const d of data.docs || []) {
      if (!d || !d.col || !d.id || !d.data || colMap(d.col).has(d.id)) continue;
      const pid = d.data.photo;
      if (pid && !(await getOne("blobs", pid))) { const b = await getBlob(pid); if (b) await putOne("blobs", { id: pid, blob: b }); }
      await write(d.col, d.id, d.data); added++;
    }
    const L = data.local || {};
    try {
      const own = new Set(JSON.parse(localStorage.getItem("discdye.owned") || "[]"));
      JSON.parse(L["discdye.owned"] || "[]").forEach(x => own.add(x));
      origSet.call(localStorage, "discdye.owned", JSON.stringify([...own]));
      const cus = JSON.parse(localStorage.getItem("discdye.custom") || "[]"), have = new Set(cus.map(c => c.id));
      JSON.parse(L["discdye.custom"] || "[]").forEach(c => { if (!have.has(c.id)) { cus.push(c); added++; } });
      origSet.call(localStorage, "discdye.custom", JSON.stringify(cus));
      ["discdye.setup", "discdye.techsort"].forEach(k => { if (L[k] && localStorage.getItem(k) == null) origSet.call(localStorage, k, L[k]); });
    } catch (_) {}
    await meta.set("names", { ...((await meta.get("names")) || {}), ...(data.names || {}) });
    return added;
  }
  const hasData = async () => { await load(); let n = 0; cols.forEach(m => { n += m.size; }); return n > 0; };

  /* ---------- the DIPS folder (Chrome/Edge on computers) ---------- */
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const canFolder = "showDirectoryPicker" in window;
  let folder = null, syncTimer = null, syncing = false, lastSync = null, syncErr = "", picked = null;
  async function perm(h, ask) {
    const o = { mode: "readwrite" };
    try { if (await h.queryPermission(o) === "granted") return true; return ask ? (await h.requestPermission(o)) === "granted" : false; }
    catch (_) { return false; }
  }
  function changed() {
    if (folder) { clearTimeout(syncTimer); syncTimer = setTimeout(syncFolder, 1500); }
    nudge();
  }
  /* data.json holds everything but photos; photos are separate JPEGs so saves stay fast.
     Photos deleted in the app are left in the folder on purpose: the folder is a safety copy. */
  async function syncFolder() {
    if (!folder || syncing) return;
    if (!(await perm(folder, false))) { syncErr = "permission"; folderUI(); return; }
    syncing = true;
    try {
      const data = await exportData();
      const w = await (await folder.getFileHandle("data.json", { create: true })).createWritable();
      await w.write(JSON.stringify(data, null, 1)); await w.close();
      const pd = await folder.getDirectoryHandle("photos", { create: true });
      const have = new Set();
      for await (const [n] of pd.entries()) have.add(n);
      for (const b of await getAll("blobs")) {
        const n = b.id + ".jpg";
        if (have.has(n)) continue;
        const pw = await (await pd.getFileHandle(n, { create: true })).createWritable();
        await pw.write(b.blob); await pw.close();
      }
      lastSync = new Date(); syncErr = "";
    } catch (e) { syncErr = e && e.message ? e.message : String(e); }
    finally { syncing = false; folderUI(); }
  }
  async function importFolder() {
    let data;
    try { data = JSON.parse(await (await (await folder.getFileHandle("data.json")).getFile()).text()); } catch (_) { return 0; }
    let pd = null; try { pd = await folder.getDirectoryHandle("photos"); } catch (_) {}
    return importData(data, async id => { if (!pd) return null; try { return await (await pd.getFileHandle(id + ".jpg")).getFile(); } catch (_) { return null; } });
  }
  /* The user picks a place; DIPS keeps its own "DIPS" folder there so Documents doesn't get cluttered.
     A folder that already is (or already holds) a DIPS folder is reused. */
  async function resolveTarget(h) {
    let data = false; try { await h.getFileHandle("data.json"); data = true; } catch (_) {}
    if (data || /^dips$/i.test(h.name)) return { dir: h, create: false, label: `"${h.name}"`, where: h.name };
    try { const sub = await h.getDirectoryHandle("DIPS"); return { dir: sub, create: false, label: `"DIPS" inside "${h.name}"`, where: `${h.name} > DIPS` }; } catch (_) {}
    return { parent: h, create: true, label: `a new "DIPS" folder inside "${h.name}"`, where: `${h.name} > DIPS` };
  }
  async function folderUI() {
    if (!$("#folderSec")) return;
    if (!canFolder) { $("#folderSec").hidden = true; return; }
    $("#folderConfirm").hidden = !picked;
    const where = await meta.get("folderWhere"), w = where ? ` (${esc(where)})` : "";
    if (!folder) {
      $("#folderState").textContent = "Pick a place on this computer, like Documents or a OneDrive folder. DIPS makes its own DIPS folder there and keeps a copy of everything in it automatically. If this browser is ever cleared, pick the same place again and your notes come back.";
      $("#folderBtn").textContent = "Choose where to keep it"; $("#folderForget").hidden = true; return;
    }
    $("#folderForget").hidden = false;
    if (syncErr === "permission" || !(await perm(folder, false))) {
      $("#folderState").innerHTML = `DIPS needs your OK to keep saving to "${esc(folder.name)}"${w}.`;
      $("#folderBtn").textContent = "Allow saving again"; return;
    }
    $("#folderBtn").textContent = "Use a different place";
    $("#folderState").innerHTML = `<span class="okmsg">Keeping a copy in "${esc(folder.name)}"</span>${w}.` +
      (syncErr ? ` <span class="errmsg">The last save didn't work: ${esc(syncErr)}</span>` : lastSync ? ` Last saved ${lastSync.toLocaleTimeString()}.` : "");
  }
  async function initFolder() {
    if (!canFolder) return folderUI();
    const h = await meta.get("folder");
    folder = h || null;
    await folderUI();
    if (folder && await perm(folder, false)) syncFolder();
  }
  function wireFolder() {
    $("#folderBtn").addEventListener("click", async () => {
      try {
        if (folder && $("#folderBtn").textContent === "Allow saving again") {
          if (await perm(folder, true)) { const n = await importFolder(); syncErr = ""; await syncFolder(); if (n) reloadWith(`Brought back ${n} item${n === 1 ? "" : "s"} from your DIPS folder.`); }
          return folderUI();
        }
        const h = await window.showDirectoryPicker({ id: "dips-data", mode: "readwrite", startIn: "documents" });
        picked = await resolveTarget(h);
        $("#folderConfirmText").innerHTML = `DIPS will keep its copy in ${esc(picked.label)}. Is that right?`;
        $("#folderWhere").value = picked.where;
        folderUI();
      } catch (e) { if (e && e.name !== "AbortError") $("#folderState").textContent = "That place can't be used. Try Documents or a folder inside it."; }
    });
    $("#folderYes").addEventListener("click", async () => {
      if (!picked) return;
      try {
        const dir = picked.create ? await picked.parent.getDirectoryHandle("DIPS", { create: true }) : picked.dir;
        picked = null; folder = dir;
        await meta.set("folder", dir); await meta.set("folderWhere", $("#folderWhere").value.trim());
        const n = await importFolder();
        await syncFolder();
        if (n) reloadWith(`Brought back ${n} item${n === 1 ? "" : "s"} from your DIPS folder.`);
      } catch (e) { picked = null; $("#folderState").textContent = "DIPS couldn't make its folder there. Try Documents."; }
      folderUI();
    });
    $("#folderNo").addEventListener("click", () => { picked = null; folderUI(); $("#folderBtn").click(); });
    $("#folderForget").addEventListener("click", async () => { await meta.del("folder"); folder = null; folderUI(); });
  }

  /* ---------- backup file (every device) ---------- */
  const toDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  async function backup() {
    const data = await exportData();
    data.photos = {};
    for (const b of await getAll("blobs")) data.photos[b.id] = await toDataURL(b.blob);
    await saveFile(`DIPS-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data)], { type: "application/json" }));
    await meta.set("lastBackup", new Date().toISOString());
  }
  async function restore(file) {
    const data = JSON.parse(await file.text());
    return importData(data, async id => (data.photos && data.photos[id]) ? await (await fetch(data.photos[id])).blob() : null);
  }
  /* The planner reads the shelf and settings once at startup, so a restore reloads the page. */
  function reloadWith(msg) { try { sessionStorage.setItem("dips.msg", msg); } catch (_) {} location.reload(); }
  const ago = iso => { const d = Math.floor((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
  async function backupUI() {
    if (!$("#backupState")) return;
    const t = await meta.get("lastBackup");
    $("#backupState").textContent = t ? `Last backup file: ${new Date(t).toLocaleString()} (${ago(t)}).` : "No backup file made yet.";
    $("#backupIntro").textContent = canFolder
      ? "A backup file holds everything in one file. Handy for moving DIPS to another device or giving your log to a friend."
      : "On a phone, save a backup file now and then (after a dye session is a good habit) and keep it somewhere safe, like Google Drive or iCloud Drive. If DIPS is ever cleared, restore from it.";
  }
  function wireBackup() {
    $("#backupBtn").addEventListener("click", async () => {
      $("#backupState").textContent = "Making the backup file…";
      try { await backup(); } catch (e) { if (!(e && e.code === "declined")) $("#backupState").textContent = "The backup didn't work. Try again."; }
      backupUI(); nudge();
    });
    $("#restoreIn").addEventListener("change", async e => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try { const n = await restore(f); reloadWith(n ? `Restored ${n} item${n === 1 ? "" : "s"}. Anything you already had was kept.` : "That backup had nothing new for this device."); }
      catch (err) { $("#backupState").textContent = "That file couldn't be restored. " + (err.message || ""); }
    });
  }

  /* ---------- install help, in plain words for the device in hand ---------- */
  let installEvt = null;
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ua = navigator.userAgent, isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua), isFirefox = /Firefox|FxiOS/.test(ua);
  const isMacSafari = /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua) && !isIOS;
  function steps(intro, list) { $("#installState").textContent = intro; const ol = $("#installSteps"); ol.innerHTML = list.map(s => `<li>${s}</li>`).join(""); ol.hidden = !list.length; }
  function installUI() {
    if (!$("#installState")) return;
    $("#installBtn").hidden = !installEvt || standalone();
    if (standalone()) { steps("DIPS is installed on this device. Open it from its icon.", []); return; }
    if (installEvt) { steps("You can install DIPS with one tap:", []); return; }
    if (isIOS) steps("To put DIPS on your home screen:", ["Tap the <b>Share</b> button (a square with an arrow pointing up). On iPhone it's at the bottom of the screen.", "Scroll down and tap <b>Add to Home Screen</b>.", "Tap <b>Add</b>, then open DIPS from its new icon."]);
    else if (isFirefox) steps("Firefox can't install DIPS. You can use it here, but for the full app:", [isAndroid ? "Open this same page in <b>Chrome</b> or <b>Edge</b>." : "Open this same page in <b>Chrome</b> or <b>Edge</b>.", "Follow the install steps shown there."]);
    else if (isAndroid) steps("To install DIPS:", ["Open the browser menu: <b>⋮</b> at the top right in Chrome, or <b>···</b> at the bottom in Edge.", "Tap <b>Install app</b>, <b>Add to phone</b> or <b>Add to Home screen</b>.", "Open DIPS from its new icon."]);
    else if (isMacSafari) steps("To add DIPS to your Dock:", ["In the menu bar, click <b>File</b>.", "Click <b>Add to Dock</b>.", "Open DIPS from the Dock."]);
    else steps("To install DIPS:", ["At the right end of the address bar (where the web address is), click the small <b>install</b> icon: a screen with a down arrow.", "Click <b>Install</b>.", "Open DIPS from its new icon or the Start menu."]);
  }
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; installUI(); nudge(); });
  addEventListener("appinstalled", () => { installEvt = null; installUI(); nudge(); });

  /* ---------- storage safety ---------- */
  async function persistUI() {
    if (!$("#persistState")) return;
    let msg = "This browser doesn't say whether it protects DIPS data.";
    if (navigator.storage && navigator.storage.persist) {
      const ok = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      msg = ok ? "<span class=\"okmsg\">Protected:</span> this browser won't clear DIPS data on its own to free up space."
        : "Not protected yet: the browser might clear DIPS data if the device runs low on space. Installing DIPS and using it regularly usually fixes this.";
    }
    $("#persistState").innerHTML = msg;
  }

  /* ---------- nudges at the top of the app ---------- */
  /* A message left by a restore (the page reloads after one). Read it right away: the planner's own
     startup triggers reminder checks before the page finishes loading, and they must not replace it. */
  let pendingMsg = null;
  try { pendingMsg = sessionStorage.getItem("dips.msg"); sessionStorage.removeItem("dips.msg"); } catch (_) {}
  let messageShowing = !!pendingMsg;
  async function nudge() {
    const el = $("#nudge"); if (!el || messageShowing) return;
    const dismissed = (() => { try { return localStorage.getItem("dips.nudgeHide") === new Date().toISOString().slice(0, 10); } catch (_) { return false; } })();
    let html = "";
    if (!dismissed && !standalone() && (installEvt || isIOS || isAndroid)) html = `Tip: install DIPS on this device so it works without internet and keeps your notes safer. <button type="button" class="btn small" data-goto="data">Show me how</button>`;
    else if (!dismissed && !folder && await hasData()) {
      const t = await meta.get("lastBackup");
      if (!t || Date.now() - new Date(t) > 14 * 86400000) html = `${t ? `Your last backup file was ${ago(t)}.` : "You haven't saved a backup yet."} If this browser is ever cleared, a backup brings your notes back. <button type="button" class="btn small" data-goto="data">Back up now</button>`;
    }
    el.innerHTML = html ? `<span>${html}</span><button type="button" class="nudgex" aria-label="Hide for today">×</button>` : "";
    el.hidden = !html;
  }
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-goto]");
    if (g && typeof window.showTab === "function") { window.showTab(g.dataset.goto); window.scrollTo({ top: 0 }); }
    if (e.target.closest(".nudgex")) {
      if (messageShowing) { messageShowing = false; }
      else { try { localStorage.setItem("dips.nudgeHide", new Date().toISOString().slice(0, 10)); } catch (_) {} }
      nudge();
    }
  });

  /* ---------- name ---------- */
  async function nameUI() { if ($("#myName")) $("#myName").value = (await meta.get("myName")) || ""; }
  function wireName() {
    $("#myNameSave").addEventListener("click", async () => {
      await meta.set("myName", $("#myName").value.trim().slice(0, 40));
      $("#myNameMsg").textContent = "Saved."; changed();
    });
  }

  /* ---------- print the dye sheet (computers; phones use the download) ---------- */
  function wirePrint() {
    const btn = $("#sheetPrint"); if (!btn) return;
    btn.hidden = isMobile;
    btn.addEventListener("click", () => {
      const f = document.createElement("iframe");
      f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
      document.body.appendChild(f);
      const d = f.contentDocument;
      d.open(); d.write(`<pre style="font:12px/1.45 Consolas,monospace;margin:0">${esc($("#sheetPre").textContent || "")}</pre>`); d.close();
      f.contentWindow.focus(); f.contentWindow.print();
      setTimeout(() => f.remove(), 60000);
    });
  }

  window.dipsData = { render() { installUI(); persistUI(); folderUI(); backupUI(); nameUI(); } };

  function start() {
    wireFolder(); wireBackup(); wireName(); wirePrint();
    installUI(); persistUI(); nameUI(); backupUI(); initFolder().then(nudge);
    if (pendingMsg) { const el = $("#nudge"); el.innerHTML = `<span>${esc(pendingMsg)}</span><button type="button" class="nudgex" aria-label="Close">×</button>`; el.hidden = false; }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
