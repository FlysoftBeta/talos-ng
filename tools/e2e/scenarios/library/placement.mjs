import assert from "node:assert/strict";
import { click } from "../../harness/ui.mjs";

const frames = (cdp) =>
  cdp.evaluate(
    "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})",
  );

/** PDF page input and zoom use stable unit ids, including after a saved placement. */
export async function pagePlacement(cdp) {
  await cdp.evaluate(
    "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop=150",
  );
  await frames(cdp);
  const read = () =>
    cdp.evaluate(
      `(function(){var s=document.querySelector('[data-testid="reader.scroll"]'),p=document.querySelector('[data-reader-unit="0"]');return {offset:s.getBoundingClientRect().top+s.clientTop-p.getBoundingClientRect().top,height:p.getBoundingClientRect().height}})()`,
    );
  const before = await read();
  await click(cdp, "放大");
  await frames(cdp);
  const after = await read();
  assert.ok(after.height > before.height, "PDF zoom increases the page size");
  assert.ok(
    Math.abs(after.offset - (before.offset * after.height) / before.height) < 2,
    "PDF zoom retains relative position within the page",
  );
  await cdp.evaluate(
    `(function(){var input=document.querySelector('[aria-label="跳转页码"]');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));input.blur()})()`,
  );
  await frames(cdp);
  assert.equal(
    await cdp.evaluate("document.querySelector('[aria-label=跳转页码]').value"),
    "2",
    "page input reports the jump target",
  );
  assert.ok(
    Math.abs(
      await cdp.evaluate(
        `(function(){var s=document.querySelector('[data-testid="reader.scroll"]'),p=document.querySelector('[data-reader-unit="1"]');return p.getBoundingClientRect().top-s.getBoundingClientRect().top-s.clientTop})()`,
      ),
    ) < 2,
    "second page lands at the viewport top",
  );
  await click(cdp, "适合宽度");
  await cdp.evaluate(
    "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop=0",
  );
  await frames(cdp);
}
