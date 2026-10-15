import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";
import { eventually } from "../../harness/wait.mjs";
async function click(cdp, label) {
  await cdp.wait(
    `Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return !b.disabled && (b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}||(b.querySelector('[data-testid=\"ui.row.title\"]')&&b.querySelector('[data-testid=\"ui.row.title\"]').textContent===${JSON.stringify(label)}))})`,
  );
  await cdp.evaluate(
    `(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(b){return b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}||(b.querySelector('[data-testid=\"ui.row.title\"]')&&b.querySelector('[data-testid=\"ui.row.title\"]').textContent===${JSON.stringify(label)})}).pop();if(!b)throw Error('Missing button: '+${JSON.stringify(label)});b.click()})()`,
  );
}
async function fill(cdp, label, value) {
  if (label === "下载到书单") {
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
async function unlock(cdp) {
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
async function close(cdp) {
  await cdp.evaluate(
    "Array.prototype.slice.call(document.querySelectorAll('[aria-label=关闭]')).pop().click()",
  );
  await cdp.wait("!document.querySelector('[role=dialog]')");
}
async function capture(cdp, name, state, theme) {
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
    );
    await cdp.screenshot(
      path.join(
        SCREENSHOTS,
        `${name}-netbooks-${theme}-${state}-${width}x${height}.png`,
      ),
    );
  }
}
export async function netbooksSuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser,
    name = legacy ? "chrome70" : "current";
  let wire;
  try {
    wire = await connectChat(server.url, "123456");
    const collection = (
      await wire.call("library.collection.create", { title: "网络小说" })
    ).data.id;
    await cdp.navigate(`${server.url}/`);
    await unlock(cdp);
    await click(cdp, "阅读");
    for (const theme of ["light", "dark"]) {
      await click(cdp, "设置");
      await cdp.wait(
        "!!document.querySelector('[role=group][aria-label=主题]')",
      );
      await cdp.evaluate(
        `Array.prototype.slice.call(document.querySelector('[role=group][aria-label=主题]').querySelectorAll('button')).find(function(b){return b.textContent.trim()===${JSON.stringify(theme === "light" ? "浅色" : "深色")}}).click()`,
      );
      await close(cdp);
      await click(cdp, "网络书籍");
      await capture(cdp, name, "search", theme);
      await fill(cdp, "书名或作者", "星河漫游");
      await fill(cdp, "下载到书单", collection);
      await click(cdp, "搜索");
      await cdp.wait(
        "document.querySelector('[role=dialog]').textContent.indexOf('测试作者')>=0",
      );
      await capture(cdp, name, "results", theme);
      if (theme === "light") {
        // The server-reported search cooldown is shown as a countdown and blocks a repeat search.
        await cdp.wait(
          "/\\d+ 秒/.test(document.querySelector('[role=dialog]').textContent)",
        );
        assert.equal(
          await cdp.evaluate(
            "Array.prototype.slice.call(document.querySelectorAll('[role=dialog] button[aria-label=搜索]')).every(function(b){return b.disabled})",
          ),
          true,
          "search is disabled during the cooldown",
        );
        await cdp.wait(
          "!/\\d+ 秒/.test(document.querySelector('[role=dialog]').textContent) && !document.querySelector('[role=dialog] button[aria-label=搜索]').disabled",
        );
      }
      if (theme === "light") {
        await click(cdp, "下载 星河漫游");
        await cdp.wait("document.body.textContent.indexOf('下载已开始')>=0");
        const joined = (
          await wire.call("netbooks.download", { book: "10001", collection })
        ).data;
        assert.equal(joined.joined, true);
        await click(cdp, "查看任务");
        await cdp.wait("document.body.textContent.indexOf('下载 星河漫游')>=0");
        await capture(cdp, name, "progress", theme);
        await eventually(
          () => {
            const db = new DatabaseSync(path.join(server.data, "talos.db"), {
              readOnly: true,
            });
            try {
              return db
                .prepare(
                  "SELECT count(*) AS n FROM netbooks_chapters WHERE job=?",
                )
                .get(joined.job).n;
            } finally {
              db.close();
            }
          },
          (n) => n > 0,
          "chapter checkpoint",
        );
        wire.close();
        wire = undefined;
        await server.stop();
        await server.start();
        wire = await connectChat(server.url, "123456");
        const doc = await eventually(
          () => {
            const db = new DatabaseSync(path.join(server.data, "talos.db"), {
              readOnly: true,
            });
            try {
              return db
                .prepare("SELECT document FROM netbooks_downloads WHERE job=?")
                .get(joined.job)?.document;
            } finally {
              db.close();
            }
          },
          (v) => !!v,
          "resumed document",
          30000,
        );
        const opened = await eventually(
          async () => {
            try {
              return (await wire.call("library.doc.open", { doc })).data;
            } catch {
              return null;
            }
          },
          (v) => !!v,
          "novel conversion",
        );
        assert.equal(opened.document.title, "星河漫游");
        await cdp.wait("document.body.textContent.indexOf('已完成')>=0");
        await close(cdp);
        await click(cdp, "星河漫游");
        await cdp.wait(
          "document.body.textContent.indexOf('少年开始了旅程')>=0",
        );
      } else await close(cdp);
    }
    await click(cdp, "网络书籍");
    await cdp.offline(true);
    await cdp.wait(
      "document.querySelector('[role=dialog]').textContent.indexOf('离线')>=0",
    );
    assert.equal(
      await cdp.evaluate(
        "Array.prototype.slice.call(document.querySelector('[role=dialog]').querySelectorAll('button')).some(function(b){return (b.getAttribute('aria-label')==='搜索')&&b.matches(':disabled')})",
      ),
      true,
    );
    await capture(cdp, name, "offline", "dark");
    await cdp.offline(false);
    await close(cdp);
    console.log(
      `${name}: netbooks search, download, dedupe, checkpoint restart, tasks, reader and offline passed`,
    );
  } finally {
    await cdp.offline(false);
    wire?.close();
  }
}
