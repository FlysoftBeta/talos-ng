import assert from "node:assert/strict";

export async function wheelAt(cdp, point, deltaY) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...point,
    deltaX: 0,
    deltaY,
  });
}

/**
 * Chrome 70's CDP wheel path scales deltas. Measure the engine on a plain native
 * scroll box, independent of the virtual scroller's sizes, geometry and position.
 */
export async function nativeMovement(cdp, input) {
  await cdp.evaluate(`(function(){
    var box=document.createElement('div'); box.id='native-scroll';
    box.style.cssText='position:fixed;left:400px;top:0;width:360px;height:480px;overflow:scroll;overflow-anchor:none';
    var content=document.createElement('div');content.style.height='100000px';
    box.appendChild(content);document.body.appendChild(box);box.scrollTop=50000;
  })()`);
  await cdp.evaluate(
    "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})",
  );
  try {
    await input({ x: 580, y: 240 });
    await cdp.evaluate(`new Promise(function(resolve){var last=-1,n=0;
      (function frame(){var t=document.getElementById('native-scroll').scrollTop;
        n=t===last?n+1:0;last=t;if(n>=10)resolve();else requestAnimationFrame(frame);})();})`);
    return await cdp.evaluate(
      "document.getElementById('native-scroll').scrollTop-50000",
    );
  } finally {
    await cdp.evaluate("document.getElementById('native-scroll').remove()");
  }
}

async function drag(cdp, point) {
  const send = (type, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: point.x, y, id: 0 }],
    });
  await send("touchStart", point.y);
  for (let i = 1; i <= 8; i++) {
    await send("touchMove", point.y + i * 16);
    await cdp.evaluate(
      "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})",
    );
  }
  // Stop the finger before lifting, so this checks dragging rather than variable inertia.
  await cdp.evaluate("new Promise(function(r){setTimeout(r,200)})");
  await send("touchEnd", point.y + 128);
}

function assertMotion(samples, before, movement, label) {
  assert.ok(samples.length >= 4, `${label}: sampled every frame`);
  let last = before;
  const sign = Math.sign(-movement);
  for (const sample of samples) {
    assert.ok(sample.covered, `${label}: blank band`);
    assert.notEqual(sample.top, null, `${label}: reference disappeared`);
    // A native scroll may spread its movement over frames. Content must stay inside
    // that independently measured interval and may never jump against the gesture.
    assert.ok(
      (sample.top - last) * sign >= -1,
      `${label}: reversed by ${sample.top - last}px`,
    );
    assert.ok(
      (sample.top - before) * sign >= -1 &&
        (sample.top - before) * sign <= Math.abs(movement) + 1.5,
      `${label}: frame outside native movement: ${sample.top - before} vs ${-movement}`,
    );
    last = sample.top;
  }
  assert.ok(
    Math.abs(last - before + movement) < 1.5,
    `${label}: moved ${last - before}, native ${-movement}`,
  );
}

export async function movingSuite(cdp, center) {
  const ref = await cdp.evaluate("__v.ref()");
  const watch = async () => {
    await cdp.evaluate(`(function(){window.__motion=[];window.__moving=true;
      (function frame(){if(!window.__moving)return;__motion.push({top:__v.top(${JSON.stringify(ref)}),covered:__v.covered()});requestAnimationFrame(frame);})();})()`);
  };
  const stop = () => cdp.evaluate("window.__moving=false;window.__motion");
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  try {
    const movement = await nativeMovement(cdp, (point) => drag(cdp, point));
    assert.ok(movement < -40, "native touch gesture scrolls");
    const before = await cdp.evaluate(`__v.top(${JSON.stringify(ref)})`);
    await watch();
    await drag(cdp, await center());
    await cdp.evaluate("__v.settled()");
    assertMotion(await stop(), before, movement, "touch drag");
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }

  // Keep a measured item just above the viewport animating while real wheel input
  // crosses it. Sample rendered coordinates every frame, including delayed page replies.
  const animated = await cdp.evaluate(
    "(function(){return document.querySelector('[data-bench-item]').getAttribute('data-bench-item')})()",
  );
  const expected = await nativeMovement(cdp, (point) =>
    wheelAt(cdp, point, -120),
  );
  const before = await cdp.evaluate(`__v.top(${JSON.stringify(ref)})`);
  await watch();
  await cdp.evaluate(
    `void __bench.resize(${JSON.stringify(animated)}, 300, 60)`,
  );
  await wheelAt(cdp, await center(), -120);
  await cdp.evaluate("new Promise(function(r){setTimeout(r,1100)})");
  await cdp.evaluate("__v.settled()");
  assertMotion(await stop(), before, expected, "wheel during animation");
}
