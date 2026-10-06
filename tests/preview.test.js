"use strict";
/* Screen checks for 0.5.0 (Story 0.5.0, Blueprint 0.5.0 §13): the disc pictures on the graphics chip
   and without it, photo patterns, up to 8 dyes, Dyes per combo, "Where they touch", and every pattern
   on every bed. They run in the installed Edge, where the graphics chip works (E12); E11 and E13 also
   run the flat drawing. Taps go through real screen points, as in screen.test.js. Pixel work runs in
   the page and returns small summaries. */
const { test, assert, openApp, tapEl, boxOf, stateSel, reopen, showWheel, clearPicked, openShelf, noGraphics, countSurfaces } = require("./harness.js");

const YELLOW = "#f2dc3c", WHITE = "#f5f5f1";
/* Eight far-apart ProChem jar colors: Flame Scarlet, Royal, Neon Key Lime, Neon Cerise Pink, Caribbean, Creamsicle, Pansy, Neon Lemon Zest. */
const DYES8 = ["#fc3110", "#0531ce", "#01fe0f", "#e544ab", "#03a4c1", "#fb7f03", "#7f379a", "#defd02"];
/* Five strongly different colors for the photo checks. */
const STRONG = ["#fc3110", "#0531ce", "#01fe0f", "#defd02", "#7f379a"];
const BUILTIN = ["spin", "offcenter", "lollipop", "cells", "swirl", "river", "starburst", "full", "doubledip", "dipfade", "stencil"];
const PHOTOS = ["photo-cells", "photo-flames", "photo-spoked"];
const USUAL = { spin: ["spin", "offcenter", "lollipop"], floetrol: ["cells", "swirl", "river"], glue: ["swirl", "river", "starburst"], cream: ["swirl", "starburst", "river"], hotdip: ["full", "doubledip", "dipfade", "stencil"] };

/* Page-side helpers: a test picture drawn by the app's drawDiscOn, the engine's raw output (no finish)
   or the flat photo recolor, and pixel summaries. Disc geometry is the app's: radius W/2 - max(3, 3% of W). */
const helpers = page => page.evaluate(() => {
  if (window.__t) return;
  const geom = (S, W) => ({ c: S / 2, r: (W / 2 - Math.max(3, W * 0.03)) * S / W });
  window.__t = {
    disc(W, base, cols, pattern, blend = "multiply") {
      let cv = document.getElementById("__tcv");
      if (!cv) { cv = document.createElement("canvas"); cv.id = "__tcv"; cv.style.cssText = "position:absolute;left:0;top:0;pointer-events:none"; document.body.appendChild(cv); }
      cv.style.width = cv.style.height = W + "px";
      drawDiscOn(cv, W, base, cols, pattern, blend);
      return { S: cv.width, W, d: cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data };
    },
    raw(S, W, base, cols, pattern, blend = "multiply", flat = false) {
      const cv = document.createElement("canvas"); cv.width = cv.height = S;
      const ctx = cv.getContext("2d"), { c, r } = geom(S, W);
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
      let ok;
      if (flat) { ctx.setTransform(S / W, 0, 0, S / W, 0, 0); ok = DiscPreview.flatPhoto(ctx, W, base, cols, pattern, blend); }
      else ok = DiscPreview.drawInto(ctx, S, W, base, cols, pattern, blend);
      return ok ? { S, W, d: ctx.getImageData(0, 0, S, S).data } : null;
    },
    /* Engine off for one call: drawDiscOn then takes the flat path. */
    flat(f) { const keep = DiscPreview.drawInto; DiscPreview.drawInto = () => false; try { return f(); } finally { DiscPreview.drawInto = keep; } },
    geom,
    inside(img, rhoMax = 0.95) { const { c, r } = geom(img.S, img.W), out = []; for (let y = 0; y < img.S; y++) for (let x = 0; x < img.S; x++) { const dx = (x + 0.5 - c) / r, dy = (y + 0.5 - c) / r; if (dx * dx + dy * dy <= rhoMax * rhoMax) out.push((y * img.S + x) * 4); } return out; },
    at(img, px, py) { const { c, r } = geom(img.S, img.W), i = (Math.floor(c + py * r) * img.S + Math.floor(c + px * r)) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2], img.d[i + 3]]; },
    distinct(img) { const s = new Set(); for (const i of this.inside(img)) s.add((img.d[i] >> 3) << 10 | (img.d[i + 1] >> 3) << 5 | (img.d[i + 2] >> 3)); return s.size; },
    differ(a, b, tol = 6) { let n = 0; const idx = this.inside(a); for (const i of idx) if (Math.abs(a.d[i] - b.d[i]) > tol || Math.abs(a.d[i + 1] - b.d[i + 1]) > tol || Math.abs(a.d[i + 2] - b.d[i + 2]) > tol) n++; return n / idx.length; },
    rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; },
    near(px, list) { let best = 0, bd = Infinity; list.forEach((q, j) => { const d = (px[0] - q[0]) ** 2 + (px[1] - q[1]) ** 2 + (px[2] - q[2]) ** 2; if (d < bd) { bd = d; best = j; } }); return best; },
    /* Reads a picture through a copy: calling getImageData on the app's own canvas again and again can make
       the browser switch that canvas to a different way of drawing, which changes edge pixels slightly. */
    copy(cv) { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(cv, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; },
    hash(cv) { const d = this.copy(cv); let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return cv.width + "x" + cv.height + ":" + h; },
    /* A picture on screen is drawn: opaque at the center and more than a flat fill. */
    drawn(cv) { const S = cv.width, d = cv.getContext("2d").getImageData(0, 0, S, S).data, i = ((S >> 1) * S + (S >> 1)) * 4, set = new Set(); for (let j = 0; j < d.length; j += 16) if (d[j + 3] === 255) set.add(d[j] << 16 | d[j + 1] << 8 | d[j + 2]); return d[i + 3] === 255 && set.size > 10; }
  };
});
const photoReady = (page, keys) => page.waitForFunction(ks => ks.every(k => DiscPreview.photoState(k) === "ready"), keys);
const seedTechniques = (page, n, extra) => page.evaluate(async ({ n, extra }) => {
  const db = await window.claude.use("db"), now = new Date().toISOString();
  for (let i = 0; i < n; i++) await db.collection("techniques").add({ name: `Zed ${String(i).padStart(2, "0")}`, pattern: ["swirl", "cells", "river", "spin"][i % 4], base: "floetrol", createdAt: now, updatedAt: now, ...extra });
}, { n, extra: extra || {} });
const setPlanner = (page, s) => page.evaluate(s => { Object.assign(state, s); renderTech(); renderRoles(); render(); }, s);
const prochemIds = (page, n) => page.evaluate(n => state.dyes.filter(d => d.fam !== "c").slice(0, n).map(d => d.id), n);

/* The engine builds each pattern family's program in the background after the first screen, so a
   check that needs the engine waits for it; a program that failed to build fails the check by name.
   The short pause lets the redraw that follows a finished program run. */
