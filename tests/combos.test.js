"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const combos = require("../combos.js");
const ref = require("./reference-0.1.1.js");
const { loadAppData, INDEX_PATH } = require("./load-app-data.js");

const { PROCHEM, DISCS } = loadAppData();
const DYES = combos.dyesFromText(PROCHEM);
const SW_PATH = require("path").join(__dirname, "..", "sw.js");

/* ---------- shared fixtures ---------- */
const DEPTHS = [0.3, 0.55, 0.8, 1];
const FACTORS = [1, 0.85, 0.65, 0.35];
const TRANSLUCENTS = [1, 0.7];
function strengths() {
  const out = [];
  for (const depth of DEPTHS) for (const f of FACTORS) for (const t of TRANSLUCENTS) out.push(depth * f * t);
  return out;
}
const STRENGTHS = strengths(); // 32 values

function seeded(s) {
  let x = s;
  return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
}

function setupFor(discHex, discName, blend, strength, techBase, pattern) {
  return { base: combos.hex2rgb(discHex), baseText: discName.toLowerCase(), blend, strength, techBase, pattern };
}

const OWN_KEY = { floetrol: "cells", spin: "rainbow", hotdip: "solidrim" };
const ownKeyFor = tb => OWN_KEY[tb] || "lightdark";

/* ---------- T19/T20: predictHexes vs 0.1.1 reference ---------- */
test("T19: predictHexes matches the 0.1.1 reference (1 dye, all dyes x all discs x both blends x all strengths)", () => {
  let n = 0;
  for (const [, discHex] of DISCS) {
    for (const mode of ["multiply", "darken"]) {
      for (const s of STRENGTHS) {
        for (const dye of DYES) {
          const got = combos.predictHexes(discHex, s, [dye.hex], mode);
          const want = ref.predictHexes(discHex, s, [dye.hex], mode);
          assert.deepStrictEqual(got, want, `disc ${discHex} mode ${mode} s ${s} dye ${dye.id}`);
          n++;
        }
      }
    }
  }
  assert.ok(n > 0);
});

test("T20: predictHexes matches the 0.1.1 reference (3 dyes, cycling through all 49 dyes x all discs x both blends x all strengths)", () => {
  let n = 0;
  for (const [, discHex] of DISCS) {
    for (const mode of ["multiply", "darken"]) {
      for (const s of STRENGTHS) {
        for (let i = 0; i < DYES.length; i++) {
          const hexes = [DYES[i].hex, DYES[(i + 1) % DYES.length].hex, DYES[(i + 2) % DYES.length].hex];
          const got = combos.predictHexes(discHex, s, hexes, mode);
          const want = ref.predictHexes(discHex, s, hexes, mode);
          assert.deepStrictEqual(got, want, `disc ${discHex} mode ${mode} s ${s} i ${i}`);
          n++;
        }
      }
    }
  }
  assert.ok(n > 0);
});

test("T19b: predictHexes matches the 0.1.1 reference on 2,000 seeded random pairs", () => {
  const rnd = seeded(42);
  const hex = () => combos.rgb2hex([Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)]);
  for (let i = 0; i < 2000; i++) {
    const base = hex(), a = hex(), b = hex(), s = rnd(), mode = rnd() < 0.5 ? "multiply" : "darken";
    const got = combos.predictHexes(base, s, [a, b], mode);
    const want = ref.predictHexes(base, s, [a, b], mode);
    assert.deepStrictEqual(got, want, `seed ${i}`);
  }
});

/* ---------- T8: classify vs 0.1.1 reference ---------- */
test("T8: classify matches the 0.1.1 reference across the full sweep", () => {
  let n = 0;
  for (const [discName, discHex] of DISCS) {
    for (const mode of ["multiply", "darken"]) {
      for (const s of STRENGTHS) {
        ref.state.base = discHex; ref.state.baseName = discName; ref.state.blend = mode; ref.state.strengthVal = s;
        const setup = setupFor(discHex, discName, mode, s, "floetrol", "cells");
        for (const dye of DYES) {
          const got = combos.classify(dye, setup);
          const want = ref.classify(dye);
          assert.strictEqual(got.cat, want.cat, `cat disc ${discName} mode ${mode} s ${s} dye ${dye.id}`);
          assert.strictEqual(got.why, want.why, `why disc ${discName} mode ${mode} s ${s} dye ${dye.id}`);
          assert.strictEqual(got.darkDye, want.darkDye);
          assert.strictEqual(got.score, want.score);
          assert.deepStrictEqual(got.eff, want.eff);
          assert.deepStrictEqual(got.res, want.res);
          n++;
        }
      }
    }
  }
  assert.ok(n > 0);
});

test("T8b: isMud and nameColor match the 0.1.1 reference on 5,000 seeded random colors", () => {
  const rnd = seeded(7);
  for (let i = 0; i < 5000; i++) {
    const rgb = [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)];
    assert.strictEqual(combos.isMud(rgb), ref.isMud(rgb), `isMud ${rgb}`);
    assert.strictEqual(combos.nameColor(rgb), ref.nameColor(rgb), `nameColor ${rgb}`);
  }
});

