import assert from "node:assert/strict";

/**
 * Drives the gallery bench with real input (CDP mouse wheel) and checks what is on screen:
 * every wheel step moves the content by exactly its delta while older items load and are
 * measured above it, nothing moves between frames without input, size animations never
 * move the first visible item, a sticky list keeps its end, and the viewport never shows
 * a blank band.
 */
const HELPERS = `(function(){
  var list = function(){ return document.querySelector('[data-testid="ui.virtual-list"]'); };
  var item = function(id){ return document.querySelector('[data-bench-item="' + id + '"]'); };
  window.__v = {
    list: list,
    top: function(id){ var e = item(id); return e ? e.getBoundingClientRect().top - list().getBoundingClientRect().top - list().clientTop : null; },
    bottom: function(id){ var e = item(id); return e ? e.getBoundingClientRect().bottom - list().getBoundingClientRect().top - list().clientTop : null; },
    ref: function(){ return window.__bench.scroller.position().id; },
    /** Resolves once the scroll offset held still for 8 frames, 120 ms apart twice (late replies). */
    settled: function(){
      function still(){ return new Promise(function(resolve){ var last = -1, n = 0;
        (function frame(){ var t = list().scrollTop; n = t === last ? n + 1 : 0; last = t;
          if (n >= 8) resolve(); else requestAnimationFrame(frame); })(); }); }
      return still().then(function(){ return new Promise(function(r){ setTimeout(r, 120); }); }).then(still);
    },
    /** Samples an edge of an item every frame; stop() gives the largest drift in px. */
    watch: function(id, edge){
      var read = edge === 'bottom' ? window.__v.bottom : window.__v.top;
      var first = read(id), worst = 0, run = true, missing = 0;
      (function frame(){ if (!run) return; var v = read(id);
        if (v === null) missing++; else worst = Math.max(worst, Math.abs(v - first));
        requestAnimationFrame(frame); })();
      return { stop: function(){ run = false; return { worst: worst, missing: missing }; } };
    },
    /** Every probed row of the viewport shows an item or an edge slot. */
    covered: function(){ var r = list().getBoundingClientRect();
      for (var y = r.top + 2; y < r.bottom - 1; y += 24) {
        var e = document.elementFromPoint(r.left + 40, y);
        if (!e || !e.closest('[data-bench-item],[data-virtual-edge]')) return false; }
      return true; }
  };
})()`;
export async function virtualSuite(cdp, server) {
  const open = async (query) => {
    await cdp.navigate(`${server.url}/gallery.html?virtual${query}`);
    await cdp.wait(
      "!!window.__bench && window.__bench.scroller.getSnapshot().status === 'ready' && !!document.querySelector('[data-bench-item]')",
    );
    await cdp.evaluate(HELPERS);
    await cdp.evaluate("__v.settled()");
  };
  const center = async () =>
    cdp.evaluate(
      "(function(){var r=__v.list().getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()",
    );
  const wheel = async (deltaY) => {
    const { x, y } = await center();
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY,
    });
  };

  // 1. Wheel upwards through asynchronously prepended, unmeasured items.
  await open("");
  assert.equal(await cdp.evaluate("__v.top('v1000')"), 0, "opens on its target");
  let prepended = 0;
  for (let step = 0; step < 30; step++) {
    const ref = await cdp.evaluate("__v.ref()");
    const before = await cdp.evaluate(`__v.top(${JSON.stringify(ref)})`);
    const count = await cdp.evaluate("__bench.scroller.getSnapshot().count");
    await wheel(-200);
    await cdp.evaluate("__v.settled()");
    // Late replies land and get measured while nothing scrolls: no frame may move.
    const watch = await cdp.evaluate(
      `(window.__w = __v.watch(${JSON.stringify(ref)}), true)`,
    );
    assert.ok(watch);
    await cdp.evaluate("new Promise(function(r){setTimeout(r,250)})");
    const still = await cdp.evaluate("__w.stop()");
    assert.ok(still.worst < 1, `step ${step}: content moved ${still.worst}px without input`);
    const after = await cdp.evaluate(`__v.top(${JSON.stringify(ref)})`);
    assert.ok(
      Math.abs(after - before - 200) < 1.5,
      `step ${step}: a 200 px wheel moved ${ref} by ${after - before} px`,
    );
    assert.ok(await cdp.evaluate("__v.covered()"), `step ${step}: blank band`);
    prepended += (await cdp.evaluate("__bench.scroller.getSnapshot().count")) - count;
  }
  assert.ok(prepended > 30, `older pages were loaded (${prepended} items)`);
  // And back down past the opening point.
  for (let step = 0; step < 40; step++) {
    const ref = await cdp.evaluate("__v.ref()");
    const before = await cdp.evaluate(`__v.top(${JSON.stringify(ref)})`);
    await wheel(250);
    await cdp.evaluate("__v.settled()");
    const after = await cdp.evaluate(`__v.top(${JSON.stringify(ref)})`);
    if (after !== null)
      assert.ok(
        Math.abs(before - after - 250) < 1.5,
        `down step ${step}: moved ${before - after} px`,
      );
    assert.ok(await cdp.evaluate("__v.covered()"), `down ${step}: blank band`);
  }

  // 2. Size animations above, at and below the first visible item.
  await cdp.evaluate("__v.settled()");
  const ref = await cdp.evaluate("__v.ref()");
  const ids = await cdp.evaluate("__bench.scroller.ids()");
  const at = ids.indexOf(ref);
  const offset = await cdp.evaluate(`__v.top(${JSON.stringify(ref)})`);
  for (const [target, size] of [
    [ids[at - 1], 320],
    [ids[at - 1], 40],
    [ids[at + 2], 300],
  ]) {
    await cdp.evaluate(`(window.__w = __v.watch(${JSON.stringify(ref)}), true)`);
    await cdp.evaluate(`__bench.resize(${JSON.stringify(target)}, ${size})`);
    await cdp.evaluate("__v.settled()");
    const drift = await cdp.evaluate("__w.stop()");
    assert.ok(drift.worst < 1, `animating ${target} moved ${ref} by ${drift.worst}px`);
  }
  const next = ids[at + 1];
  const nextTop = await cdp.evaluate(`__v.top(${JSON.stringify(next)})`);
  const height = await cdp.evaluate(
    `document.querySelector('[data-bench-item="${ref}"]').getBoundingClientRect().height`,
  );
  await cdp.evaluate(`(window.__w = __v.watch(${JSON.stringify(ref)}), true)`);
  await cdp.evaluate(`__bench.resize(${JSON.stringify(ref)}, ${height + 150})`);
  await cdp.evaluate("__v.settled()");
  assert.ok((await cdp.evaluate("__w.stop()")).worst < 1, "the growing anchor keeps its top");
  assert.ok(
    Math.abs((await cdp.evaluate(`__v.top(${JSON.stringify(next)})`)) - nextTop - 150) < 1,
    "only the items below the anchor move",
  );
  assert.ok(Math.abs((await cdp.evaluate(`__v.top(${JSON.stringify(ref)})`)) - offset) < 1);

  // 3. Jumping to an item that is not loaded places it at the top.
  await cdp.evaluate("__bench.scroller.jump({ id: 'v1800' })");
  await cdp.evaluate("__v.settled()");
  assert.ok(Math.abs(await cdp.evaluate("__v.top('v1800')")) < 1, "jump target at top");
  assert.ok(await cdp.evaluate("__v.covered()"), "jump: blank band");

  // 4. A list that follows its end.
  await open("&end");
  const last = () => cdp.evaluate("__bench.scroller.ids().slice(-1)[0]");
  const bottomGap = async () =>
    cdp.evaluate(
      `__v.list().clientHeight - __v.bottom(${JSON.stringify(await last())})`,
    );
  assert.ok(Math.abs(await bottomGap()) < 1, "opens at the end");
  await cdp.evaluate("__bench.append(3)");
  await cdp.evaluate("__v.settled()");
  assert.equal(await last(), "v2002");
  assert.ok(Math.abs(await bottomGap()) < 1, "follows appended items");
  await cdp.evaluate(`(window.__w = __v.watch('v2002', 'bottom'), true)`);
  await cdp.evaluate("__bench.resize('v2002', 360)");
  await cdp.evaluate("__v.settled()");
  assert.ok((await cdp.evaluate("__w.stop()")).worst < 1, "a growing last item keeps the end");
  await wheel(-300);
  await cdp.evaluate("__v.settled()");
  const kept = await cdp.evaluate("__v.ref()");
  const keptTop = await cdp.evaluate(`__v.top(${JSON.stringify(kept)})`);
  await cdp.evaluate("__bench.append(2)");
  await cdp.evaluate("__v.settled()");
  assert.ok(
    Math.abs((await cdp.evaluate(`__v.top(${JSON.stringify(kept)})`)) - keptTop) < 1,
    "scrolled away from the end, new items do not move the view",
  );
}