const engine = async (page, keys = BUILTIN) => {
  await page.waitForFunction(ks => ks.every(k => { const s = DiscPreview.state(k); if (s === "failed") throw new Error(`${k}: the drawing program failed to build`); return s === "ready"; }), keys, { timeout: 60000 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
};
/* Long tasks (main thread busy 50 ms or more), recorded from the very start of each page load. */
const watchLongTasks = context => context.addInitScript(() => {
  window.__long = [];
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ type: "longtask" }); } catch (_) {}
});

/* ---------- A. the drawing engine ---------- */
/* AC-20 / North Star P4-P6: the first open after an update (fresh profile, nothing cached) must not
   freeze. Measure: the longest main-thread task during the first load, from page start until every
   Cliff Notes and Planner pattern's program is built, with the graphics chip, compared with the same
   first load without it. The engine may add at most 200 ms to the longest task. Comparing the two runs
   on the same machine keeps the check independent of how fast the test computer is. */
test("E0: the first open is not frozen by the graphics chip: no startup task is more than 200 ms longer than without it", async () => {
  const firstLoad = async (init, waitFor) => {
    let longest = null;
    const { context } = await openApp("computer", { init: [watchLongTasks, ...init], onFirstLoad: async page => {
      await page.waitForFunction(() => /^#[0-9a-f]{6}$/.test(document.querySelector("#baseHex").value));
      await waitFor(page);
      await page.waitForTimeout(300);
      longest = await page.evaluate(() => Math.max(0, ...window.__long));
    } });
    await context.close();
    return longest;
  };
  const without = await firstLoad([noGraphics], page => page.waitForTimeout(1000));
  const withChip = await firstLoad([], page => engine(page, ["spin", "cells", "river", "starburst", "stencil"]));
  assert.ok(withChip <= without + 200, `the longest startup task was ${withChip.toFixed(0)} ms with the graphics chip, ${without.toFixed(0)} ms without it`);
});

test("E12: the installed Edge the checks use builds every drawing program, so no run quietly tests only the flat drawing", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    const keys = ["spin", "cells", "starburst", "full", "photo-cells"]; /* one pattern from each program family */
    await page.waitForFunction(ks => ks.every(k => !["waiting", "compiling"].includes(DiscPreview.state(k))), keys, { timeout: 60000 });
    const states = await page.evaluate(ks => ks.map(k => DiscPreview.state(k)), keys);
    assert.deepStrictEqual(states, keys.map(() => "ready"), `program states ${states.join(", ")} (AC-12: tell Sean if the test Edge cannot draw)`);
    assert.strictEqual(await page.evaluate(() => DiscPreview.ready()), true);
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

test("E1: the Planner preview, the five Cliff Notes pictures and the My techniques pictures are all drawn by the engine", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await seedTechniques(page, 3);
    await page.waitForFunction(() => myTechDocs.length === 3);
    await engine(page);
    await page.evaluate(() => {
      window.__draws = [];
      const f = DiscPreview.drawInto;
      DiscPreview.drawInto = (ctx, ...a) => { const ok = f(ctx, ...a); window.__draws.push({ id: ctx.canvas.id, thumb: ctx.canvas.classList.contains("thumb"), ok }); return ok; };
      render();
    });
    await tapEl(page, "computer", "#tabbtn-notes");
    await page.waitForFunction(() => !document.querySelector("#tab-notes").hidden);
    const draws = await page.evaluate(() => window.__draws);
    assert.ok(draws.some(d => d.id === "disc" && d.ok), "the Planner preview was not drawn by the engine");
    const thumbs = draws.filter(d => d.thumb);
    assert.ok(thumbs.length >= 8, `expected the 5 Cliff Notes and 3 technique pictures, got ${thumbs.length}`);
    assert.ok(draws.every(d => d.ok), "a picture fell back to the flat drawing");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

test("E2: all 11 patterns draw with 0, 1, 3 and 8 dyes on yellow, and every dye shows", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page);
    const rows = await page.evaluate(({ BUILTIN, DYES8, YELLOW }) => {
      const out = [];
      for (const p of BUILTIN) for (const n of [0, 1, 3, 8]) {
        const cols = DYES8.slice(0, n), img = __t.disc(280, YELLOW, cols, p), row = { p, n, alpha: __t.at(img, 0, 0)[3], shows: [] };
        for (let k = 0; k < n; k++) { const c2 = cols.slice(); c2[k] = "#000000"; row.shows.push(__t.differ(img, __t.disc(280, YELLOW, c2, p))); }
        out.push(row);
      }
      return out;
    }, { BUILTIN, DYES8, YELLOW });
    for (const r of rows) {
      assert.strictEqual(r.alpha, 255, `${r.p} with ${r.n} dyes is blank`);
      r.shows.forEach((f, k) => assert.ok(f >= 0.01, `${r.p} with ${r.n} dyes: dye ${k + 1} does not show (${(f * 100).toFixed(2)}% changed)`));
    }
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

test("E3: Full dip with 1, Stencil with 1-2 and Double dip with 1-3 dyes look as today's flat drawing", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page);
    const rows = await page.evaluate(({ DYES8, YELLOW }) => [["full", 1], ["stencil", 1], ["stencil", 2], ["doubledip", 1], ["doubledip", 2], ["doubledip", 3]].map(([p, n]) => {
      const cols = DYES8.slice(0, n), a = __t.disc(280, YELLOW, cols, p), b = __t.flat(() => __t.disc(280, YELLOW, cols, p));
      return { p, n, agree: 1 - __t.differ(a, b, 6) };
    }), { DYES8, YELLOW });
    for (const r of rows) assert.ok(r.agree >= 0.95, `${r.p} with ${r.n}: only ${(r.agree * 100).toFixed(1)}% matches today's drawing`);
  } finally { await context.close(); }
});

test("E4: edges between two dyes are crisp at 84, 280 and 560 px, at pixel ratio 1 and 2", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page, ["full", "stencil"]);
    const rows = await page.evaluate(({ DYES8, YELLOW }) => {
      const out = [], close = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= 6;
      /* Walk a line of pixels from point A to point B (disc units) and count pixels that match neither end. */
      /* A vertical line of pixels through the disc's center column, from y = A to y = B (disc units, +y down). */
      const mixed = (img, A, B) => {
        const { c, r } = __t.geom(img.S, img.W), x = Math.floor(c), px = y => { const i = (y * img.S + x) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2]]; };
        const y0 = Math.floor(c + A * r), y1 = Math.floor(c + B * r), a = px(y0), b = px(y1);
        let n = 0;
        for (let y = y0; y <= y1; y++) { const q = px(y); if (!close(q, a) && !close(q, b)) n++; }
        return { n, ends: !close(a, b) };
      };
      for (const W of [84, 280, 560]) for (const ratio of [1, 2]) {
        const S = Math.round(W * ratio);
        const full = __t.raw(S, W, YELLOW, DYES8.slice(0, 2), "full"), st = __t.raw(S, W, YELLOW, DYES8.slice(0, 2), "stencil");
        /* Full dip: the band edge near the middle. Stencil: the inner edge of the rim ring at .92. */
        out.push({ W, ratio, full: mixed(full, -0.3, 0.3), stencil: mixed(st, 0.85, 0.975) });
      }
      return out;
    }, { DYES8, YELLOW });
    for (const r of rows) {
      for (const k of ["full", "stencil"]) {
        assert.ok(r[k].ends, `${k} ${r.W}px x${r.ratio}: the line does not cross two colors`);
        assert.ok(r[k].n <= 2, `${k} ${r.W}px x${r.ratio}: ${r[k].n} blurred pixels across the edge`);
      }
    }
  } finally { await context.close(); }
});