test("T8c: a black dye touching a yellow-disc result is muddy", () => {
  const [, yellowHex] = DISCS.find(([n]) => n === "Yellow");
  const setup = setupFor(yellowHex, "Yellow", "multiply", 1, "floetrol", "cells");
  const blackDye = { id: "t", code: "t", name: "test black", rgb: [10, 10, 8] };
  const res = combos.classify(blackDye, setup);
  assert.strictEqual(combos.isMud(res.res), true);
});

/* ---------- T7: comboTouchPairs per AC-7 ---------- */
test("T7: comboTouchPairs matches the AC-7 table for every pattern", () => {
  const ring = ["spin", "offcenter", "lollipop", "swirl", "river", "starburst"];
  for (const p of ring) {
    assert.deepStrictEqual(combos.comboTouchPairs(p, 3), [[0, 1], [1, 2], [2, 0]], p);
    assert.deepStrictEqual(combos.comboTouchPairs(p, 2), [[0, 1]], p);
  }
  assert.deepStrictEqual(combos.comboTouchPairs("cells", 3), [[0, 1], [0, 2]]);
  assert.deepStrictEqual(combos.comboTouchPairs("cells", 2), [[0, 1]]);
  assert.deepStrictEqual(combos.comboTouchPairs("dipfade", 3), [[0, 1], [1, 2]]);
  assert.deepStrictEqual(combos.comboTouchPairs("dipfade", 2), [[0, 1]]);
  assert.deepStrictEqual(combos.comboTouchPairs("doubledip", 3), [[0, 1], [2, 0], [2, 1]]);
  assert.deepStrictEqual(combos.comboTouchPairs("doubledip", 2), [[0, 1]]);
  /* Gate 4 Decision A (Story 0.5.0 AC-52): Stencil's third color is a ring inside the rim and Full dip's
     colors are bands, so their pairs follow the picture. */
  assert.deepStrictEqual(combos.comboTouchPairs("stencil", 3), [[0, 1], [2, 0], [2, 1]]);
  assert.deepStrictEqual(combos.comboTouchPairs("stencil", 2), [[0, 1]]);
  assert.deepStrictEqual(combos.comboTouchPairs("full", 3), [[0, 1], [1, 2]]);
  assert.deepStrictEqual(combos.comboTouchPairs("full", 2), [[0, 1]]);
});

/* ---------- combo picker helpers ---------- */
function poolFor(discHex, discName, blend, strength) {
  const setup0 = setupFor(discHex, discName, blend, strength, "floetrol", "cells");
  return DYES.map(d => combos.classify(d, setup0));
}

/* ---------- T1 ---------- */
/* AC-1: "mid-toned dyes are not shut out of any role" means each can be a background and a cell when
   the dyes allow it, not that one must rank into the top 8 (Sean, 2026-09-30: option A). */
test("T1: white disc, floetrol/cells, multiply, strength .8: variety includes red, purple, pink; mid-toned dyes can be background and cell", () => {
  const [, whiteHex] = DISCS.find(([n]) => n === "White");
  const pool = poolFor(whiteHex, "White", "multiply", 0.8);
  const setup = setupFor(whiteHex, "White", "multiply", 0.8, "floetrol", "cells");
  const types = combos.buildCombos(pool, setup);
  const names = new Set();
  types.forEach(t => t.options.forEach(o => o.forEach(r => names.add(combos.nameColor(r.res)))));
  const joined = [...names].join(" | ");
  assert.match(joined, /red/, joined);
  assert.match(joined, /purple/, joined);
  assert.match(joined, /pink/, joined);
  const cells = types.find(t => t.key === "cells");
  assert.ok(cells, "cells type present on white disc");
  const L = r => combos.lab(r.res).L;
  const mids = pool.filter(r => r.cat === "pop" && !r.darkDye && L(r) >= 45 && L(r) < 55);
  assert.ok(mids.length, "white disc has mid-toned dyes to test");
  const lights = pool.filter(r => r.cat === "pop" && !r.darkDye).sort((a, b) => L(b) - L(a));
  const darkest = pool.filter(r => r.cat === "pop" && r.darkDye).sort((a, b) => L(a) - L(b))[0];
  for (const m of mids) {
    const [l1, l2] = lights.filter(r => r !== m && L(r) >= L(m) + 25);
    const asBg = combos.buildCombos([m, l1, l2], setup).find(t => t.key === "cells");
    assert.ok(asBg && asBg.options.some(o => o[0] === m), `${m.dye.name} can be the background`);
    const asCell = combos.buildCombos([darkest, m, l1], setup).find(t => t.key === "cells");
    assert.ok(asCell && asCell.options.some(o => o.indexOf(m) > 0), `${m.dye.name} can be a cell`);
  }
});

