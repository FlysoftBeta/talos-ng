import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { eventually } from "../../harness/wait.mjs";
import { openArea } from "../../harness/ui.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";

async function button(cdp, label) {
  await cdp.evaluate(
    `(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button')).find(function(n){return (n.querySelector('[data-testid="ui.row.title"]') && n.querySelector('[data-testid="ui.row.title"]').textContent.trim()===${JSON.stringify(label)}) || n.textContent.trim()===${JSON.stringify(label)} || n.getAttribute('aria-label')===${JSON.stringify(label)};});if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.click();})()`,
  );
}
async function login(cdp) {
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
  );
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
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.numpad\"] button')",
  );
  for (const digit of "654321") await button(cdp, digit);
  await cdp.wait("!!document.querySelector('[data-testid=\"app.ready\"]')");
}
const id = (n) => "000000000000000000" + String(n).padStart(8, "0");
/** Actual Chromium 70: unread opening, both history directions, send and offline restart. */
export async function chatLegacySuite(browser, server) {
  const root = await connectChat(server.url, "123456");
  const user = await connectChat(server.url, "654321");
  const { cdp } = browser;
  const errors = [];
  cdp.on("Runtime.exceptionThrown", (event) =>
    errors.push(event.exceptionDetails),
  );
  await cdp.send("Runtime.enable");
  try {
    const group = (
      await root.call("community.group.create", {
        name: "兼容性对话",
        handle: "chrome70-chat",
        discoverable: true,
      })
    ).data;
    await user.call("community.group.join", {
      group: group.id,
      source: { type: "search" },
    });
    for (let n = 1; n <= 500; n++)
      await root.call("chat.post.send", {
        id: id(n),
        conversation: group.id,
        kind: "text",
        text: `历史消息 ${n} · 平板上的中文交流与阅读`,
      });
    await user.call("chat.state.read", { conversation: group.id, seq: 250 });
    await cdp.navigate(`${server.url}/`);
    await login(cdp);
    await cdp.wait("document.body.textContent.indexOf('已连接')>=0");
    await cdp.wait(
      "!!window.__talosShell && !!navigator.serviceWorker.controller",
    );
    await eventually(
      () => cdp.evaluate("window.__talosShell.status()"),
      (v) => !!v.active,
      "chat offline shell installed",
    );
    await openArea(cdp, "对话");
    await button(cdp, "兼容性对话");
    await cdp.wait("!!document.querySelector('[data-seq=\"251\"]')");
    assert.ok(
      await cdp.evaluate(
        "document.querySelectorAll('[data-seq]').length < 100",
      ),
      "history stays virtualized",
    );
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"ui.virtual-list\"]').scrollTop=0",
    );
    await cdp.wait("!!document.querySelector('[data-seq]')");
    await cdp.wait("!!document.querySelector('[aria-label=\"跳到最新消息\"]')");
    await button(cdp, "跳到最新消息");
    await cdp.wait("!!document.querySelector('[data-seq=\"500\"]')");
    await cdp.evaluate(
      "(function(){var e=document.querySelector('[data-testid=\"chat.composer.input\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'旧版浏览器发送成功');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await button(cdp, "发送");
    await eventually(
      async () =>
        (
          await user.call("chat.post.page", {
            conversation: group.id,
            direction: "latest",
          })
        ).data.posts.some((p) => p.preview === "旧版浏览器发送成功"),
      Boolean,
      "Chrome 70 sent post",
    );
    await cdp.wait(
      "document.body.textContent.indexOf('旧版浏览器发送成功')>=0",
    );
    for (const theme of ["light", "dark"]) {
      const op = id(theme === "light" ? 900 : 901);
      await user.call("me.setting.set", {
        key: "theme",
        value: { v: theme, t: { ms: Date.now(), counter: 0 }, op },
      });
      await cdp.wait(`!!document.querySelector('[data-theme="${theme}"]')`);
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
          "new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});})",
        );
        assert.equal(
          await cdp.evaluate(
            "document.documentElement.scrollWidth<=innerWidth",
          ),
          true,
        );
        await cdp.screenshot(
          path.join(
            SCREENSHOTS,
            `chrome70-chat-${theme}-conversation-${width}x${height}.png`,
          ),
        );
      }
    }
    await cdp.offline(true);
    await cdp.wait("document.body.textContent.indexOf('离线')>=0");
    assert.ok(
      await cdp.evaluate(
        "document.body.textContent.indexOf('旧版浏览器发送成功')>=0",
      ),
    );
    await cdp.navigate(`${server.url}/`);
    await login(cdp);
    await button(cdp, "兼容性对话");
    await cdp.wait(
      "document.body.textContent.indexOf('旧版浏览器发送成功')>=0",
    );
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
      await cdp.screenshot(
        path.join(
          SCREENSHOTS,
          `chrome70-chat-dark-offline-${width}x${height}.png`,
        ),
      );
    }
    assert.deepEqual(errors, [], "Chromium 70 chat has no runtime exceptions");
    console.log(
      "Chromium 70 chat: 500 posts, unread opening, virtual history, send, offline restart (5 cases) passed.",
    );
  } finally {
    await cdp.offline(false);
    root.close();
    user.close();
  }
}