/* Best-effort measurement of the clean-picture limit (Blueprint 0.5.0 §3.5): a one-color region of 4 to
   23 pixels (soft edge included) with a flat middle, inside .75 of the radius. Dip fade (a gradient) and Starburst (tapering ray
   tips are allowed) are left out. Line widths are held by the shader's minimum and not measured here. */
test("E5: at 280 px with 8 dyes no pattern has a speck of color", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page);
    const rows = await page.evaluate(({ BUILTIN, DYES8, YELLOW }) => BUILTIN.filter(p => p !== "dipfade" && p !== "starburst").map(p => {
      const img = __t.raw(280, 280, YELLOW, DYES8, p), S = 280, d = img.d, { c, r } = __t.geom(S, 280);
      const same = (i, j, tol) => Math.abs(d[i] - d[j]) <= tol && Math.abs(d[i + 1] - d[j + 1]) <= tol && Math.abs(d[i + 2] - d[j + 2]) <= tol;
      const inZone = (x, y) => ((x + 0.5 - c) / r) ** 2 + ((y + 0.5 - c) / r) ** 2 <= 0.75 * 0.75;
      const core = (x, y) => { const i = (y * S + x) * 4; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!same(i, ((y + dy) * S + x + dx) * 4, 3)) return false; return true; };
      const seen = new Uint8Array(S * S), specks = [];
      for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
        if (seen[y * S + x] || !inZone(x, y) || !core(x, y)) continue;
        const stack = [[x, y]]; seen[y * S + x] = 1; let size = 0, cores = 0, touchesEdge = false, x0 = x, x1 = x, y0 = y, y1 = y;
        while (stack.length) {
          const [X, Y] = stack.pop(); size++; if (core(X, Y)) cores++;
          x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
          for (const [nx, ny] of [[X + 1, Y], [X - 1, Y], [X, Y + 1], [X, Y - 1]]) {
            if (nx < 1 || ny < 1 || nx >= S - 1 || ny >= S - 1) continue;
            if (!inZone(nx, ny)) { touchesEdge = true; continue; }
            /* A region is every connected pixel close to its own color (within 48 levels of the first pixel),
               so a thin ring stays one region all round, soft edges included, and is never split into flat
               islands where it narrows. */
            if (seen[ny * S + nx] || !same((y * S + x) * 4, (ny * S + nx) * 4, 48)) continue;
            seen[ny * S + nx] = 1; stack.push([nx, ny]);
          }
        }
        /* AC-5: a one-color region of 4 to 23 pixels in all (about the .04r = 5 px limit at 280 px) with a flat middle. */
        if (!touchesEdge && cores >= 1 && size >= 4 && size <= 23) {
          /* Where and what, so a failure can be found on the picture: distance from the center (fraction of
             the radius), angle (degrees, 0 = right, clockwise), its box, and its color. */
          const mx = (x0 + x1 + 1) / 2 - c, my = (y0 + y1 + 1) / 2 - c, i = (y * S + x) * 4;
          specks.push(`rho ${(Math.hypot(mx, my) / r).toFixed(3)} at ${Math.round((Math.atan2(my, mx) * 180 / Math.PI + 360) % 360)}deg, ${x1 - x0 + 1}x${y1 - y0 + 1}px, ${cores} core of ${size}, rgb(${d[i]},${d[i + 1]},${d[i + 2]})`);
        }
      }
      return { p, specks };
    }), { BUILTIN, DYES8, YELLOW });
    for (const r of rows) assert.strictEqual(r.specks.length, 0, `${r.p}: ${r.specks.length} specks of color: ${r.specks.join("; ")}`);
  } finally { await context.close(); }
});

test("E6: with no dyes the engine and the flat drawing give the same picture (one shared disc finish)", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page);
    const f = await page.evaluate(({ BUILTIN, YELLOW }) => BUILTIN.map(p => { const a = __t.disc(280, YELLOW, [], p), b = __t.flat(() => __t.disc(280, YELLOW, [], p)); return __t.differ(a, b, 1); }), { BUILTIN, YELLOW });
    f.forEach((v, i) => assert.strictEqual(v, 0, `${BUILTIN[i]}: the finish differs between the two paths`));
  } finally { await context.close(); }
});

test("E7: drawn colors equal the predictions: one dye matches its card, two overlapping dyes match Where they touch", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page, ["full", "doubledip"]);
    const [a, b] = ["DGD401", "DGD200"]; /* Caribbean, Deep Orange */
    const read = (px, py) => page.evaluate(([px, py]) => { const cv = document.querySelector("#disc"); return __t.at({ S: cv.width, W: cv.clientWidth, d: cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data }, px, py); }, [px, py]);
    const off = (x, y) => Math.max(...[0, 1, 2].map(i => Math.abs(x[i] - y[i])));
    for (const blend of ["multiply", "darken"]) {
      for (const depth of [0.3, 0.8, 1]) {
        await setPlanner(page, { base: YELLOW, baseName: "Yellow", tech: "hotdip", pattern: "full", sel: [a], depth, blend });
        const want = await page.evaluate(id => state.byId[id].res.map(Math.round), a);
        const got = await read(0.35, 0.45);
        assert.ok(off(got, want) <= 2, `Full dip ${blend} ${depth}: drawn ${got} vs card ${want}`);
      }
      await setPlanner(page, { sel: [], blend });
      assert.ok(off(await read(0.35, 0.45), [242, 220, 60]) <= 2, "with no dye the disc color shows");
      await setPlanner(page, { pattern: "doubledip", sel: [a, b], depth: 0.8, blend });
      const touch = await page.evaluate(([a, b]) => touchRgb(state.byId[a], state.byId[b], state.blend).map(Math.round), [a, b]);
      const shown = await page.evaluate(() => document.querySelector("#touchNow .tchip i").style.background);
      assert.ok(shown, "Where they touch is not shown");
      assert.ok(off(await read(0.62, 0.05), touch) <= 2, `Double dip ${blend}: the overlap is not the Where they touch color`);
    }
  } finally { await context.close(); }
});