/* ---------- T2 ---------- */
test("T2: variety rules hold across a disc x base x blend x pattern sweep", () => {
  const bases = [
    ["floetrol", "cells"], ["spin", "spin"], ["glue", "swirl"], ["cream", "starburst"], ["hotdip", "full"],
  ];
  for (const [, discHex] of DISCS) {
    for (const [tb, pattern] of bases) {
      for (const blend of ["multiply", "darken"]) {
        const setup0 = setupFor(discHex, "x", blend, 0.8, tb, pattern);
        const pool = DYES.map(d => combos.classify(d, setup0));
        const types = combos.buildCombos(pool, setup0);
        for (const t of types) {
          assert.ok(t.options.length <= 8, `${t.key} <=8 options`);
          const leadCount = {}, uses = {}, sigs = new Set();
          for (const o of t.options) {
            const sig = o.map(r => r.dye.id).sort().join("|");
            assert.ok(!sigs.has(sig), `${t.key} duplicate option set`);
            sigs.add(sig);
            leadCount[o[0].dye.id] = (leadCount[o[0].dye.id] || 0) + 1;
            o.forEach(r => uses[r.dye.id] = (uses[r.dye.id] || 0) + 1);
          }
          Object.values(leadCount).forEach(c => assert.ok(c <= 2, `${t.key} a dye led more than twice`));
          Object.values(uses).forEach(c => assert.ok(c <= 3, `${t.key} a dye appeared more than 3 times`));
        }
      }
    }
  }
});

test("T2b: pickVaried never lets one dye lead 3 times, even with many willing candidates", () => {
  const it = [0, 1, 2, 3, 4].map(i => ({ r: { dye: { id: "d" + i } }, fam: "fam" + i }));
  const cands = [];
  for (let i = 1; i < 5; i++) cands.push({ s: [0, i], q: 5 - i }); // all led by dye 0, distinct signatures
  const picked = combos.pickVaried(cands, it, 8);
  const leads = picked.filter(o => o[0].dye.id === "d0");
  assert.ok(leads.length <= 2, "dye 0 should lead at most twice");
});

/* ---------- T3 ---------- */
test("T3: white disc cells has both directions (lighter cells and darker cells)", () => {
  const [, whiteHex] = DISCS.find(([n]) => n === "White");
  const pool = poolFor(whiteHex, "White", "multiply", 0.8);
  const setup = setupFor(whiteHex, "White", "multiply", 0.8, "floetrol", "cells");
  const cells = combos.buildCombos(pool, setup).find(t => t.key === "cells");
  assert.ok(cells);
  const lighter = cells.options.some(o => combos.lab(o[1].res).L > combos.lab(o[0].res).L);
  const darker = cells.options.some(o => combos.lab(o[1].res).L < combos.lab(o[0].res).L);
  assert.ok(lighter, "expected a lighter-cells option");
  assert.ok(darker, "expected a darker-cells option");
});

/* ---------- T4 ---------- */
test("T4: yellow disc, floetrol/cells, multiply .8: Neighbors has 8 options", () => {
  const [, yellowHex] = DISCS.find(([n]) => n === "Yellow");
  const pool = poolFor(yellowHex, "Yellow", "multiply", 0.8);
  const setup = setupFor(yellowHex, "Yellow", "multiply", 0.8, "floetrol", "cells");
  const neighbors = combos.buildCombos(pool, setup).find(t => t.key === "neighbors");
  assert.ok(neighbors);
  assert.strictEqual(neighbors.options.length, 8);
});

/* ---------- T5 ---------- */
test("T5: orange and grey x glue and cream: Light to dark has at least one option", () => {
  const discs = ["Orange", "Grey"];
  const techs = [["glue", "swirl"], ["cream", "starburst"]];
  for (const dn of discs) {
    const [, hex] = DISCS.find(([n]) => n === dn);
    for (const [tb, pattern] of techs) {
      const setup = setupFor(hex, dn, "multiply", 0.8, tb, pattern);
      const pool = DYES.map(d => combos.classify(d, setup));
      const lightdark = combos.buildCombos(pool, setup).find(t => t.key === "lightdark");
      assert.ok(lightdark, `${dn}/${tb}: no lightdark type`);
      assert.ok(lightdark.options.length >= 1, `${dn}/${tb}: lightdark empty`);
    }
  }
});

