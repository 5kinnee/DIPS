"use strict";
/* Screen checks: open the real app in Edge and use it the way a person does.
   Taps go through the browser's hit-testing (mouse.click / touchscreen.tap at a point),
   so a layer sitting on top of a control fails here even when the control's code is fine. */
const { test, assert, DEVICES, openApp, tapAt, tapEl, boxOf, tokenRgb, contrast, hueOf, stateSel, reopen, showWheel, clearPicked, openShelf, hitArea } = require("./harness.js");

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

/* ---------- 0.3.0: dye shelf, chip buttons, wheel filter, tap color ---------- */
for (const device of ["computer", "phone"]) {
  test(`S3 (${device}): the dye shelf opens closed every visit and turns amber with no dyes`, async () => {
    const { context, page, errors } = await openApp(device);
    try {
      const warnBg = await tokenRgb(page, "--warn-bg"), surface = await tokenRgb(page, "--surface"), tap = await tokenRgb(page, "--tap");
      const read = () => page.evaluate(() => {
        const f = document.querySelector("#shelfFold"), n = document.querySelector("#shelfNote");
        return {
          open: f.open, unmarked: f.classList.contains("unmarked"), bg: getComputedStyle(f).backgroundColor,
          title: document.querySelector("#shelfTitle").textContent, note: n.textContent, noteColor: getComputedStyle(n).color,
          afterBanner: !!(document.querySelector("#banner").compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING),
          beforePool: !!(f.compareDocumentPosition(document.querySelector("#poolSeg")) & Node.DOCUMENT_POSITION_FOLLOWING)
        };
      });

      let s = await read();
      assert.strictEqual(s.open, false, "the shelf should be closed when the app opens");
      assert.ok(s.afterBanner && s.beforePool, "the shelf should sit under the disc-color banner and above Suggest from");
      assert.strictEqual(s.title, "My dye shelf (0)");
      assert.ok(s.unmarked, "with no dyes marked the shelf bar should be in the amber state");
      assert.strictEqual(s.bg, warnBg, "the amber state should use the reminder background");
      assert.strictEqual(s.note, "Mark the dyes you own");
      assert.strictEqual(s.noteColor, tap, "the right-hand text should be tap blue");

      await openShelf(page, device);
      s = await read();
      assert.strictEqual(s.note, "Tap a jar to mark it as yours");

      await tapEl(page, device, "#shelf .jar");
      await page.waitForFunction(() => document.querySelector("#shelfTitle").textContent === "My dye shelf (1)");
      s = await read();
      assert.strictEqual(s.open, true, "marking a jar should leave the shelf open");
      assert.strictEqual(s.unmarked, false, "the amber state should clear once a dye is marked");
      assert.strictEqual(s.bg, surface, "with dyes marked the bar should look like a normal panel");

      await reopen(page);
      s = await read();
      assert.strictEqual(s.open, false, "the shelf should be closed again after a reload");
      assert.strictEqual(s.title, "My dye shelf (1)", "the marked dye should be kept");
      assert.strictEqual(s.note, "Open to add or remove dyes");
      const keys = await page.evaluate(() => Object.keys(localStorage));
      assert.deepStrictEqual(keys.filter(k => /shelf|fold|open|wheel|show/i.test(k)), [], "the shelf and wheel state should not be saved");
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally {
      await context.close();
    }
  });
}


for (const device of ["phone360", "computer"]) {
  test(`S4 (${device}): the ← and × buttons on color chips and custom dyes take a fingertip near them and never start a drag`, async () => {
    const { context, page, errors } = await openApp(device);
    try {
      await clearPicked(page, device);
      const ids = await page.$$eval(".dye", els => els.slice(0, 2).map(e => e.dataset.dye));
      assert.strictEqual(ids.length, 2, "need two dye cards to pick");
      for (const id of ids) await tapEl(page, device, `.dye[data-dye="${id}"]`);
      await page.waitForFunction(() => state.sel.length === 2);

      const left = "#onDisc .tag[data-idx=\"1\"] [data-left]", rem1 = "#onDisc .tag[data-idx=\"1\"] [data-remove]";
      const lb = await boxOf(page, left), la = await hitArea(page, left), ra = await hitArea(page, rem1);
      const tag = await boxOf(page, '#onDisc .tag[data-idx="1"]');
      assert.ok(Math.abs(lb.height - 30) <= 1, `the ← circle should be 30px tall, was ${lb.height}`);
      assert.ok(tag.height <= 40, `the chip should stay slim, was ${tag.height}px tall`);
      for (const a of [la, ra]) {
        assert.notStrictEqual(a.content, "none", "the button should have an invisible tap margin");
        assert.ok(Math.abs((a.b - a.t) - 44) <= 1, `the tap area should be about 44px tall, was ${a.b - a.t}`);
      }
      assert.ok(la.r <= ra.l + 0.5, "the ← and × tap areas must not overlap");

      if (device === "computer") {
        /* Press on × and move away: no drag may start, and nothing may change. */
        const before = await stateSel(page), x0 = await boxOf(page, '#onDisc [data-remove="0"]');
        const cx = x0.x + x0.width / 2, cy = x0.y + x0.height / 2;
        await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy, { steps: 6 });
        assert.strictEqual(await page.locator(".dragghost").count(), 0, "pressing a button must not start a drag");
        await page.mouse.up();
        assert.deepStrictEqual(await stateSel(page), before, "pressing a button and moving away must not change the colors");

        /* Dragging a chip by its body still reorders. */
        /* Measure both chips after the last scroll: scrolling moves them, so an earlier box would be stale. */
        const t1 = await boxOf(page, '#onDisc .tag[data-idx="1"]'), t0 = await page.locator('#onDisc .tag[data-idx="0"]').boundingBox();
        await page.mouse.move(t0.x + 8, t0.y + t0.height / 2); await page.mouse.down();
        await page.mouse.move(t1.x + t1.width - 4, t1.y + t1.height / 2, { steps: 10 });
        await page.mouse.up();
        await page.waitForFunction(b => state.sel[0] === b[1] && state.sel[1] === b[0], before);
      }

      const order = await stateSel(page);
      const lb2 = await boxOf(page, left);
      await tapAt(page, device, lb2.x + lb2.width / 2, lb2.y - 5);
      await page.waitForFunction(o => state.sel[0] === o[1] && state.sel[1] === o[0], order);

      const rb = await boxOf(page, rem1), swapped = await stateSel(page);
      await tapAt(page, device, rb.x + rb.width / 2, rb.y + rb.height + 5);
      await page.waitForFunction(() => state.sel.length === 1);
      assert.deepStrictEqual(await stateSel(page), [swapped[0]], "the tap just below × should remove that color");

      await openShelf(page, device);
      await page.fill("#cdName", "Test dye");
      await tapEl(page, device, "#cdAdd");
      await page.locator(".jarx").first().waitFor({ state: "visible" });
      const jb = await boxOf(page, ".cfam .jar"), xa = await hitArea(page, ".jarx"), xb = await boxOf(page, ".jarx");
      assert.ok(Math.abs(xb.height - 30) <= 1, `the custom dye × should be 30px tall, was ${xb.height}`);
      assert.ok(xa.l >= jb.x + jb.width, "the × tap area must not cover its own jar");
      await tapAt(page, device, xb.x + xb.width / 2, xb.y - 5);
      await page.waitForFunction(() => document.querySelector(".jarx.armed")?.textContent === "Remove?");
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally {
      await context.close();
    }
  });
}

for (const device of ["computer", "phone"]) {
  test(`S5 (${device}): the wheel opens on My dyes, explains empty views, and draws only the dyes it shows`, async () => {
    const { context, page, errors } = await openApp(device);
    try {
      await showWheel(page, device);
      const pressed = () => page.$eval('#wheelShow [aria-pressed="true"]', b => b.dataset.show);
      const dots = () => page.locator("#wheelSvg circle.dot").count();
      assert.strictEqual(await pressed(), "mine", "the wheel should open on My dyes");

      assert.ok(await page.locator("#wheelEmpty").isVisible(), "with no dyes marked the wheel should explain why it is empty");
      assert.match(await page.locator("#wheelEmptyMine").innerText(), /You haven't marked any dyes as yours yet\. Open My dye shelf and tap the jars you own\./);
      assert.ok(await page.locator("#wheelShowAll").isVisible());
      assert.strictEqual(await dots(), 0);
      assert.ok(await page.$$eval("#wheelSvg title", ts => ts.some(t => t.textContent === "Your disc")), "the disc marker should still be drawn");
      assert.ok(await page.locator("#wheelWrap .wring").isVisible(), "the wheel rim should still be drawn");
      const mud = await page.evaluate(() => [mudRimHues(state.setup).length, document.querySelectorAll('#wheelSvg path[fill="#6b6f75"]').length]);
      assert.strictEqual(mud[1], mud[0], "the grey muddy band should still be drawn");

      await tapEl(page, device, "#wheelShowAll");
      await page.waitForFunction(() => document.querySelector('#wheelShow [data-show="all"]').getAttribute("aria-pressed") === "true");
      const n = await page.evaluate(() => state.results.length);
      assert.ok(n > 0);
      assert.strictEqual(await dots(), 2 * n, "All colors should draw every dye twice (jar and disc)");

      await clearPicked(page, device);
      await tapEl(page, device, '#wheelShow [data-show="picked"]');
      await page.waitForFunction(() => document.querySelector('#wheelShow [data-show="picked"]').getAttribute("aria-pressed") === "true");
      assert.match(await page.locator("#wheelEmptyPicked").innerText(), /Pick a color to see it here: tap a dye card, or switch to All colors and tap a dot\./);
      assert.ok(await page.locator("#wheelEmptyMine").isHidden());
      assert.strictEqual(await dots(), 0);

      await tapEl(page, device, ".dye");
      await page.waitForFunction(() => state.sel.length === 1);
      assert.strictEqual(await dots(), 2, "one picked color should draw its two dots");

      /* Tapping far from every shown dot does nothing. */
      const wb = await boxOf(page, "#wheelSvg");
      const centers = await page.$$eval("#wheelSvg circle.dot", cs => cs.map(c => { const b = c.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }));
      const far = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([fx, fy]) => [wb.x + wb.width * fx, wb.y + wb.height * fy])
        .map(p => ({ p, d: Math.min(...centers.map(c => Math.hypot(c[0] - p[0], c[1] - p[1]))) })).sort((a, b) => b.d - a.d)[0];
      assert.ok(far.d > 40, "no wheel corner is clear of the dots");
      const before = await stateSel(page);
      await tapAt(page, device, far.p[0], far.p[1]);
      assert.deepStrictEqual(await stateSel(page), before, "tapping away from the dots must not change the colors");

      /* Mark several jars, then My dyes: every dot and every dial chip is a dye you own. */
      await openShelf(page, device);
      const jarIds = await page.$$eval("#shelf .jar", els => els.slice(0, 6).map(e => e.dataset.jar));
      assert.strictEqual(jarIds.length, 6);
      for (const id of jarIds) await tapEl(page, device, `#shelf .jar[data-jar="${id}"]`);
      await page.waitForFunction(() => state.owned.size === 6);
      await tapEl(page, device, "#dialFold > summary");
      await page.waitForFunction(() => document.querySelector("#dialFold").open);
      await tapEl(page, device, '#wheelShow [data-show="all"]');
      await page.waitForFunction(() => document.querySelectorAll("#wheelSvg circle.dot").length === 2 * state.results.length);
      const allChips = await page.locator("#dialList [data-add]").count();
      assert.ok(allChips > 0, "the dial should list colors under All colors");
      await tapEl(page, device, '#wheelShow [data-show="mine"]');
      await page.waitForFunction(() => document.querySelectorAll("#wheelSvg circle.dot").length === 12);
      const seen = await page.evaluate(() => ({
        owned: [...state.owned],
        dots: [...document.querySelectorAll("#wheelSvg circle.dot")].map(c => c.dataset.id),
        chips: [...document.querySelectorAll("#dialList [data-add]")].map(b => b.dataset.add)
      }));
      assert.ok(seen.dots.every(id => seen.owned.includes(id)), "My dyes should draw only dyes you own");
      assert.ok(seen.chips.every(id => seen.owned.includes(id)), "My dyes should list only dyes you own in Find colors that go with");

      await tapEl(page, device, '#wheelShow [data-show="all"]');
      await reopen(page);
      await showWheel(page, device);
      assert.strictEqual(await pressed(), "mine", "the filter choice must not be remembered");
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally {
      await context.close();
    }
  });
}

test("S6: the wheel hint opening phrase follows the selected filter", async () => {
  const { context, page, errors } = await openApp("computer");
  try {
    await showWheel(page, "computer");
    const rest = ", as the jar color and as it lands on your disc. Tap a dot to add that dye. Tapping between dots does nothing: only these colors exist as dyes. Grey band on the rim: colors that go muddy on this disc.";
    const lead = { mine: "The wheel shows your dyes", all: "The wheel shows every dye", picked: "The wheel shows the colors you picked" };
    for (const k of ["all", "picked", "mine"]) {
      await tapEl(page, "computer", `#wheelShow [data-show="${k}"]`);
      await page.waitForFunction(k2 => document.querySelector(`#wheelShow [data-show="${k2}"]`).getAttribute("aria-pressed") === "true", k);
      assert.strictEqual((await page.locator("#wheelHint").textContent()).replace(/\s+/g, " ").trim(), lead[k] + rest);
    }
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally {
    await context.close();
  }
});

for (const scheme of ["light", "dark"]) {
  test(`S7 (${scheme}): the published-guide dot is purple, readable, and not the tap blue`, async () => {
    const { context, page, errors } = await openApp("computer", { colorScheme: scheme });
    try {
      assert.strictEqual(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches), scheme === "dark");
      await tapEl(page, "computer", "#tabbtn-notes");
      await page.locator(".dotkey .dot.sc").waitFor({ state: "visible" });
      const dot = await page.$eval(".dotkey .dot.sc", e => getComputedStyle(e).backgroundColor);
      const tap = await tokenRgb(page, "--tap"), surface = await tokenRgb(page, "--surface");
      assert.notStrictEqual(dot, tap, "the guide dot must not be the tap blue");
      const hue = hueOf(dot);
      assert.ok(hue >= 260 && hue <= 290, `the guide dot should be purple (hue 260-290), was ${hue.toFixed(0)}`);
      assert.ok(contrast(dot, surface) >= 3, `the guide dot should show against the page, contrast ${contrast(dot, surface).toFixed(2)}`);
      assert.strictEqual(await page.$eval(".dotkey .dot.pc", e => getComputedStyle(e).backgroundColor), await tokenRgb(page, "--pop"), "the ProChem dot should stay green");
      const ai = await page.$eval(".dotkey .dot.ai", e => { const c = getComputedStyle(e); return { bg: c.backgroundColor, shadow: c.boxShadow }; });
      assert.strictEqual(ai.bg, "rgba(0, 0, 0, 0)", "the unconfirmed dot should stay hollow");
      assert.ok(ai.shadow.includes(await tokenRgb(page, "--warn")), "the unconfirmed dot should keep its orange ring");
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally {
      await context.close();
    }
  });

  test(`S8 (${scheme}): everything tappable uses the tap blue, danger stays brown-red, fields stay neutral, text is readable`, async () => {
    const { context, page, errors } = await openApp("computer", { colorScheme: scheme });
    try {
      const [tap, tapInk, tapBg, mud, line, surface] = await Promise.all(["--tap", "--tap-ink", "--tap-bg", "--mud", "--line", "--surface"].map(t => tokenRgb(page, t)));
      const got = await page.evaluate(() => {
        const c = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
        const danger = document.createElement("button");
        danger.className = "btn danger"; document.body.appendChild(danger);
        const d = { color: getComputedStyle(danger).color, border: getComputedStyle(danger).borderTopColor };
        danger.remove();
        return {
          btn: c("#cdAdd", "color"), btnBorder: c("#cdAdd", "borderTopColor"),
          primaryBg: c("#logBtn", "backgroundColor"), primaryInk: c("#logBtn", "color"),
          segOff: c('#poolSeg [aria-pressed="false"]', "color"), segOn: c('#poolSeg [aria-pressed="true"]', "backgroundColor"), segOnInk: c('#poolSeg [aria-pressed="true"]', "color"),
          tab: c("#tabbtn-notes", "color"), tabLine: c("#tabbtn-planner", "borderBottomColor"),
          summary: c("#pickFold summary", "color"), jar: c("#shelf .jar", "color"), jarBorder: c("#shelf .jar", "borderTopColor"), jump: c(".jump button", "color"),
          danger: d, select: c("#brand", "borderTopColor")
        };
      });
      assert.strictEqual(got.btn, tap, ".btn text"); assert.strictEqual(got.btnBorder, tap, ".btn border");
      assert.strictEqual(got.primaryBg, tap, "primary button fill"); assert.strictEqual(got.primaryInk, tapInk, "primary button text");
      assert.strictEqual(got.segOff, tap, "switch text"); assert.strictEqual(got.segOn, tap, "selected switch fill"); assert.strictEqual(got.segOnInk, tapInk, "selected switch text");
      assert.strictEqual(got.tab, tap, "tab text"); assert.strictEqual(got.tabLine, tap, "selected tab underline");
      assert.strictEqual(got.summary, tap, "fold title"); assert.strictEqual(got.jar, tap, "jar text"); assert.strictEqual(got.jarBorder, tap, "jar outline");
      assert.strictEqual(got.jump, tap, "jump pill text");
      assert.strictEqual(got.danger.color, mud, "danger text"); assert.strictEqual(got.danger.border, mud, "danger outline");
      assert.strictEqual(got.select, line, "dropdowns stay neutral");
      for (const [fg, bg, what] of [[tap, surface, "blue on the panel"], [tap, tapBg, "blue on the hover tint"], [tapInk, tap, "text on filled blue"]])
        assert.ok(contrast(fg, bg) >= 4.5, `${what} is too faint: ${contrast(fg, bg).toFixed(2)}`);
      assert.deepStrictEqual(errors, [], "the page reported script errors");
    } finally {
      await context.close();
    }
  });
}

/* The left column scrolls with the page on computers, as on phones: a pinned column is taller than a
   laptop window with the wheel showing and would hide the chips and "Log this dye job". */
test("S9 (laptop): the Log button can be reached in the middle of the dye cards with the wheel and its list open", async () => {
  const { context, page, errors } = await openApp("laptop");
  try {
    await tapEl(page, "laptop", '#viewSeg [data-view="wheel"]');
    await page.locator("#wheelBox").waitFor({ state: "visible" });
    await tapEl(page, "laptop", "#dialFold > summary");
    await page.waitForFunction(() => document.querySelector("#dialFold").open);
    const r = await page.evaluate(() => {
      const log = document.querySelector("#logBtn"), y = log.getBoundingClientRect().top + scrollY;
      window.scrollTo(0, y - innerHeight / 2);
      const b = log.getBoundingClientRect(), more = document.documentElement.scrollHeight - (scrollY + innerHeight);
      return { inView: b.top >= 0 && b.bottom <= innerHeight, cardsBelow: more };
    });
    assert.ok(r.inView, "Log this dye job should come into view by scrolling the page");
    assert.ok(r.cardsBelow > 300, "it should be reachable before the end of the dye cards");
    assert.deepStrictEqual(errors, [], "the page reported script errors");
  } finally {
    await context.close();
  }
});