test("E8: the same setup always gives the same picture: twice, after a resize, after switching tabs, after adding and removing a dye", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page);
    /* Each step is compared with the first picture; a difference names the step, how many pixels differ,
       by how much, and whether the engine drew it, so a failure says where and what. */
    await page.evaluate(() => { window.__p0 = __t.copy(document.querySelector("#disc")); });
    const same = async step => {
      const r = await page.evaluate(() => {
        const d = __t.copy(document.querySelector("#disc")), a = window.__p0;
        let n = 0, max = 0;
        if (d.length !== a.length) return { size: true };
        for (let i = 0; i < d.length; i++) if (d[i] !== a[i]) { n++; max = Math.max(max, Math.abs(d[i] - a[i])); }
        return { n, max, engine: DiscPreview.state(state.pattern) };
      });
      assert.ok(!r.size && r.n === 0, `${step} changed the picture: ${r.size ? "a different size" : `${r.n} values differ by up to ${r.max} (engine ${r.engine})`}`);
    };
    await page.evaluate(() => drawDisc());
    await same("drawing twice");
    await page.setViewportSize({ width: 800, height: 900 }); await page.waitForTimeout(200);
    await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(200);
    await same("a resize");
    await tapEl(page, "computer", "#tabbtn-notes"); await tapEl(page, "computer", "#tabbtn-planner");
    await same("switching tabs");
    const id = await page.evaluate(() => [...document.querySelectorAll(".dye")].find(b => b.getAttribute("aria-pressed") === "false").dataset.dye);
    await tapEl(page, "computer", `.dye[data-dye="${id}"]`); await page.waitForFunction(id => state.sel.includes(id), id);
    await tapEl(page, "computer", `.dye[data-dye="${id}"]`); await page.waitForFunction(id => !state.sel.includes(id), id);
    await same("adding and removing a dye");
  } finally { await context.close(); }
});

test("E9: the preview is drawn at the screen's real density, also after the window changes size", async () => {
  const { context, page } = await openApp("computer", { context: { deviceScaleFactor: 2 } });
  try {
    const size = () => page.$eval("#disc", cv => ({ w: cv.width, h: cv.height, want: Math.round(cv.clientWidth * devicePixelRatio) }));
    let s = await size();
    assert.strictEqual(s.w, s.want); assert.strictEqual(s.h, s.want);
    await page.setViewportSize({ width: 380, height: 800 }); await page.waitForTimeout(200);
    s = await size();
    assert.strictEqual(s.w, s.want, "after a resize the picture was not redrawn at the screen's density");
  } finally { await context.close(); }
});

