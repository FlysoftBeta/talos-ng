import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "./artifacts.mjs";

const text = "document.body.textContent";
const app = "!!document.querySelector('[data-testid=\"app.ready\"]')";
const locked =
  '!!document.querySelector(\'[data-testid="auth.lock"], [data-testid="auth.concealed"]\')';

async function click(cdp, label) {
  if (
    label === "设置" &&
    (await cdp.evaluate(
      "Array.prototype.slice.call(document.querySelectorAll('[role=dialog] h2')).some(function(h){return h.textContent==='设置';})",
    ))
  )
    return;
  await cdp.evaluate(
    `(function(){var buttons=Array.prototype.slice.call(document.querySelectorAll('button'));var button=buttons.find(function(b){return b.getAttribute('aria-label')===${JSON.stringify(label)} || b.textContent.trim()===${JSON.stringify(label)};});if(!button)throw new Error('Missing button '+${JSON.stringify(label)});button.scrollIntoView({block:'nearest',inline:'nearest'});button.click();})()`,
  );
}
/** Rail navigation: the app lands on 最近, so scenarios open the area they test explicitly. */
async function openArea(cdp, label) {
  await click(cdp, label);
  await cdp.wait(
    `!!Array.prototype.slice.call(document.querySelectorAll('button[aria-current]')).find(function(b){return b.getAttribute('aria-label')===${JSON.stringify(label)} || b.textContent.trim()===${JSON.stringify(label)};})`,
  );
}
async function reveal(cdp, touch = false) {
  if (
    !(await cdp.evaluate(
      "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
    ))
  )
    return;
  const keys = [
    "ArrowUp",
    "ArrowUp",
    "ArrowDown",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowLeft",
    "ArrowRight",
  ];
  for (const key of keys) {
    if (touch) {
      const point = await cdp.evaluate(
        `({x:innerWidth*${key === "ArrowLeft" ? 0.1 : key === "ArrowRight" ? 0.9 : 0.5}, y:innerHeight*${key === "ArrowUp" ? 0.1 : key === "ArrowDown" ? 0.9 : 0.5}})`,
      );
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
    }
  }
  await cdp.wait("!document.querySelector('[data-testid=\"auth.concealed\"]')");
}
async function pin(cdp, value) {
  await reveal(cdp);
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.numpad\"] button')",
  );
  for (const digit of value) await click(cdp, digit);
}
async function select(cdp, label, value) {
  const labels = {
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
    normal: "标准",
    large: "大字",
    0: "关闭",
    1: "1 分钟",
    5: "5 分钟",
    15: "15 分钟",
  };
  await cdp.evaluate(
    `(function(){var group=Array.prototype.slice.call(document.querySelectorAll('[role=group]')).find(function(e){return e.getAttribute('aria-label')===${JSON.stringify(label)};});if(!group)throw new Error('Missing choice '+${JSON.stringify(label)});var button=Array.prototype.slice.call(group.querySelectorAll('button')).find(function(e){return e.textContent.trim()===${JSON.stringify(labels[value] || value)};});if(!button)throw new Error('Missing option '+${JSON.stringify(value)});button.scrollIntoView({block:'nearest',inline:'nearest'});button.click();})()`,
  );
}
async function closeSheet(cdp) {
  await cdp.evaluate(
    "Array.prototype.slice.call(document.querySelectorAll('[role=dialog]')).pop().querySelector('button[aria-label=关闭]').click()",
  );
  await cdp.wait("!document.querySelector('[role=dialog]')");
}
async function connected(cdp) {
  await cdp.wait(`${text}.indexOf('已连接')>=0`);
}
async function captures(cdp, browserName, theme, state, waitForFrame = true) {
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
      "document.fonts ? document.fonts.ready.then(function(){return true;}) : true",
    );
    if (waitForFrame)
      await cdp.evaluate(
        "new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});})",
      );
    assert.equal(
      await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth"),
      true,
      `${state}: no horizontal overflow`,
    );
    await cdp.screenshot(
      path.join(
        SCREENSHOTS,
        `${browserName}-app-${theme}-${state}-${width}x${height}.png`,
      ),
    );
  }
}

/** All business mutations use production controls; only the failure case corrupts durable input. */

export {
  text,
  app,
  locked,
  click,
  openArea,
  pin,
  reveal,
  select,
  captures,
  closeSheet,
  connected,
};
