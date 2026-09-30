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
  assert.deepStrictEqual(combos.comboTouchPairs("stencil", 3), [[0, 1]]);
  assert.deepStrictEqual(combos.comboTouchPairs("stencil", 2), [[0, 1]]);
  assert.deepStrictEqual(combos.comboTouchPairs("full", 3), []);
  assert.deepStrictEqual(combos.comboTouchPairs("full", 2), []);
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