test("E11: without the graphics chip every pattern and photo still draws, with no error and no message", async () => {
  const { context, page, errors } = await openApp("computer", { init: noGraphics });
  try {
    await helpers(page);
    await page.waitForFunction(() => DiscPreview.state("cells") !== "waiting");
    assert.strictEqual(await page.evaluate(() => DiscPreview.state("cells")), "none", "the check did not turn the graphics chip off");
    await page.evaluate(ks => ks.forEach(k => DiscPreview.photoState(k)), PHOTOS);
    await photoReady(page, PHOTOS);
    const rows = await page.evaluate(({ keys, DYES8, YELLOW }) => keys.map(p => { const img = __t.disc(280, YELLOW, DYES8.slice(0, 3), p); return { p, alpha: __t.at(img, 0, 0)[3], pattern: __t.differ(img, __t.disc(280, YELLOW, [], p)) }; }), { keys: [...BUILTIN, ...PHOTOS], DYES8, YELLOW });
    for (const r of rows) {
      assert.strictEqual(r.alpha, 255, `${r.p} is blank`);
      assert.ok(r.pattern > 0.1, `${r.p}: the dyes are not drawn (${(r.pattern * 100).toFixed(1)}% changed)`);
    }
    /* A photo pattern without the chip is the photo recolored: dye 1 fills its largest area. */
    const share = await page.evaluate(({ STRONG, WHITE }) => {
      const img = __t.disc(280, WHITE, STRONG.slice(0, 2), "photo-cells"), pred = STRONG.slice(0, 2).map(h => blendRgb(__t.rgb(WHITE), __t.rgb(h), "multiply")), idx = __t.inside(img, 0.7);
      return idx.filter(i => __t.near([img.d[i], img.d[i + 1], img.d[i + 2]], pred) === 0).length / idx.length;
    }, { STRONG, WHITE });
    assert.ok(share >= 0.3, `dye 1 covers only ${(share * 100).toFixed(1)}% of the flat photo`);
    assert.doesNotMatch(await page.locator("#tab-planner").textContent(), /graphics|WebGL|shader|canvas|GPU|chip/i, "the fallback showed a message");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

test("E13: with 40 techniques every picture draws on every visit, one surface serves them all, and a lost surface falls back and comes back", async () => {
  const { context, page, errors } = await openApp("computer", { init: countSurfaces });
  try {
    await helpers(page);
    await engine(page);
    await seedTechniques(page, 40);
    await page.waitForFunction(() => myTechDocs.length === 40);
    const allDrawn = () => page.evaluate(() => {
      const pics = [...(document.querySelector("#tab-notes").hidden ? [document.querySelector("#disc")] : document.querySelectorAll("canvas.thumb"))];
      return { n: pics.length, bad: pics.filter(cv => !__t.drawn(cv)).length };
    });
    for (let round = 0; round < 3; round++) {
      await tapEl(page, "computer", "#tabbtn-planner");
      assert.deepStrictEqual(await allDrawn(), { n: 1, bad: 0 }, `round ${round}: the Planner preview is blank`);
      await tapEl(page, "computer", "#tabbtn-notes");
      const t = await allDrawn();
      assert.ok(t.n >= 45, `expected 5 + 40 pictures, found ${t.n}`);
      assert.strictEqual(t.bad, 0, `round ${round}: ${t.bad} pictures are blank`);
      await tapEl(page, "computer", "#tabbtn-log");
    }
    assert.ok(await page.evaluate(() => window.__surfaces) <= 1, "more than one graphics surface was made");

    await page.evaluate(() => { window.__lose = window.__gl[0].getExtension("WEBGL_lose_context"); window.__lose.loseContext(); });
    await page.waitForFunction(() => !DiscPreview.ready());
    await tapEl(page, "computer", "#tabbtn-notes");
    assert.strictEqual((await allDrawn()).bad, 0, "pictures went blank while the surface was lost");
    await page.evaluate(() => window.__lose.restoreContext());
    await page.waitForFunction(() => DiscPreview.ready("swirl"), null, { timeout: 60000 });
    assert.ok(await page.evaluate(({ YELLOW }) => !!__t.raw(140, 140, YELLOW, ["#fc3110"], "swirl"), { YELLOW }), "the engine did not come back");
    assert.strictEqual((await allDrawn()).bad, 0);
    assert.ok(await page.evaluate(() => window.__surfaces) <= 1, "coming back made a second surface");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

/* ---------- B. photo patterns ---------- */
const openMore = async (page, device) => {
  if (!(await page.evaluate(() => document.querySelector("#morePats").open))) await tapEl(page, device, "#morePats > summary");
  await page.waitForFunction(() => document.querySelector("#morePats").open);
};

test("E14: each photo pattern draws with the app offline", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await helpers(page);
    await context.setOffline(true);
    await openMore(page, "computer");
    for (const key of PHOTOS) {
      await tapEl(page, "computer", `#patMore [data-pat="${key}"]`);
      await page.waitForFunction(k => DiscPreview.photoState(k) !== "loading", key);
      assert.strictEqual(await page.evaluate(k => DiscPreview.photoState(k), key), "ready", `${key} did not load offline`);
      assert.ok(await page.evaluate(() => __t.drawn(document.querySelector("#disc"))), `${key} drew a blank disc`);
    }
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

test("E15: photo credits show in More patterns and in the line under the disc, never on the disc", async () => {
  const { context, page } = await openApp("computer");
  try {
    await openMore(page, "computer");
    const credits = await page.locator("#patCredits").textContent();
    assert.match(credits, /Cells photo \(Photo: Dyes by Redd\)/);
    assert.match(credits, /Flames photo \(Photo found online\)/);
    assert.match(credits, /Spoked starburst photo \(Photo found online\)/);
    await tapEl(page, "computer", '#patMore [data-pat="photo-cells"]');
    await page.waitForFunction(() => /^Cells photo: .*Photo: Dyes by Redd\.$/.test(document.querySelector("#roles").textContent));
    await tapEl(page, "computer", '#patMore [data-pat="photo-flames"]');
    await page.waitForFunction(() => /^Flames photo: .*Photo found online\.$/.test(document.querySelector("#roles").textContent));
    const onTop = await page.evaluate(() => { const b = document.querySelector("#disc").getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).id; });
    assert.strictEqual(onTop, "disc", "something is drawn over the disc");
  } finally { await context.close(); }
});

/* Pixel shares by nearest predicted dye color on a white disc, for a photo key and n dyes (engine output, no finish). */
const photoShares = (page, key, cols) => page.evaluate(({ key, cols, WHITE }) => {
  const img = __t.raw(256, 256, WHITE, cols, key), pred = cols.map(h => blendRgb(__t.rgb(WHITE), __t.rgb(h), "multiply")), idx = __t.inside(img, 1), cnt = cols.map(() => 0);
  /* The whole drawn disc, the same area the groups are counted over; edge pixels count by how much of them is disc. */
  let total = 0;
  idx.forEach(i => { const a = img.d[i + 3] / 255; cnt[__t.near([img.d[i], img.d[i + 1], img.d[i + 2]], pred)] += a; total += a; });
  return cnt.map(c => c / total);
}, { key, cols, WHITE });

test("E16: dye 1 fills the largest area of each photo, dye 2 the next, and so on (2, 3 and 5 dyes)", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page, PHOTOS);
    await page.evaluate(ks => ks.forEach(k => DiscPreview.photoState(k)), PHOTOS);
    await photoReady(page, PHOTOS);
    for (const key of PHOTOS) for (const n of [2, 3, 5]) {
      const s = await photoShares(page, key, STRONG.slice(0, n));
      for (let k = 1; k < n; k++) assert.ok(s[k] <= s[k - 1] + 0.02, `${key} with ${n} dyes: dye ${k + 1} covers ${(s[k] * 100).toFixed(1)}%, more than dye ${k} (${(s[k - 1] * 100).toFixed(1)}%); all: ${s.map(v => (v * 100).toFixed(1)).join(", ")}; group sizes: ${await page.evaluate(([k, n]) => { const g = DiscPreview.photoGroupsOf(k, n), t = g.counts.reduce((a, b) => a + b, 0); return g.counts.map(c => (c / t * 100).toFixed(1)).join(", "); }, [key, n])}`);
    }
  } finally { await context.close(); }
});

test("E17-E19: swapping dyes 1 and 2 swaps their areas; light and dark detail is kept; one dye colors the whole photo; no dye is the plain disc", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page, PHOTOS);
    await page.evaluate(ks => ks.forEach(k => DiscPreview.photoState(k)), PHOTOS);
    await photoReady(page, PHOTOS);
    for (const key of PHOTOS) {
      const r = await page.evaluate(({ key, STRONG, WHITE }) => {
        const pred = cols => cols.map(h => blendRgb(__t.rgb(WHITE), __t.rgb(h), "multiply"));
        /* A grid point deep inside the largest group (its 7 x 7 neighborhood all in group 1). */
        const g = DiscPreview.photoGroupsOf(key, 2), G = 128;
        let best = null;
        for (let y = 3; y < G - 3; y++) for (let x = 3; x < G - 3; x++) {
          let ok = true;
          for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (g.labels[(y + dy) * G + x + dx] !== 0) { ok = false; break; }
          if (ok) { const d = Math.hypot(x - G / 2, y - G / 2); if (!best || d < best.d) best = { x, y, d }; }
        }
        const p = [(best.x + 0.5) / G * 2 - 1, (best.y + 0.5) / G * 2 - 1];
        const a = __t.raw(256, 256, WHITE, STRONG.slice(0, 2), key), b = __t.raw(256, 256, WHITE, [STRONG[1], STRONG[0]], key);
        const before = __t.near(__t.at(a, p[0], p[1]), pred(STRONG.slice(0, 2))), after = __t.near(__t.at(b, p[0], p[1]), pred(STRONG.slice(0, 2)));
        /* E18: within group 1 the pixels vary; the darkest tenth of the picture is darker than the lightest tenth. */
        const three = __t.raw(256, 256, WHITE, STRONG.slice(0, 3), key), g3 = DiscPreview.photoGroupsOf(key, 3), { c, r } = __t.geom(256, 256);
        const lum = i => 0.299 * three.d[i] + 0.587 * three.d[i + 1] + 0.114 * three.d[i + 2], inGroup = [], all = [];
        __t.inside(three, 0.9).forEach(i => {
          const x = (i / 4) % 256, y = Math.floor(i / 4 / 256), u = (x + 0.5 - c) / r, v = (y + 0.5 - c) / r;
          const gx = Math.floor((u * 0.5 + 0.5) * G), gy = Math.floor((v * 0.5 + 0.5) * G), L = lum(i);
          all.push(L); if (g3.labels[gy * G + gx] === 0) inGroup.push(L);
        });
        const sd = xs => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length); };
        all.sort((x, y) => x - y);
        /* E19: one dye covers the whole photo, with its detail; no dye is the plain disc. */
        const one = __t.raw(256, 256, WHITE, [STRONG[1]], key), onePred = pred([STRONG[1]])[0], base = __t.rgb(WHITE), oneIdx = __t.inside(one, 0.9);
        const oneShare = oneIdx.filter(i => __t.near([one.d[i], one.d[i + 1], one.d[i + 2]], [onePred, base]) === 0).length / oneIdx.length;
        const oneLum = oneIdx.map(i => 0.299 * one.d[i] + 0.587 * one.d[i + 1] + 0.114 * one.d[i + 2]);
        const none = __t.differ(__t.disc(140, WHITE, [], key), __t.disc(140, WHITE, [], "full"), 0) === 0 ? "plain" : "patterned", plain = "plain";
        return { before, after, groupSd: sd(inGroup), dark: all[Math.floor(all.length * 0.1)], light: all[Math.floor(all.length * 0.9)], oneShare, oneSd: sd(oneLum), none, plain };
      }, { key, STRONG, WHITE });
      assert.strictEqual(r.before, 0, `${key}: the largest area is not dye 1`);
      assert.strictEqual(r.after, 1, `${key}: after swapping, the largest area did not take the other dye`);
      assert.ok(r.groupSd > 2, `${key}: one color group is flat, the photo's detail is gone`);
      assert.ok(r.dark < r.light - 10, `${key}: dark lines are not darker than light areas`);
      assert.ok(r.oneShare >= 0.95, `${key}: one dye covers only ${(r.oneShare * 100).toFixed(1)}% of the photo`);
      assert.ok(r.oneSd > 2, `${key}: one dye lost the photo's detail`);
      assert.strictEqual(r.none, r.plain, `${key}: with no dye the disc is not plain`);
    }
  } finally { await context.close(); }
});