/* ---------- T6 ---------- */
test("T6: own type, when present, is always types[0]; present for every base on white", () => {
  const bases = [
    ["floetrol", "cells"], ["spin", "spin"], ["glue", "swirl"], ["cream", "starburst"], ["hotdip", "full"], [null, "swirl"],
  ];
  for (const [, discHex] of DISCS) {
    for (const [tb, pattern] of bases) {
      for (const blend of ["multiply", "darken"]) {
        const setup = setupFor(discHex, "x", blend, 0.8, tb, pattern);
        const pool = DYES.map(d => combos.classify(d, setup));
        const types = combos.buildCombos(pool, setup);
        if (!types.length) continue;
        const key = ownKeyFor(tb);
        const own = types.find(t => t.key === key);
        if (own) assert.strictEqual(types[0].key, key);
      }
    }
  }
  for (const [, discHex] of DISCS.filter(([n]) => n === "White")) {
    for (const [tb, pattern] of bases) {
      const setup = setupFor(discHex, "White", "multiply", 0.8, tb, pattern);
      const pool = DYES.map(d => combos.classify(d, setup));
      const types = combos.buildCombos(pool, setup);
      assert.ok(types.find(t => t.key === ownKeyFor(tb)), `own type missing for tb=${tb} on white`);
    }
  }
});

/* ---------- T-wheel ---------- */
test("T-wheel: hsvToRgb / wheelPos round-trip", () => {
  const C = 170, R = 158;
  for (const angleDeg of [10, 80, 160, 250, 330]) {
    const a = angleDeg * Math.PI / 180, d = R * 0.6;
    const dx = d * Math.sin(a), dy = -d * Math.cos(a);
    const rgb = combos.wheelPointToRgb(dx, dy, R);
    const [x, y] = combos.wheelPos(rgb, C, R);
    assert.ok(Math.abs(x - (C + dx)) < 4, `x round-trip at ${angleDeg}deg: ${x} vs ${C + dx}`);
    assert.ok(Math.abs(y - (C + dy)) < 4, `y round-trip at ${angleDeg}deg: ${y} vs ${C + dy}`);
  }
});

test("T-wheel: dialMatch is neutral for a white, grey or black start", () => {
  assert.deepStrictEqual(combos.dialMatch([], combos.hex2rgb("#ffffff"), "opp"), { neutral: true });
  assert.deepStrictEqual(combos.dialMatch([], combos.hex2rgb("#a0a3a6"), "opp"), { neutral: true });
  assert.deepStrictEqual(combos.dialMatch([], combos.hex2rgb("#101010"), "opp"), { neutral: true });
});

test("T-wheel: white disc Opposite has 2 pointers, Square has 4", () => {
  const [, whiteHex] = DISCS.find(([n]) => n === "White");
  const pool = poolFor(whiteHex, "White", "multiply", 0.8);
  const start = combos.hsvToRgb(0, 0.9, 0.8);
  assert.strictEqual(combos.dialMatch(pool, start, "opp").pointers.length, 2);
  assert.strictEqual(combos.dialMatch(pool, start, "sq").pointers.length, 4);
});

test("T-wheel: dial pointer dyes list muddy dyes last", () => {
  for (const [discName, discHex] of DISCS) {
    const pool = poolFor(discHex, discName, "multiply", 0.8);
    for (const type of Object.keys(combos.DIAL)) {
      const start = combos.hsvToRgb(200, 0.9, 0.8);
      const m = combos.dialMatch(pool, start, type);
      if (m.neutral) continue;
      for (const ptr of m.pointers) {
        let seenMud = false;
        for (const r of ptr.dyes) {
          if (r.cat === "mud") seenMud = true;
          else assert.strictEqual(seenMud, false, `${discName} ${type}: non-mud dye after a mud dye`);
        }
      }
    }
  }
});

/* ---------- S1: no redeclaration of combos.js exports in index.html's inline scripts ---------- */
test("S1: index.html inline scripts declare none of combos.js's exported names", () => {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const body = inlineScripts.join("\n");
  const names = Object.keys(combos);
  for (const name of names) {
    const re = new RegExp(`\\b(function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\b)`);
    assert.doesNotMatch(body, re, `index.html redeclares combos.js export "${name}"`);
  }
});

