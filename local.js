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
      /* A failed transaction aborts its pending requests, which then report AbortError; the transaction's
         own error (a full device is QuotaExceededError) is the real cause and is set first. A request that
         failed on its own leaves the transaction error empty, so that request's error is used. */
      t.onerror = ev => reject(t.error || (ev.target && ev.target.error));
      t.onabort = () => reject(t.error);
    }));
  }
  /* Store failures reach the planner as plain codes: a full device says so, anything else is "unavailable". */
  const storeErr = e => e && e.name === "QuotaExceededError"
    ? { code: "quota_exceeded", message: "This device is full." }
    : { code: "unavailable", message: "Couldn't reach the saved data." };
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
     The database is the source of truth: a change is stored first, and only then shown. Collections are
     also kept in memory for instant reads. Other windows of DIPS on this device hear about each stored
     change over a BroadcastChannel and re-read that one document, so every window stays in step. */
  const cols = new Map(), listeners = new Map();
  let loaded = null;
  const colMap = c => { if (!cols.has(c)) cols.set(c, new Map()); return cols.get(c); };
  const load = () => loaded || (loaded = getAll("docs").then(rows => rows.forEach(r => colMap(r.col).set(r.id, r.data))).catch(e => { loaded = null; throw e; }));
  const notify = col => { const s = listeners.get(col); if (s) s.forEach(fn => fn()); };
  const chan = "BroadcastChannel" in self ? new BroadcastChannel("dips") : null;
  /* A failed re-read leaves this window as it was; the next change from any window refreshes it. */
  if (chan) chan.onmessage = async ev => {
    const m = ev.data;
    if (!m || typeof m.col !== "string" || typeof m.id !== "string") return;
    try {
      await load();
      const r = await getOne("docs", m.col + "/" + m.id);
      if (r) colMap(m.col).set(m.id, r.data); else colMap(m.col).delete(m.id);
      notify(m.col);
    } catch (_) {}
  };
  function merge(a, b) {
    const o = { ...a };
    for (const [k, v] of Object.entries(b)) {
      const both = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k]);
      o[k] = both ? merge(a[k], v) : v;
    }
    return o;
  }
  async function write(col, id, data) {
    const v = data === null ? null : clone(data);
    try {
      await load();
      if (v === null) await delOne("docs", col + "/" + id);
      else await putOne("docs", { key: col + "/" + id, col, id, data: v });
    } catch (e) { throw storeErr(e); }
    if (v === null) colMap(col).delete(id); else colMap(col).set(id, v);
    if (chan) chan.postMessage({ col, id });
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
      try { await putOne("blobs", { id, blob: out }); } catch (e) { throw storeErr(e); }
      changed();
      return { id, url: await blobURL(id), sizeBytes: out.size, contentType: out.type };
    },
    async delete(id) {
      try { await delOne("blobs", id); } catch (e) { throw storeErr(e); }
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
  const LOCAL_KEYS = ["discdye.owned", "discdye.custom", "discdye.setup", "discdye.techsort", "discdye.logfilter"];
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === window.localStorage && LOCAL_KEYS.includes(k)) changed(); };
  /* Built from the database itself, never from this window's in-memory copy. */
  async function exportData() {
    const docs = (await getAll("docs")).map(r => ({ col: r.col, id: r.id, data: r.data }));
    const local = {};
    LOCAL_KEYS.forEach(k => { try { const v = localStorage.getItem(k); if (v != null) local[k] = v; } catch (_) {} });
    const names = { ...((await meta.get("names")) || {}) }, mine = await meta.get("myName");
    if (mine) names[await userApi.id()] = mine;
    return { app: "DIPS", format: 2, savedAt: new Date().toISOString(), docs, local, names };
  }
  /* Restore and folder import only ADD what this device doesn't have; they never delete or overwrite.
     The incoming file is untrusted: its shape is checked, a bad item is skipped and counted, and
     photos are only ever taken from "data:image/" values, never fetched from anywhere else. */
  const isObj = o => !!o && typeof o === "object" && !Array.isArray(o);
  const isStr = s => typeof s === "string" && s.length > 0;
  const HEX6 = /^#[0-9a-f]{6}$/i, PHOTO_ID = /^[0-9a-f]{32}$/, MAX_BACKUP = 200 * 1024 * 1024;
  const ls = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const parseList = s => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
  /* A log entry or a technique is rebuilt from the complete field list the app itself writes: a field
     keeps its value only when it has the type the app writes, otherwise it takes the app's default, and
     unknown fields are dropped. Colors end up in style attributes, so each kept color is a 6-digit hex
     color. A bad value is never a reason to drop the item: a person's dye job is never dropped over one
     odd field. */
  const colorOk = v => typeof v === "string" && HEX6.test(v);
  const strOr = v => typeof v === "string" ? v : "";
  const strOrNull = v => typeof v === "string" ? v : null;
  const photoOr = v => typeof v === "string" && PHOTO_ID.test(v) ? v : null;
  const cleanRecipeList = r => Array.isArray(r) && r.every(p => isObj(p) && isStr(p.id) && Number.isFinite(p.parts))
    ? r.map(p => ({ id: p.id, code: strOr(p.code), name: strOr(p.name), parts: p.parts })) : null;
  /* A dye that is not an object becomes a blank one, so dye positions stay lined up with the predictions. */
  const cleanLogDye = y => isObj(y)
    ? { id: strOr(y.id), code: strOr(y.code), name: strOr(y.name), hex: colorOk(y.hex) ? y.hex : null, recipe: cleanRecipeList(y.recipe) }
    : { id: "", code: "", name: "", hex: null, recipe: null };
  const CLOSERS = new Set(["", "multiply", "darken", "neither"]);
  function cleanLogEntry(d) {
    const dyes = Array.isArray(d.dyes) ? d.dyes.map(cleanLogDye) : [];
    const disc = isObj(d.disc) ? d.disc : {}, pl = isObj(d.plastic) ? d.plastic : {}, pr = isObj(d.predicted) ? d.predicted : {};
    const pred = k => Array.isArray(pr[k]) ? pr[k].map(v => colorOk(v) ? v : null) : dyes.map(() => null);
    return {
      date: strOr(d.date), disc: { hex: colorOk(disc.hex) ? disc.hex : null, name: strOr(disc.name) },
      plastic: { brand: strOr(pl.brand), name: strOr(pl.name), rating: strOr(pl.rating) || "-", translucent: pl.translucent === true },
      tech: strOr(d.tech), techName: strOr(d.techName), pattern: strOr(d.pattern), depth: Number.isFinite(d.depth) ? d.depth : 0.8,
      dyes, predicted: { multiply: pred("multiply"), darken: pred("darken") },
      mix: strOr(d.mix), setTime: strOr(d.setTime), notes: strOr(d.notes), closer: CLOSERS.has(d.closer) ? d.closer : "",
      photo: photoOr(d.photo), by: strOrNull(d.by), createdAt: strOr(d.createdAt)
    };
  }
  function cleanTechnique(d) {
    return {
      name: strOr(d.name), looks: strOr(d.looks), description: strOr(d.description), base: strOr(d.base),
      plastics: strOr(d.plastics), dyes: strOr(d.dyes), tags: Array.isArray(d.tags) ? d.tags.filter(isStr) : [],
      how: strOr(d.how), mix: strOr(d.mix), heat: strOr(d.heat), setTime: strOr(d.setTime), notes: strOr(d.notes),
      pattern: isStr(d.pattern) ? d.pattern : "swirl", photo: photoOr(d.photo), by: strOrNull(d.by),
      createdAt: strOr(d.createdAt), updatedAt: strOr(d.updatedAt)
    };
  }
  const CLEANERS = new Map([["tests", cleanLogEntry], ["techniques", cleanTechnique]]);
  const count = n => `${n} item${n === 1 ? "" : "s"}`;
  const skipped = bad => bad ? ` ${count(bad)} couldn't be restored.` : "";
  async function importData(data, getBlob) {
    if (!isObj(data) || data.app !== "DIPS") throw { code: "not_dips" };
    if (!Array.isArray(data.docs)) throw { code: "bad_file" };
    await load();
    let added = 0, bad = 0;
    const L = isObj(data.local) ? data.local : {};
    /* A custom dye whose id is taken by a different dye gets a fresh id, and everything incoming that
       points at it (shelf list, recipes, log entries) follows. The same id with the same name and
       color is the same dye. Ids already on this device are never changed. */
    const have = parseList(ls("discdye.custom")), taken = new Set(), byId = new Map(), idMap = new Map(), newDyes = [], seen = new Map();
    have.forEach(c => { if (isObj(c)) { taken.add(c.id); byId.set(c.id, c); } });
    const sameDye = (a, b) => a.name === b.name && String(a.hex).toLowerCase() === b.hex.toLowerCase();
    /* seen holds the first incoming dye for each incoming id: a later one with the same id and the same
       name and color is a duplicate; a different one gets its own fresh id and the references stay with the first. */
    for (const c of parseList(L["discdye.custom"])) {
      if (!isObj(c) || !isStr(c.id) || typeof c.name !== "string" || !HEX6.test(c.hex || "")) { bad++; continue; }
      const mine = byId.get(c.id), prior = seen.get(c.id);
      if (!prior) seen.set(c.id, c);
      if (prior && sameDye(prior, c)) continue;
      if (mine && sameDye(mine, c)) continue;
      if (!mine && !prior) { taken.add(c.id); newDyes.push(c); }
      else {
        let id; do { id = "custom-" + hex(4); } while (taken.has(id));
        taken.add(id); if (!prior) idMap.set(c.id, id); newDyes.push({ ...c, id });
      }
    }
    const mapId = id => idMap.get(id) || id;
    const remapRecipe = r => Array.isArray(r) ? r.map(p => isObj(p) ? { ...p, id: mapId(p.id) } : p) : r;
    const remapDyes = a => a.map(y => isObj(y) ? { ...y, id: mapId(y.id), ...(y.recipe ? { recipe: remapRecipe(y.recipe) } : {}) } : y);
    newDyes.forEach(c => { if (c.recipe) c.recipe = remapRecipe(c.recipe); });
    for (const d of data.docs) {
      try {
        if (!isObj(d) || !isStr(d.col) || !isStr(d.id) || !isObj(d.data)) { bad++; continue; }
        if (await getOne("docs", d.col + "/" + d.id)) continue;
        const clean = CLEANERS.get(d.col);
        const entry = clean ? clean(d.data) : d.data;
        const pid = entry.photo;
        if (!clean && pid && (typeof pid !== "string" || !PHOTO_ID.test(pid))) { bad++; continue; }
        const doc = idMap.size && Array.isArray(entry.dyes) ? { ...entry, dyes: remapDyes(entry.dyes) } : entry;
        if (pid && !(await getOne("blobs", pid))) {
          let b = null;
          try { b = await getBlob(pid); } catch (_) {}
          if (b) await putOne("blobs", { id: pid, blob: b });
        }
        await write(d.col, d.id, doc); added++;
      } catch (_) { bad++; }
    }
    try {
      const inOwned = parseList(L["discdye.owned"]);
      if (inOwned.length) {
        const own = new Set(parseList(ls("discdye.owned")).filter(isStr));
        inOwned.forEach(x => { if (isStr(x)) own.add(mapId(x)); else bad++; });
        origSet.call(localStorage, "discdye.owned", JSON.stringify([...own]));
      }
      if (newDyes.length) origSet.call(localStorage, "discdye.custom", JSON.stringify(have.concat(newDyes)));
      added += newDyes.length;
      ["discdye.setup", "discdye.techsort", "discdye.logfilter"].forEach(k => { if (typeof L[k] === "string" && L[k].length <= 20000 && ls(k) == null) origSet.call(localStorage, k, L[k]); });
    } catch (_) { bad += newDyes.length; }
    const names = {};
    if (isObj(data.names)) for (const [k, v] of Object.entries(data.names)) if (typeof v === "string") names[k] = v.slice(0, 40);
    await meta.set("names", { ...names, ...((await meta.get("names")) || {}) });
    return { added, bad };
  }
  const hasData = async () => {
    await load();
    let n = 0; cols.forEach(m => { n += m.size; });
    return n > 0 || parseList(ls("discdye.custom")).length + parseList(ls("discdye.owned")).length > 0;
  };
  /* Every failure shown to a person is one of these sentences; browser error text never is. */
  const FOLDER_UNREADABLE = "DIPS couldn't read the data file in this folder, so it hasn't changed anything there. Your other DIPS data is untouched. Pick a different place, or move that file out of the folder and try again.";
  function plain(e) {
    const c = e && (e.code || e.name);
    if (c === "quota_exceeded" || c === "QuotaExceededError") return "There isn't enough room on this device.";
    if (c === "folder_unreadable") return FOLDER_UNREADABLE;
    if (c === "not_dips") return "That isn't a DIPS backup file.";
    if (c === "bad_file" || e instanceof SyntaxError) return "That file doesn't look like a DIPS backup.";
    if (c === "too_big") return "That file is too big to be a DIPS backup.";
    if (c === "NotAllowedError" || c === "SecurityError") return "DIPS doesn't have permission to do that.";
    if (c === "NotFoundError") return "DIPS couldn't find the folder or file.";
    return "Something went wrong. Try again.";
  }

  /* ---------- the DIPS folder (Chrome/Edge on computers) ---------- */
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const canFolder = "showDirectoryPicker" in window;
  /* dirty: something changed since the last export was taken. folderChecked: this folder's data file has
     been confirmed readable (or absent) this session, so saving can't overwrite a file DIPS can't read.
     folderNote: a plain-words problem with the folder, shown on the Your data tab.
     pickNote: a problem with the place just picked; it concerns that pick only, never the folder in use. */
  let folder = null, syncTimer = null, syncing = false, dirty = false, folderChecked = false, lastSync = null, syncErr = "", folderNote = "", pickNote = "", picked = null;
  async function perm(h, ask) {
    const o = { mode: "readwrite" };
    try { if (await h.queryPermission(o) === "granted") return true; return ask ? (await h.requestPermission(o)) === "granted" : false; }
    catch (_) { return false; }
  }
  function changed() {
    if (folder) { dirty = true; clearTimeout(syncTimer); syncTimer = setTimeout(syncFolder, 1500); }
    nudge();
  }
  /* data.json holds everything but photos; photos are separate JPEGs so saves stay fast.
     Photos deleted in the app are left in the folder on purpose: the folder is a safety copy.
     A change that arrives while a save runs leaves dirty set, and a successful save saves again.
     A failed save is not retried until the next change. */
  async function syncFolder() {
    if (!folder || syncing) return;
    syncing = true;
    let ok = false;
    try {
      if (!(await perm(folder, false))) { syncErr = "permission"; return; }
      if (!folderChecked) { await readFolderData(folder); folderChecked = true; }
      dirty = false;
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
      lastSync = new Date(); syncErr = ""; folderNote = ""; ok = true;
    } catch (e) {
      syncErr = plain(e);
      if (e && e.code === "folder_unreadable") folderNote = syncErr;
    }
    finally {
      syncing = false;
      if (dirty && ok) { clearTimeout(syncTimer); syncTimer = setTimeout(syncFolder, 1500); }
      folderUI(); nudge();
    }
  }
  /* null when the folder has no data file yet; throws folder_unreadable when it has one DIPS can't use. */
  async function readFolderData(dir) {
    let fh;
    try { fh = await dir.getFileHandle("data.json"); }
    catch (e) { if (e && e.name === "NotFoundError") return null; throw { code: "folder_unreadable" }; }
    try { const d = JSON.parse(await (await fh.getFile()).text()); if (isObj(d) && d.app === "DIPS" && Array.isArray(d.docs)) return d; } catch (_) {}
    throw { code: "folder_unreadable" };
  }
  async function importFolder(dir) {
    const data = await readFolderData(dir);
    if (!data) return { added: 0, bad: 0 };
    let pd = null; try { pd = await dir.getDirectoryHandle("photos"); } catch (_) {}
    return importData(data, async id => { if (!pd) return null; try { return await (await pd.getFileHandle(id + ".jpg")).getFile(); } catch (_) { return null; } });
  }
  const folderBack = r => {
    if (r.added || r.bad) reloadWith((r.added ? `Brought back ${count(r.added)} from your DIPS folder.` : "Your DIPS folder had nothing new for this device.") + skipped(r.bad));
  };
  function folderUnreadable(e) { folderNote = plain(e); syncErr = folderNote; folderUI(); nudge(); }
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
    const note = folderNote ? `<span class="errmsg">${esc(folderNote)}</span>` : "";
    const pick = pickNote ? ` <span class="errmsg">${esc(pickNote)}</span>` : "";
    if (!folder) {
      $("#folderState").innerHTML = "Pick a place on this computer, like Documents or a OneDrive folder. DIPS makes its own DIPS folder there and keeps a copy of everything in it automatically. If this browser is ever cleared, pick the same place again and your notes come back." + (note ? " " + note : "") + pick;
      $("#folderBtn").textContent = "Choose where to keep it"; $("#folderForget").hidden = true; return;
    }
    $("#folderForget").hidden = false;
    if (syncErr === "permission" || !(await perm(folder, false))) {
      $("#folderState").innerHTML = `DIPS needs your OK to keep saving to "${esc(folder.name)}"${w}.`;
      $("#folderBtn").textContent = "Allow saving again"; return;
    }
    $("#folderBtn").textContent = "Use a different place";
    $("#folderState").innerHTML = (note || `<span class="okmsg">Keeping a copy in "${esc(folder.name)}"</span>${w}.` +
      (syncErr ? ` <span class="errmsg">The last save didn't work: ${esc(syncErr)}</span>` : lastSync ? ` Last saved ${lastSync.toLocaleTimeString()}.` : "")) + pick;
  }
  async function initFolder() {
    if (!canFolder) return folderUI();
    const h = await meta.get("folder");
    folder = h || null; folderChecked = false;
    await folderUI();
    if (folder && await perm(folder, false)) syncFolder();
  }
  function wireFolder() {
    $("#folderBtn").addEventListener("click", async () => {
      folderNote = ""; pickNote = "";
      try {
        if (folder && $("#folderBtn").textContent === "Allow saving again") {
          if (await perm(folder, true)) { const r = await importFolder(folder); folderChecked = true; syncErr = ""; await syncFolder(); folderBack(r); }
          return folderUI();
        }
        const h = await window.showDirectoryPicker({ id: "dips-data", mode: "readwrite", startIn: "documents" });
        picked = await resolveTarget(h);
        $("#folderConfirmText").innerHTML = `DIPS will keep its copy in ${esc(picked.label)}. Is that right?`;
        $("#folderWhere").value = picked.where;
        folderUI();
      } catch (e) {
        if (e && e.code === "folder_unreadable") folderUnreadable(e);
        else if (e && e.name !== "AbortError") $("#folderState").textContent = "That place can't be used. Try Documents or a folder inside it.";
      }
    });
    /* The folder is adopted only after its data file has been read, so a file DIPS can't read is never overwritten. */
    $("#folderYes").addEventListener("click", async () => {
      if (!picked) return;
      pickNote = "";
      try {
        const dir = picked.create ? await picked.parent.getDirectoryHandle("DIPS", { create: true }) : picked.dir;
        picked = null;
        const r = await importFolder(dir);
        folder = dir; folderChecked = true; syncErr = ""; folderNote = "";
        await meta.set("folder", dir); await meta.set("folderWhere", $("#folderWhere").value.trim());
        await syncFolder();
        folderBack(r);
      } catch (e) {
        picked = null;
        if (e && e.code === "folder_unreadable") { pickNote = plain(e); folderUI(); return; }
        $("#folderState").textContent = "DIPS couldn't make its folder there. Try Documents.";
      }
      folderUI();
    });
    $("#folderNo").addEventListener("click", () => { picked = null; folderUI(); $("#folderBtn").click(); });
    $("#folderForget").addEventListener("click", async () => {
      await meta.del("folder"); folder = null; folderChecked = false; folderNote = ""; pickNote = ""; syncErr = ""; dirty = false; clearTimeout(syncTimer);
      folderUI(); nudge();
    });
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
    if (file.size > MAX_BACKUP) throw { code: "too_big" };
    const data = JSON.parse(await file.text());
    return importData(data, async id => {
      const u = isObj(data.photos) ? data.photos[id] : null;
      return typeof u === "string" && u.startsWith("data:image/") ? await (await fetch(u)).blob() : null;
    });
  }
  /* The planner reads the shelf and settings once at startup, so a restore reloads the page. */
  function reloadWith(msg) { try { sessionStorage.setItem("dips.msg", msg); } catch (_) {} location.reload(); }
  const ago = iso => { const d = Math.floor((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
  async function backupUI() {
    if (!$("#backupState")) return;
    const t = await meta.get("lastBackup");
    $("#backupState").textContent = t ? `Last backup file: ${new Date(t).toLocaleString()} (${ago(t)}).` : "No backup file made yet.";
    $("#backupIntro").textContent = canFolder
      ? "A backup file holds everything in one file. Handy for moving DIPS to another device."
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
      try {
        const { added, bad } = await restore(f);
        reloadWith((added ? `Restored ${count(added)}. Anything you already had was kept.` : "That backup had nothing new for this device.") + skipped(bad));
      }
      catch (err) { $("#backupState").textContent = "That file couldn't be restored. " + plain(err); }
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
  /* One reminder at a time, most important first: a folder that stopped saving, then an overdue backup
     (when no folder is working), then the install tip. Each kind is hidden for today on its own. */
  const today = () => new Date().toISOString().slice(0, 10);
  const nudgeHidden = k => { try { return localStorage.getItem("dips.nudgeHide." + k) === today(); } catch (_) { return false; } };
  async function nudge() {
    const el = $("#nudge"); if (!el || messageShowing) return;
    const folderBad = !!folder && (!!syncErr || !(await perm(folder, false)));
    let kind = "", html = "";
    if (folderBad && !nudgeHidden("folder")) {
      kind = "folder"; html = `DIPS isn't saving to your folder right now. <button type="button" class="btn small" data-goto="data">Fix it</button>`;
    } else if ((!folder || folderBad) && !nudgeHidden("backup") && await hasData()) {
      const t = await meta.get("lastBackup");
      if (!t || Date.now() - new Date(t) > 14 * 86400000) {
        kind = "backup"; html = `${t ? `Your last backup file was ${ago(t)}.` : "You haven't saved a backup yet."} If this browser is ever cleared, a backup brings your notes back. <button type="button" class="btn small" data-goto="data">Back up now</button>`;
      }
    }
    if (!html && !nudgeHidden("install") && !standalone() && (installEvt || isIOS || isAndroid)) {
      kind = "install"; html = `Tip: install DIPS on this device so it works without internet and keeps your notes safer. <button type="button" class="btn small" data-goto="data">Show me how</button>`;
    }
    el.innerHTML = html ? `<span>${html}</span><button type="button" class="nudgex" data-kind="${kind}" aria-label="Hide for today">×</button>` : "";
    el.hidden = !html;
  }
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-goto]");
    if (g && typeof window.showTab === "function") { window.showTab(g.dataset.goto); window.scrollTo({ top: 0 }); }
    const x = e.target.closest(".nudgex");
    if (x) {
      if (messageShowing) { messageShowing = false; }
      else if (x.dataset.kind) { try { localStorage.setItem("dips.nudgeHide." + x.dataset.kind, today()); } catch (_) {} }
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
    /* A saved install prompt works once, so it is cleared before it is shown. */
    $("#installBtn").addEventListener("click", async () => {
      const e = installEvt; if (!e) return;
      installEvt = null; $("#installBtn").hidden = true;
      try { await e.prompt(); await e.userChoice; } catch (_) {}
      installUI(); nudge();
    });
    installUI(); persistUI(); nameUI(); backupUI(); initFolder().then(nudge);
    if (pendingMsg) { const el = $("#nudge"); el.innerHTML = `<span>${esc(pendingMsg)}</span><button type="button" class="nudgex" aria-label="Close">×</button>`; el.hidden = false; }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