test("E20: choosing a photo pattern and changing the number of dyes redraws within 1 second, and the same setup gives the same picture", async () => {
  const { context, page } = await openApp("computer");
  try {
    await helpers(page);
    await engine(page, ["cells", "photo-spoked"]);
    await openMore(page, "computer");
    const t0 = Date.now();
    await tapEl(page, "computer", '#patMore [data-pat="photo-spoked"]');
    await page.waitForFunction(() => DiscPreview.photoState("photo-spoked") === "ready" && state.pattern === "photo-spoked");
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
    assert.ok(Date.now() - t0 <= 1000, `choosing the photo took ${Date.now() - t0} ms`);
    const h0 = await page.evaluate(() => __t.hash(document.querySelector("#disc")));
    const id = await page.evaluate(() => [...document.querySelectorAll(".dye")].find(b => b.getAttribute("aria-pressed") === "false").dataset.dye);
    const ms = await page.evaluate(id => { const t = performance.now(); toggleDye(id); return performance.now() - t; }, id);
    assert.ok(ms <= 1000, `adding a dye took ${ms.toFixed(0)} ms`);
    await page.evaluate(id => toggleDye(id), id);
    assert.strictEqual(await page.evaluate(() => __t.hash(document.querySelector("#disc"))), h0, "the same setup drew a different picture");
  } finally { await context.close(); }
});

