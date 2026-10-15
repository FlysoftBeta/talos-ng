import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";

/** Real sharing picker: the entire list is reachable above the card/sheet body. */
export async function sharingPicker(cdp, browserName) {
  const point = await cdp.evaluate(
    `(function(){var b=document.querySelector('[role=dialog] button[aria-haspopup=listbox]');var r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      button: "left",
      clickCount: 1,
      ...point,
    });
  await cdp.wait(
    "document.querySelector('[role=listbox]') && getComputedStyle(document.querySelector('[role=listbox]')).visibility === 'visible'",
  );
  assert.equal(
    await cdp.evaluate(
      `(function(){var e=document.querySelector('[role=listbox]'),r=e.getBoundingClientRect();return r.left>=8&&r.top>=8&&r.right<=innerWidth-8&&r.bottom<=innerHeight-8&&[r.top+6,r.bottom-6].every(function(y){return e.contains(document.elementFromPoint(r.left+12,y));})&&e.contains(document.activeElement);})()`,
    ),
    true,
    "sharing list is unclipped, hit-testable, in viewport and focused inside its sheet",
  );
  await cdp.screenshot(
    path.join(SCREENSHOTS, `${browserName}-library-sharing-picker.png`),
  );
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.wait("!document.querySelector('[role=listbox]')");
  assert.equal(
    await cdp.evaluate(
      "!!document.querySelector('[role=dialog]') && document.activeElement.getAttribute('aria-haspopup')==='listbox'",
    ),
    true,
    "Escape preserves sharing sheet and restores picker trigger",
  );
}