/* ---------- S2: sw.js VERSION and index.html ?v= stay in lockstep ---------- */
test("S2: sw.js VERSION matches ?v= on both script tags; FILES includes combos.js", () => {
  const sw = fs.readFileSync(SW_PATH, "utf8");
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const version = sw.match(/const VERSION\s*=\s*"([^"]+)"/);
  assert.ok(version, "sw.js: could not find VERSION");
  const comboTag = html.match(/combos\.js\?v=([^"]+)"/);
  const localTag = html.match(/local\.js\?v=([^"]+)"/);
  assert.ok(comboTag, "index.html: combos.js script tag missing ?v=");
  assert.ok(localTag, "index.html: local.js script tag missing ?v=");
  assert.strictEqual(comboTag[1], version[1]);
  assert.strictEqual(localTag[1], version[1]);
  const filesMatch = sw.match(/const FILES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(filesMatch, "sw.js: could not find FILES");
  assert.match(filesMatch[1], /["']combos\.js["']/, "sw.js FILES does not include combos.js");
});

/* =================== 0.5.0: touch pairs, Dyes per combo, photo groups, the dye cap =================== */
const ref041 = require("./reference-0.4.1-combos.js");
const PREVIEW_PATH = require("path").join(__dirname, "..", "preview.js");
const T2_BASES = [["floetrol", "cells"], ["spin", "spin"], ["glue", "swirl"], ["cream", "starburst"], ["hotdip", "full"]];
const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const chainPairs = k => Array.from({ length: Math.max(0, k - 1) }, (_, j) => [j, j + 1]);

/* ---------- T7b: touch pairs for any number of dyes (Story 0.5.0 AC-51, AC-52) ---------- */
test("T7b: comboTouchPairs follows the picture at 4 and 8 dyes, asks photos, and falls back to rings", () => {
  const ring = ["spin", "offcenter", "lollipop", "swirl", "river", "starburst"];
  for (const k of [4, 8]) {
    for (const p of ring) assert.deepStrictEqual(combos.comboTouchPairs(p, k), chainPairs(k).concat([[k - 1, 0]]), `${p} ${k}`);
    assert.deepStrictEqual(combos.comboTouchPairs("cells", k), Array.from({ length: k - 1 }, (_, j) => [0, j + 1]), `cells ${k}`);
    assert.deepStrictEqual(combos.comboTouchPairs("dipfade", k), chainPairs(k), `dipfade ${k}`);
    assert.deepStrictEqual(combos.comboTouchPairs("full", k), chainPairs(k), `full ${k}`);
    assert.deepStrictEqual(combos.comboTouchPairs("zzz-unknown", k), combos.comboTouchPairs("spin", k), `unknown ${k}`);
  }
  assert.deepStrictEqual(combos.comboTouchPairs("doubledip", 4), [[0, 1], [2, 0], [2, 1], [3, 0], [3, 1], [3, 2]]);
  assert.deepStrictEqual(combos.comboTouchPairs("stencil", 4), [[0, 1], [2, 0], [2, 1], [3, 0], [3, 2]]);
  const dd8 = [[0, 1], [2, 0], [2, 1]], st8 = [[0, 1]];
  for (let j = 3; j < 8; j++) dd8.push([j, 0], [j, 1], [j, j - 1]);
  for (let j = 2; j < 8; j++) st8.push([j, 0], [j, j - 1]);
  assert.deepStrictEqual(combos.comboTouchPairs("doubledip", 8), dd8);
  assert.deepStrictEqual(combos.comboTouchPairs("stencil", 8), st8);
  for (const p of [...ring, "cells", "dipfade", "full", "doubledip", "stencil"]) {
    assert.deepStrictEqual(combos.comboTouchPairs(p, 1), [], `${p} 1`);
    assert.deepStrictEqual(combos.comboTouchPairs(p, 0), [], `${p} 0`);
  }
  assert.deepStrictEqual(combos.comboTouchPairs("full", 1), [], "Full dip with one color has no touch");
  /* Photo patterns use the page's photo groups, never the ring fallback (story note 5). */
  const stub = k => (k === 4 ? [[0, 2], [1, 3], [2, 3]] : null);
  for (const key of ["photo-cells", "photo-flames", "own:abc123"]) {
    assert.deepStrictEqual(combos.comboTouchPairs(key, 4, stub), [[0, 2], [1, 3], [2, 3]], key);
    assert.deepStrictEqual(combos.comboTouchPairs(key, 5, stub), [], `${key}: photo not ready yet`);
    assert.deepStrictEqual(combos.comboTouchPairs(key, 4), [], `${key}: no photo groups given`);
    assert.deepStrictEqual(combos.comboTouchPairs(key, 2, stub), [], `${key}: pairs past the dye count are dropped`);
  }
});

/* ---------- T21: "As now" is exactly 0.4.1 (Story 0.5.0 AC-43, Gate 4 Decision A exclusions) ---------- */
function typeSummary(t) {
  return { key: t.key, title: t.title, touch: t.touch, options: t.options.map(o => o.map(r => r.dye.id)), blurbs: t.options.map(o => t.blurb(o)) };
}
test("T21: with Dyes per combo on As now, the combos match the frozen 0.4.1 picker except Hot dip on Full dip and Stencil's 3-dye Neighbors", () => {
  const bases = [...T2_BASES, ["hotdip", "doubledip"], ["hotdip", "dipfade"], ["hotdip", "stencil"]];
  let compared = 0;
  for (const [, discHex] of DISCS) {
    for (const [tb, pattern] of bases) {
      if (tb === "hotdip" && pattern === "full") continue; /* Decision A: Full dip pairs now follow the bands */
      for (const blend of ["multiply", "darken"]) {
        for (const perCombo of [undefined, 0]) {
          const setup = { ...setupFor(discHex, "x", blend, 0.8, tb, pattern), perCombo };
          const pool = DYES.map(d => combos.classify(d, setup));
          /* Decision A: Stencil's third color is now a ring touching colors 1 and 2, which changes the
             3-dye Neighbors only; every other type is compared. */
          const keep = t => !(pattern === "stencil" && t.key === "neighbors");
          const got = combos.buildCombos(pool, setup).filter(keep).map(typeSummary);
          const want = ref041.buildCombos(pool, setup).filter(keep).map(typeSummary);
          assert.deepStrictEqual(got, want, `disc ${discHex} ${tb}/${pattern} ${blend} perCombo ${perCombo}`);
          compared += got.length;
        }
      }
    }
  }
  assert.ok(compared > 100, `only ${compared} combo types compared`);
});

test("T21b: the cases T21 leaves out follow the new picture: Hot dip Neighbors never has a muddy touch between bands or rings", () => {
  const want = { full: k => chainPairs(k), stencil: k => (k >= 3 ? [[0, 1], [2, 0], [2, 1]] : [[0, 1]]).filter(([a, b]) => a < k && b < k) };
  let checked = 0;
  for (const [, discHex] of DISCS) {
    for (const pattern of ["full", "stencil"]) {
      for (const blend of ["multiply", "darken"]) {
        const setup = setupFor(discHex, "x", blend, 0.8, "hotdip", pattern);
        const pool = DYES.map(d => combos.classify(d, setup));
        const nb = combos.buildCombos(pool, setup).find(t => t.key === "neighbors");
        for (const o of nb ? nb.options : []) {
          for (const [a, b] of want[pattern](o.length)) {
            assert.ok(!combos.isMud(combos.touchRgb(o[a], o[b], blend)), `${pattern} ${discHex} ${blend}: ${o[a].dye.name} + ${o[b].dye.name} touch and go muddy`);
          }
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 0, "no Neighbors options to check");
});

/* ---------- T22: N dyes per combo (Story 0.5.0 AC-46, AC-49) ---------- */
test("T22: with 4 to 8 dyes per combo, every option has exactly that many distinct, clean dyes and the variety rules hold", () => {
  for (let N = 4; N <= combos.MAX_DYES; N++) {
    let options = 0;
    for (const [, discHex] of DISCS) {
      for (const [tb, pattern] of T2_BASES) {
        for (const blend of ["multiply", "darken"]) {
          const setup = { ...setupFor(discHex, "x", blend, 0.8, tb, pattern), perCombo: N };
          const pool = DYES.map(d => combos.classify(d, setup));
          for (const t of combos.buildCombos(pool, setup)) {
            assert.ok(t.options.length >= 1 && t.options.length <= 8, `${t.key}: 1 to 8 options`);
            const leadCount = {}, uses = {}, sets = new Set();
            for (const o of t.options) {
              assert.strictEqual(o.length, N, `${t.key} N=${N}: an option has ${o.length} dyes`);
              o.forEach(r => assert.notStrictEqual(r.cat, "mud", `${t.key}: ${r.dye.name} goes muddy on the disc`));
              o.forEach((r, x) => o.forEach((q, y) => {
                if (y > x) assert.ok(combos.dE(combos.lab(r.res), combos.lab(q.res)) >= combos.DISTINCT, `${t.key} N=${N}: ${r.dye.name} and ${q.dye.name} are near-duplicates`);
              }));
              const sig = o.map(r => r.dye.id).sort().join("|");
              assert.ok(!sets.has(sig), `${t.key}: the same set twice`);
              sets.add(sig);
              leadCount[o[0].dye.id] = (leadCount[o[0].dye.id] || 0) + 1;
              o.forEach(r => uses[r.dye.id] = (uses[r.dye.id] || 0) + 1);
              assert.strictEqual(t.blurb(o).length > 0, true);
              options++;
            }
            Object.values(leadCount).forEach(c => assert.ok(c <= 2, `${t.key} N=${N}: a dye led more than twice`));
            Object.values(uses).forEach(c => assert.ok(c <= 3, `${t.key} N=${N}: a dye appeared more than 3 times`));
          }
        }
      }
    }
    assert.ok(options > 0, `no options at all with ${N} dyes per combo`);
  }
});

/* ---------- T23: time budget (Story 0.5.0 AC-50, Blueprint 0.5.0 §5.5) ----------
   T0 is today's picker (the frozen 0.4.1 copy) with all 49 ProChem dyes on a white disc, Multiply, 80%
   depth, per base: the median of 15 runs, printed so the numbers can be recorded. The three pickers are timed
   in turn, run by run, so a machine that gets busier mid-check slows all three alike. 8 dyes per combo must
   stay within max(3.5 x T0, T0 + 40 ms) for every base: Sean accepted about 50 ms vs about 27 ms (2026-10-04;
   measured 2.5-3.3 x T0 per base), with combos worked out only when a setting changes (combosFor in index.html).
   It guards against anything much slower. */
test("T23: 8 dyes per combo works out within today's time budget", t => {
  const [, whiteHex] = DISCS.find(([n]) => n === "White");
  const timeTogether = (fs, runs = 15) => {
    fs.forEach(f => f());
    const xs = fs.map(() => []);
    for (let i = 0; i < runs; i++) fs.forEach((f, j) => { const t0 = process.hrtime.bigint(); f(); xs[j].push(Number(process.hrtime.bigint() - t0) / 1e6); });
    return xs.map(median);
  };
  const rows = [];
  for (const [tb, pattern] of T2_BASES) {
    const setup = setupFor(whiteHex, "White", "multiply", 0.8, tb, pattern);
    const pool = DYES.map(d => combos.classify(d, setup));
    const [T0, asNow, T8] = timeTogether([
      () => ref041.buildCombos(pool, setup),
      () => combos.buildCombos(pool, setup),
      () => combos.buildCombos(pool, { ...setup, perCombo: 8 })
    ]);
    rows.push({ tb, T0, asNow, T8, budget: Math.max(3.5 * T0, T0 + 40) });
  }
  t.diagnostic("base | 0.4.1 T0 ms | As now ms | 8 per combo ms | budget ms");
  rows.forEach(r => t.diagnostic(`${r.tb} | ${r.T0.toFixed(1)} | ${r.asNow.toFixed(1)} | ${r.T8.toFixed(1)} | ${r.budget.toFixed(1)}`));
  for (const r of rows) assert.ok(r.T8 <= r.budget, `${r.tb}: 8 dyes per combo took ${r.T8.toFixed(1)} ms, budget ${r.budget.toFixed(1)} ms (T0 ${r.T0.toFixed(1)} ms)`);
});

/* ---------- T24: photo color groups and which groups touch (Story 0.5.0 AC-16, AC-51) ---------- */
test("T24: photoGroups sorts groups by size, is repeatable, and one group is the average; groupTouchPairs ignores a one-pixel speck", () => {
  const px = [];
  const add = (r, g, b, n) => { for (let i = 0; i < n; i++) px.push(r + (i % 5) * 0.002, g, b); };
  add(0.2, 0.1, 0.6, 400); add(0.8, 0.2, 0.1, 350); add(0.3, 0.9, 0.3, 250);
  const P = new Float32Array(px);
  const g = combos.photoGroups(P, 3);
  assert.deepStrictEqual(g.counts, [400, 350, 250], "groups are not sorted largest first");
  assert.ok(g.centers[0][2] > 0.5 && g.centers[1][0] > 0.7 && g.centers[2][1] > 0.8, "group colors are wrong");
  assert.ok(g.labels.slice(0, 400).every(l => l === 0) && g.labels.slice(400, 750).every(l => l === 1) && g.labels.slice(750).every(l => l === 2), "pixels are labeled with the wrong group");
  assert.deepStrictEqual(combos.photoGroups(P, 3), g, "the same photo gave different groups");
  const one = combos.photoGroups(P, 1);
  const mean = [0, 1, 2].map(c => px.filter((_, i) => i % 3 === c).reduce((a, b) => a + b, 0) / 1000);
  one.centers[0].forEach((v, c) => assert.ok(Math.abs(v - mean[c]) < 1e-6, "one group should be the average color"));
  assert.deepStrictEqual(one.counts, [1000]);

  const S = 20, map = new Int16Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) map[y * S + x] = x < 10 ? 0 : 1;
  assert.deepStrictEqual(combos.groupTouchPairs(map, S, 2), [[0, 1]]);
  const speck = map.slice(); speck[5 * S + 10] = 2;
  assert.deepStrictEqual(combos.groupTouchPairs(speck, S, 3), [[0, 1]], "a one-pixel speck counted as touching");
  const block = map.slice();
  for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) block[y * S + x] = 2;
  assert.deepStrictEqual(combos.groupTouchPairs(block, S, 3), [[0, 1], [0, 2]]);
  const outside = block.slice(); for (let i = 0; i < S; i++) outside[i] = -1;
  assert.deepStrictEqual(combos.groupTouchPairs(outside, S, 3), [[0, 1], [0, 2]], "pixels outside the disc changed the pairs");
});

/* ---------- T25: cell colors (Story 0.5.0 AC-10) ---------- */
test("T25: cellRoles outlines cycle through every color in order and fills never use the background", () => {
  for (const n of [2, 3, 5, 8]) {
    for (let i = 0; i < 64; i++) {
      const R = combos.cellRoles(i, n);
      assert.strictEqual(R.outline, (i + 1) % n);
      assert.ok(R.fill >= 1 && R.fill < n, `fill ${R.fill} with ${n} colors`);
    }
    const outlines = Array.from({ length: n }, (_, i) => combos.cellRoles(i, n).outline);
    assert.deepStrictEqual(outlines.slice().sort((a, b) => a - b), [...Array(n).keys()], "outlines miss a color");
  }
  assert.deepStrictEqual(combos.cellRoles(4, 1), { fill: -1, outline: 0 }, "one color: no fill, outline in color 1");
});

/* ---------- T26: one dye cap (Story 0.5.0 AC-34, AC-36) ----------
   Planner routes only; the Test log form and the sheet are checked when they change (Part 2). */
test("T26: the Planner's dye limits all read MAX_DYES (8) and the hint says 8", () => {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  assert.strictEqual(combos.MAX_DYES, 8);
  const sites = {
    addToDisc: html.match(/^function addToDisc\(.*$/m),
    toggleDye: html.match(/^function toggleDye\(.*$/m),
    applySetup: html.match(/function applySetup\(s\)\{[\s\S]*?\n\}/),
    showOnDisc: html.match(/^.*closest\("\[data-combo\]"\).*$/m)
  };
  for (const [name, m] of Object.entries(sites)) {
    assert.ok(m, `${name} not found in index.html`);
    assert.doesNotMatch(m[0], /length>3|slice\(0,3\)|\[0,1,2\]|i<3/, `${name} still has a limit of 3`);
    assert.match(m[0], /MAX_DYES/, `${name} does not read MAX_DYES`);
  }
  assert.doesNotMatch(html, /add up to 3 colors/);
  assert.match(html, /Tap dye cards to add up to \$\{MAX_DYES\} colors, in order\. Drag a color to reorder it, or use ← and ×\./);
});

/* ---------- S1b / S2b: preview.js in step (Story 0.5.0 AC-75) ---------- */
test("S1b: the disc drawing lives only in preview.js; index.html declares none of its globals", () => {
  const html = fs.readFileSync(INDEX_PATH, "utf8"), pv = fs.readFileSync(PREVIEW_PATH, "utf8");
  const body = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  for (const name of ["seeded", "drawPattern", "drawDiscOn", "DiscPreview"]) {
    assert.doesNotMatch(body, new RegExp(`\\b(function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\b)`), `index.html declares "${name}"`);
    assert.match(pv, new RegExp(`\\b(function\\s+${name}\\s*\\(|const\\s+${name}\\b)`), `preview.js does not declare "${name}"`);
  }
});

test("S2b: preview.js's ?v= matches VERSION, it loads between combos.js and local.js, and FILES has it and the three photos", () => {
  const sw = fs.readFileSync(SW_PATH, "utf8"), html = fs.readFileSync(INDEX_PATH, "utf8");
  const version = sw.match(/const VERSION\s*=\s*"([^"]+)"/)[1];
  const tag = html.match(/preview\.js\?v=([^"]+)"/);
  assert.ok(tag, "index.html: preview.js script tag missing ?v=");
  assert.strictEqual(tag[1], version);
  const at = f => html.indexOf(`<script src="${f}?v=`);
  assert.ok(at("combos.js") >= 0 && at("combos.js") < at("preview.js") && at("preview.js") < at("local.js"), "script order must be combos.js, preview.js, local.js");
  const files = sw.match(/const FILES\s*=\s*\[([\s\S]*?)\];/)[1];
  for (const f of ["preview.js", "photos/cells.jpg", "photos/flames.jpg", "photos/spoked-starburst.jpg"]) {
    assert.match(files, new RegExp(`["']${f.replace(/[./]/g, "\\$&")}["']`), `sw.js FILES does not include ${f}`);
    assert.ok(fs.existsSync(require("path").join(__dirname, "..", f)), `${f} is missing from the app folder`);
  }
});

/* ---------- T26b: the Test log form and the printable sheet read the one dye cap (Story 0.5.0 AC-34, AC-40, AC-41) ---------- */
test("T26b: the log form's slots, readForm and the sheet's color lines all follow MAX_DYES; no 3-dye limit is left in index.html", () => {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const sites = {
    dyeSlots: html.match(/^const dyeSlots=.*$/m),
    formHtml: html.match(/function formHtml\(id,e\)\{[\s\S]*?\n\}/),
    readForm: html.match(/function readForm\(f,orig\)\{[\s\S]*?\n\}/),
    sheetText: html.match(/function sheetText\(prefill\)\{[\s\S]*?\n\}/)
  };
  for (const [name, m] of Object.entries(sites)) {
    assert.ok(m, `${name} not found in index.html`);
    /* techs.slice(0,3) lays the sheet's technique checkboxes out three to a row; it is not a dye limit. */
    assert.doesNotMatch(m[0].replace(/techs\.slice\(0,3\)/g, ""), /\[0,1,2\]|i<3\b|length>3|slice\(0,3\)/, `${name} still has a limit of 3`);
  }
  assert.match(sites.dyeSlots[0], /MAX_DYES/, "the form's slot count must read MAX_DYES");
  assert.match(sites.sheetText[0], /i<MAX_DYES/, "the sheet must print MAX_DYES color lines");
  assert.match(sites.readForm[0], /data-dyeslot/, "readForm must read every color slot");
  /* Across the inline app code, no other dye limit of 3 (the sheet's technique checkboxes are not dyes). */
  const body = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  assert.doesNotMatch(body, /\[0,1,2\]|\bi<3\b|sel\.length>3|sel\.slice\(0,3\)/, "a 3-dye limit is left in index.html");
});