/* ---------- D. up to 8 dyes ---------- */
test("E34: every route puts up to 8 dyes on the disc and a 9th drops the oldest", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await clearPicked(page, "computer");
    const ids = await page.$$eval(".dye", els => els.slice(0, 9).map(e => e.dataset.dye));
    for (const id of ids) { await tapEl(page, "computer", `.dye[data-dye="${id}"]`); await page.waitForFunction(id => state.sel.includes(id), id); }
    assert.deepStrictEqual(await stateSel(page), ids.slice(1), "tapping 9 cards should keep the last 8 in order");
    const nextAdds = async (label, act) => {
      const before = await stateSel(page);
      const added = await act();
      await page.waitForFunction(b => state.sel.join() !== b.join(), before);
      const now = await stateSel(page);
      assert.strictEqual(now.length, 8, `${label}: ${now.length} dyes on the disc`);
      assert.strictEqual(now[7], added || now[7], `${label}: the new dye is not last`);
      assert.deepStrictEqual(now.slice(0, 7), before.slice(1), `${label}: the oldest dye was not the one dropped`);
    };
    await openShelf(page, "computer");
    await nextAdds("mix", async () => { await tapEl(page, "computer", "#mixAdd"); return null; });
    await nextAdds("custom dye", async () => { await page.fill("#cdName", "Test eight"); await tapEl(page, "computer", "#cdAdd"); return null; });
    await showWheel(page, "computer");
    await tapEl(page, "computer", '#wheelShow [data-show="all"]');
    await boxOf(page, "#wheelSvg");
    const dot = await page.evaluate(() => {
      const all = [...document.querySelectorAll("#wheelSvg circle.dot")].map(c => { const b = c.getBoundingClientRect(); return { id: c.dataset.id, layer: c.dataset.layer, x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      return all.find(d => d.layer === "disc" && !state.sel.includes(d.id) && all.every(o => o.id === d.id || Math.hypot(o.x - d.x, o.y - d.y) > 14)) || null;
    });
    assert.ok(dot, "no wheel dot clear of its neighbors to tap");
    await nextAdds("wheel dot", async () => { await page.mouse.click(dot.x, dot.y); return dot.id; });
    await tapEl(page, "computer", "#dialFold > summary");
    await page.waitForFunction(() => document.querySelector("#dialFold").open);
    const chip = await page.evaluate(() => [...document.querySelectorAll('#dialList [data-add][aria-pressed="false"]')].map(b => b.dataset.add)[0]);
    assert.ok(chip, "no dial chip to tap");
    await nextAdds("dial chip", async () => { await tapEl(page, "computer", `#dialList [data-add="${chip}"]`); return chip; });
    await tapEl(page, "computer", '#viewSeg [data-view="disc"]');
    await tapEl(page, "computer", '.sw[data-hex="#f5f5f1"]');
    await page.selectOption("#perCombo", "8");
    await page.waitForFunction(() => state.perCombo === 8 && document.querySelector("[data-combo]"));
    await tapEl(page, "computer", "[data-combo]");
    await page.waitForFunction(() => state.sel.length === 8);
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

test("E35-E36: saved setups with 3, 8 and 10 dyes come back with 3, 8 and the first 8; the hint says 8", async () => {
  const { context, page } = await openApp("computer");
  try {
    const ids = await prochemIds(page, 10);
    for (const [n, want] of [[3, 3], [8, 8], [10, 8]]) {
      await page.evaluate(sel => localStorage.setItem("discdye.setup", JSON.stringify({ base: "#f2dc3c", baseName: "Yellow", brand: "Innova", plastic: "Star / Shimmer", translucent: false, tech: "floetrol", pattern: "cells", blend: "multiply", depth: 0.8, pool: "all", sel })), ids.slice(0, n));
      await reopen(page);
      assert.deepStrictEqual(await stateSel(page), ids.slice(0, want), `a setup with ${n} dyes`);
    }
    assert.strictEqual(await page.locator("#selHint").textContent(), "Tap dye cards to add up to 8 colors, in order. Drag a color to reorder it, or use ← and ×.");
  } finally { await context.close(); }
});

test("E37: the line under the disc names every color for 1, 2, 5 and 8 colors and never stops at 3", async () => {
  const { context, page } = await openApp("computer");
  try {
    const rows = await page.evaluate(keys => keys.flatMap(p => [1, 2, 5, 8].map(n => ({ p, n, text: rolesText(p, n) }))), [...BUILTIN, ...PHOTOS]);
    for (const { p, n, text } of rows) {
      assert.ok(text, `${p}: no text`);
      assert.doesNotMatch(text, /left out|only color|uses color 1 only/i, `${p} ${n}: ${text}`);
      for (const list of text.match(/\d+(, \d+)+/g) || []) assert.strictEqual(+list.split(", ").pop(), n, `${p} ${n}: "${list}" does not run to ${n}`);
      assert.ok(text.includes(String(n)) || /and so on/.test(text), `${p} with ${n} colors does not cover color ${n}: ${text}`);
    }
    const ids = await prochemIds(page, 8);
    await setPlanner(page, { pattern: "spin", sel: ids });
    assert.match(await page.locator("#roles").textContent(), /^Spin rings: .*1, 2, 3, 4, 5, 6, 7, 8 outward\.$/);
  } finally { await context.close(); }
});

/* ---------- E. Dyes per combo ---------- */
test("E44-E45: Dyes per combo is finger-sized at 360 px, offers As now and 4-8, is saved, and a damaged or missing value opens on As now", async () => {
  const { context, page } = await openApp("phone360");
  try {
    const box = await boxOf(page, "#perCombo");
    assert.ok(box.height >= 40, `the control is ${box.height}px tall`);
    assert.deepStrictEqual(await page.$$eval("#perCombo option", os => os.map(o => o.textContent)), ["As now", "4", "5", "6", "7", "8"]);
    assert.strictEqual(await page.inputValue("#perCombo"), "0", "a first visit should be on As now");
    await page.selectOption("#perCombo", "6");
    await page.waitForFunction(() => state.perCombo === 6);
    await reopen(page);
    assert.strictEqual(await page.inputValue("#perCombo"), "6", "the choice was not kept");
    for (const bad of ["x", 9, 3, 6.5, null]) {
      await page.evaluate(v => { const s = JSON.parse(localStorage.getItem("discdye.setup")); s.perCombo = v; localStorage.setItem("discdye.setup", JSON.stringify(s)); }, bad);
      await reopen(page);
      assert.strictEqual(await page.inputValue("#perCombo"), "0", `a saved value of ${JSON.stringify(bad)} should open on As now`);
    }
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("discdye.setup")); delete s.perCombo; localStorage.setItem("discdye.setup", JSON.stringify(s)); });
    await reopen(page);
    assert.strictEqual(await page.evaluate(() => state.perCombo), 0, "a 0.4.x setup should open on As now");
  } finally { await context.close(); }
});

test("E46-E47: with 5 dyes per combo every option has 5 dyes, Based on says so, Next cycles, and Show on disc puts all 5 on the disc", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await tapEl(page, "computer", '.sw[data-hex="#f5f5f1"]');
    await page.selectOption("#perCombo", "5");
    await page.waitForFunction(() => state.perCombo === 5 && state.combos.length);
    assert.ok(await page.evaluate(() => state.combos.every(t => t.options.every(o => o.length === 5))), "an option does not have 5 dyes");
    assert.match(await page.locator("#basedOn").textContent(), /, 5 dyes per combo\.$/);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll("#combos .strip")].every(s => s.children.length === 5)), "a combo card does not show 5 dyes");
    const next = page.locator("[data-next]").first();
    if (await next.count()) {
      const key = await next.getAttribute("data-next");
      await tapEl(page, "computer", `[data-next="${key}"]`);
      await page.waitForFunction(k => /^Next \(2 of/.test(document.querySelector(`[data-next="${k}"]`).textContent), key);
    }
    await tapEl(page, "computer", "[data-combo]");
    await page.waitForFunction(() => state.sel.length === 5);
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

test("E48: with too few clean dyes for the number chosen, the combo area says so in plain words and the control still works", async () => {
  const { context, page } = await openApp("computer");
  try {
    await openShelf(page, "computer");
    const jars = await page.$$eval("#shelf .jar", els => els.slice(0, 3).map(e => e.dataset.jar));
    for (const id of jars) await tapEl(page, "computer", `#shelf .jar[data-jar="${id}"]`);
    await page.waitForFunction(() => state.owned.size === 3);
    await tapEl(page, "computer", '#poolSeg [data-pool="owned"]');
    await page.selectOption("#perCombo", "6");
    await page.waitForFunction(() => state.perCombo === 6);
    assert.match(await page.locator("#combos").textContent(), /^Only \d of these dyes stays? clean on this disc, so there are no combos of 6\. Choose As now in Dyes per combo, or add dyes to your shelf\.$/);
    assert.strictEqual(await page.locator("#perCombo").isEnabled(), true);
    await page.selectOption("#perCombo", "0");
    await page.waitForFunction(() => state.perCombo === 0);
    assert.doesNotMatch(await page.locator("#combos").textContent(), /no combos of 6/);
  } finally { await context.close(); }
});

/* ---------- F. Where they touch ---------- */
test("E53: the combo ranking and the Where they touch list ask the same function, with the photo pattern and 8 dyes", async () => {
  const { context, page } = await openApp("computer");
  try {
    const ids = await prochemIds(page, 49);
    await setPlanner(page, { base: WHITE, baseName: "White", pattern: "photo-cells", perCombo: 8, sel: ids.slice(0, 8) });
    const calls = await page.evaluate(() => {
      const f = window.comboTouchPairs, log = [];
      window.comboTouchPairs = (p, n, pt) => { log.push([p, n, typeof pt]); return f(p, n, pt); };
      try {
        const ranking = (log.length = 0, buildCombos(poolResults(), currentSetup()), log.slice());
        const shown = (log.length = 0, renderOnDisc(), log.slice());
        return { ranking, shown };
      } finally { window.comboTouchPairs = f; }
    });
    assert.ok(calls.ranking.some(([p, n, t]) => p === "photo-cells" && n === 8 && t === "function"), "the ranking did not ask about the photo pattern with 8 dyes");
    assert.ok(calls.shown.some(([p, n, t]) => p === "photo-cells" && n === 8 && t === "function"), "Where they touch did not ask about the photo pattern with 8 dyes");
  } finally { await context.close(); }
});

test("E54: with 8 dyes the Where they touch list wraps on a 360 px phone with no sideways scrolling, muddy pairs first", async () => {
  const { context, page } = await openApp("phone360");
  try {
    const ids = await prochemIds(page, 8);
    await setPlanner(page, { pattern: "spin", sel: ids });
    const r = await page.evaluate(() => {
      const chips = [...document.querySelectorAll("#touchNow .tchip")], tops = new Set(chips.map(c => Math.round(c.getBoundingClientRect().top)));
      const muddy = chips.map(c => c.querySelector("em").classList.contains("bad"));
      return { n: chips.length, rows: tops.size, page: document.documentElement.scrollWidth <= innerWidth, box: document.querySelector("#touchNow").scrollWidth <= document.querySelector("#touchNow").clientWidth, firstClean: muddy.indexOf(false), lastMuddy: muddy.lastIndexOf(true) };
    });
    assert.strictEqual(r.n, 8, "8 dyes in rings touch in 8 places");
    assert.ok(r.rows >= 2, "the list does not wrap");
    assert.ok(r.page && r.box, "the page scrolls sideways");
    if (r.firstClean >= 0 && r.lastMuddy >= 0) assert.ok(r.lastMuddy < r.firstClean, "a muddy pair is listed after a clean one");
  } finally { await context.close(); }
});

/* ---------- G. every pattern on every bed ---------- */
test("E55-E57: each bed shows its usual patterns first and every other pattern under More patterns; the fold is closed on load and opens itself for an extra", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    assert.deepStrictEqual(await page.evaluate(() => [state.tech, state.pattern]), ["floetrol", "cells"], "first open should be Floetrol bed with Cells");
    const read = () => page.evaluate(() => ({
      usual: [...document.querySelectorAll("#patSeg [data-pat]")].map(b => b.dataset.pat),
      extra: [...document.querySelectorAll("#patMore [data-pat]")].map(b => b.dataset.pat),
      open: document.querySelector("#morePats").open, pattern: state.pattern
    }));
    const all = [...BUILTIN, ...PHOTOS];
    for (const bed of Object.keys(USUAL)) {
      await tapEl(page, "computer", `#techSeg [data-tech="${bed}"]`);
      await page.waitForFunction(b => state.tech === b, bed);
      const s = await read();
      assert.deepStrictEqual(s.usual, USUAL[bed], `${bed}: usual patterns`);
      assert.deepStrictEqual(s.extra, all.filter(p => !USUAL[bed].includes(p)), `${bed}: More patterns`);
      assert.strictEqual(s.pattern, USUAL[bed][0], `${bed}: choosing a bed picks its first usual pattern`);
      assert.strictEqual(s.open, false, `${bed}: More patterns should be closed`);
    }
    await tapEl(page, "computer", '#techSeg [data-tech="floetrol"]');
    await openMore(page, "computer");
    await tapEl(page, "computer", '#patMore [data-pat="stencil"]');
    await page.waitForFunction(() => state.pattern === "stencil");
    assert.strictEqual(await page.getAttribute('#patMore [data-pat="stencil"]', "aria-pressed"), "true");
    await reopen(page);
    let s = await read();
    assert.strictEqual(s.pattern, "stencil", "a saved extra pattern was reset on reopening");
    assert.strictEqual(s.open, true, "More patterns should open itself when the pattern in use is an extra");
    await tapEl(page, "computer", '#patSeg [data-pat="swirl"]');
    await reopen(page);
    assert.strictEqual((await read()).open, false, "More patterns should be closed on load when the pattern is a usual one");

    await seedTechniques(page, 1, { name: "Zed starburst", pattern: "starburst", base: "floetrol" });
    await page.waitForFunction(() => myTechDocs.length === 1);
    const techId = await page.evaluate(() => myTechDocs[0].id);
    await page.selectOption("#myTechPick", "my:" + techId);
    await page.waitForFunction(id => state.tech === "my:" + id, techId);
    s = await read();
    assert.deepStrictEqual(s.usual, ["starburst", "cells", "swirl", "river"], "own technique: its preview pattern first, then its base's");
    assert.deepStrictEqual(s.extra, all.filter(p => !s.usual.includes(p)), "own technique: More patterns");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});

