import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { eventually } from "../../harness/wait.mjs";

export const text = "document.body.textContent";
export async function click(cdp, label) {
  await cdp.wait(
    `Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return !b.disabled && (b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}||(b.querySelector('[data-testid=\"ui.row.title\"]')&&b.querySelector('[data-testid=\"ui.row.title\"]').textContent===${JSON.stringify(label)}))})`,
  );
  await cdp.evaluate(
    `(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(b){return b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}||(b.querySelector('[data-testid=\"ui.row.title\"]')&&b.querySelector('[data-testid=\"ui.row.title\"]').textContent===${JSON.stringify(label)})}).pop();if(!b)throw Error('Missing button: '+${JSON.stringify(label)});b.click()})()`,
  );
}
export async function fill(cdp, label, value) {
  if (label === "保留时长" || label === "文档" || label === "目标书单") {
    await cdp.evaluate(
      `(function(){var trigger=Array.prototype.slice.call(document.querySelectorAll('button[aria-haspopup=listbox]')).find(function(b){var l=document.getElementById(b.getAttribute('aria-labelledby').split(' ')[0]);return l&&l.textContent===${JSON.stringify(label)}});if(!trigger)throw Error('Missing picker '+${JSON.stringify(label)});trigger.click()})()`,
    );
    await cdp.wait("!!document.querySelector('[role=listbox] [role=option]')");
    await cdp.evaluate(
      `(function(){var trigger=Array.prototype.slice.call(document.querySelectorAll('button[aria-haspopup=listbox]')).find(function(b){var l=document.getElementById(b.getAttribute('aria-labelledby').split(' ')[0]);return l&&l.textContent===${JSON.stringify(label)}});if(!trigger)throw Error('Missing picker '+${JSON.stringify(label)});var box=document.querySelector('[role=listbox][aria-labelledby=\"'+trigger.getAttribute('aria-labelledby').split(' ')[0]+'\"]');var option=Array.prototype.slice.call(box.querySelectorAll('[role=option]')).find(function(e){return e.getAttribute('data-value')===${JSON.stringify(String(value))}});if(!option)throw Error('Missing option');option.click()})()`,
    );
    return;
  }
  await cdp.evaluate(
    `(function(){var labels=Array.prototype.slice.call(document.querySelectorAll('label'));var l=labels.find(function(l){return l.textContent.indexOf(${JSON.stringify(label)})>=0});var e=l&&(l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,textarea,select'));if(!e)e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');if(!e)throw Error('Missing field '+${JSON.stringify(label)});var setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
}
export async function unlock(cdp) {
  await cdp.wait(
    '!!document.querySelector(\'[data-testid="auth.concealed"],[data-testid="auth.numpad"] button\')',
  );
  if (
    await cdp.evaluate(
      "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
    )
  ) {
    for (const key of [
      "ArrowUp",
      "ArrowUp",
      "ArrowDown",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowLeft",
      "ArrowRight",
    ]) {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
    }
  }
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.numpad\"] button')",
  );
  for (const n of "123456") await click(cdp, n);
  await cdp.wait("!!document.querySelector('[data-testid=\"app.ready\"]')");
}
export async function captures(cdp, name, state) {
  for (const theme of ["浅色", "深色"]) {
    await click(cdp, "设置");
    await cdp.wait("!!document.querySelector('[role=group][aria-label=主题]')");
    await cdp.evaluate(
      `(function(){var g=document.querySelector('[role=group][aria-label=主题]');Array.prototype.slice.call(g.querySelectorAll('button')).find(function(b){return b.textContent.trim()===${JSON.stringify(theme)}}).click()})()`,
    );
    await close(cdp);
    for (const [width, height] of [
      [1280, 800],
      [768, 1024],
    ]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.evaluate(
        "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})",
      );
      assert.equal(
        await cdp.evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
        `${state} overflow`,
      );
      await cdp.screenshot(
        path.join(
          SCREENSHOTS,
          `${name}-library-${theme === "浅色" ? "light" : "dark"}-${state}-${width}x${height}.png`,
        ),
      );
    }
  }
}
export async function close(cdp) {
  await cdp.evaluate(
    "Array.prototype.slice.call(document.querySelectorAll('[role=dialog]')).pop().querySelector('button[aria-label=关闭]').click()",
  );
}
export async function upload(wire, bytes, title, name) {
  const { id } = (
    await wire.call("upload.begin", { kind: "document", size: bytes.length })
  ).data;
  for (let offset = 0; offset < bytes.length; offset += 256 * 1024)
    await wire.call(
      "upload.append",
      { id, offset },
      bytes.subarray(offset, offset + 256 * 1024),
    );
  await wire.call("upload.commit", { id });
  return (
    await wire.call("library.doc.importFile", { title, name, upload: id })
  ).data;
}
export async function ready(wire, doc) {
  return eventually(
    async () => {
      try {
        return (await wire.call("library.doc.open", { doc })).data;
      } catch {
        return undefined;
      }
    },
    (value) => !!value,
    "converted document",
    120_000,
  );
}