test("E56: More patterns and its buttons are finger-sized on a 360 px phone", async () => {
  const { context, page } = await openApp("phone360");
  try {
    assert.ok((await boxOf(page, "#morePats > summary")).height >= 40, "the More patterns bar is too small to tap");
    await openMore(page, "phone360");
    const hs = await page.$$eval("#patMore button", bs => bs.map(b => b.getBoundingClientRect().height));
    assert.ok(hs.length && hs.every(h => h >= 40), `pattern buttons under More patterns: ${hs.join(", ")}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "the page scrolls sideways");
  } finally { await context.close(); }
});

/* Off-center rings reach the far rim on the graphics chip as they do in the flat drawing (review round 1:
   the ring list was capped at 16 rings, leaving a bare crescent past about 1.2 from the ring center). */
test("E2c: off-center spin covers the far rim on the graphics chip about as much as the flat drawing does", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await helpers(page); await engine(page, ["offcenter"]);
    const r = await page.evaluate(({ YELLOW, DYES8 }) => {
      const T = window.__t, cols = DYES8.slice(0, 3);
      const bare = T.disc(280, YELLOW, [], "offcenter"), chip = T.disc(280, YELLOW, cols, "offcenter");
      const flat = T.flat(() => T.disc(280, YELLOW, cols, "offcenter"));
      /* The far rim from the ring center (0.3,-0.2 in disc units, y down): disc points over 1.2 from it. */
      const { c, r: R } = T.geom(bare.S, bare.W);
      const zone = []; for (let y = 0; y < bare.S; y++) for (let x = 0; x < bare.S; x++) {
        const u = (x + .5 - c) / R, v = (y + .5 - c) / R;
        if (u * u + v * v <= .9 && Math.hypot(u - .3, v + .2) > 1.2) zone.push((y * bare.S + x) * 4);
      }
      const bareShare = img => zone.filter(i => Math.abs(img.d[i] - bare.d[i]) <= 6 && Math.abs(img.d[i + 1] - bare.d[i + 1]) <= 6 && Math.abs(img.d[i + 2] - bare.d[i + 2]) <= 6).length / zone.length;
      return { n: zone.length, chip: bareShare(chip), flat: bareShare(flat) };
    }, { YELLOW, DYES8 });
    assert.ok(r.n > 100, "the far-rim zone is empty: the check measures nothing");
    assert.ok(r.chip <= r.flat + 0.15, `far rim left bare on the graphics chip: ${(r.chip * 100).toFixed(0)}% bare vs ${(r.flat * 100).toFixed(0)}% in the flat drawing`);
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});
/* Photo patterns: "Where they touch" keeps the muddy pairs in view and folds the clean ones under one
   line, which stays open across redraws once opened (Sean, 2026-10-05). Drawn patterns list every pair. */
test("E54b: on a photo pattern the clean touching pairs fold under one line; muddy pairs stay in view; the fold stays open across taps", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await photoReady(page, ["photo-cells"]);
    const ids = await prochemIds(page, 49);
    const r = await page.evaluate(async ids => {
      const pick = ids.filter(id => state.byId[id] && state.byId[id].cat !== "mud").slice(0, 8);
      Object.assign(state, { sel: pick, pattern: "photo-cells", base: "#f5f5f1" }); renderTech(); renderRoles(); render();
      const box = document.querySelector("#touchNow"), fold = box.querySelector("details.tclean");
      const outside = [...box.querySelectorAll(":scope > .trow .tchip")].map(c => c.querySelector("em").className);
      const inside = fold ? [...fold.querySelectorAll(".tchip em")].map(e => e.className) : [];
      const summary = fold ? fold.querySelector("summary").textContent : "";
      const closedAtFirst = fold ? !fold.open : null;
      if (fold) { fold.open = true; await new Promise(res => setTimeout(res, 50)); }
      const last = pick[pick.length - 1]; toggleDye(last); toggleDye(last);
      const after = document.querySelector("#touchNow details.tclean");
      Object.assign(state, { pattern: "spin" }); renderTech(); renderRoles(); render();
      const drawnFold = !!document.querySelector("#touchNow details.tclean");
      return { outside, inside, summary, closedAtFirst, stillOpen: after ? after.open : null, drawnFold };
    }, ids);
    assert.ok(r.inside.length > 0, "with 8 dyes on the Cells photo some clean pairs should fold away");
    assert.ok(r.outside.every(c => c === "bad"), "only muddy pairs may stay in view outside the fold");
    assert.ok(r.inside.every(c => c === "ok"), "only clean pairs belong in the fold");
    assert.match(r.summary, new RegExp(`^${r.inside.length} clean pairs?$`), "the fold line must count the clean pairs");
    assert.strictEqual(r.closedAtFirst, true, "the fold starts closed");
    assert.strictEqual(r.stillOpen, true, "an opened fold must stay open when the disc is redrawn");
    assert.strictEqual(r.drawnFold, false, "drawn patterns list every pair without a fold");
    assert.deepStrictEqual(errors, []);
  } finally { await context.close(); }
});