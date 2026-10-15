import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { eventually } from "../../harness/wait.mjs";

export async function smokeSuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser;
  const origin = server.url;
  const external = [];
  cdp.on?.("Network.requestWillBeSent", (event) => {
    if (
      /^https?:/.test(event.request.url) &&
      new URL(event.request.url).origin !== origin
    )
      external.push(event.request.url);
  });
  for (const [width, height] of [
    [1280, 800],
    [768, 1024],
    [600, 900],
  ]) {
    for (const theme of ["light", "dark"]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.navigate(`${origin}/gallery.html?theme=${theme}`);
      await cdp.wait(`!!document.querySelector('[data-testid="dev.gallery"]')`);
      await cdp.evaluate(
        "document.fonts ? document.fonts.ready.then(function(){return true;}) : true",
      );
      await cdp.evaluate(
        "new Promise(function(resolve){ requestAnimationFrame(function(){requestAnimationFrame(resolve);}); })",
      );
      await cdp.screenshot(
        path.join(
          SCREENSHOTS,
          `${legacy ? "chrome70" : "current"}-${theme}-${width}x${height}.png`,
        ),
      );
      if (width === 1280) {
        await cdp.evaluate(
          "document.querySelector('[data-testid=\"dev.gallery\"] input').scrollIntoView(); window.scrollBy(0,-32)",
        );
        await cdp.screenshot(
          path.join(
            SCREENSHOTS,
            `${legacy ? "chrome70" : "current"}-${theme}-controls-1280x800.png`,
          ),
        );
        await cdp.evaluate(
          "window.scrollTo(0,0); document.querySelector('[data-testid=\"ui.status\"]').click()",
        );
        await cdp.wait("!!document.querySelector('[role=dialog]')");
        await cdp.screenshot(
          path.join(
            SCREENSHOTS,
            `${legacy ? "chrome70" : "current"}-${theme}-status-1280x800.png`,
          ),
        );
        assert.equal(
          await cdp.evaluate(
            "document.querySelector('[role=dialog]').contains(document.activeElement)",
          ),
          true,
          "Sheet owns keyboard focus",
        );
        await cdp.evaluate(
          "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
        );
        await cdp.wait("!document.querySelector('[role=dialog]')");
      }
      const viewport = await cdp.evaluate(
        "({width: innerWidth, height: innerHeight})",
      );
      assert.deepEqual(
        viewport,
        { width, height },
        "Screenshot viewport matches its declared dimensions",
      );
      if (width < 720) {
        assert.equal(
          await cdp.evaluate(
            "document.querySelector('[data-testid=\"ui.frame.back\"]').getClientRects().length > 0",
          ),
          true,
          "Stacked layout exposes Back to list",
        );
        await cdp.evaluate(
          "document.querySelector('[data-testid=\"ui.frame.back\"]').click()",
        );
        await cdp.wait(
          "document.querySelector('#talos-list').getClientRects().length > 0 && document.querySelector('.frame-content').getClientRects().length === 0",
        );
        await cdp.evaluate(
          "document.querySelector('#talos-list button').click()",
        );
        await cdp.wait(
          "document.querySelector('.frame-content').getClientRects().length > 0 && document.querySelector('#talos-list').getClientRects().length === 0",
        );
      }
      const readNav =
        "JSON.parse(document.querySelector('[data-testid=\"dev.nav-demo.state\"]').textContent)";
      await cdp.evaluate(
        "document.querySelector('[data-testid=\"dev.nav-demo.open\"]').click()",
      );
      await cdp.wait(
        `(${readNav}).area === 'library' && (${readNav}).areas.library.stack.length === 2`,
      );
      await cdp.evaluate(
        "document.querySelector('[data-testid=\"dev.nav-demo.back\"]').click()",
      );
      await cdp.wait(`(${readNav}).areas.library.stack.length === 1`);
      const rows = await cdp.evaluate(
        `(function(){var list=document.querySelector('[data-testid="ui.virtual-list"]'); if(!list) throw new Error('VirtualScroller missing'); list.scrollTop=1000000; list.dispatchEvent(new Event('scroll')); return list.querySelectorAll("[data-virtual-id]").length;})()`,
      );
      assert.ok(
        rows > 0 && rows < 200,
        "VirtualList must mount only the visible window",
      );
      await cdp.wait(
        `(function(){var list=document.querySelector('[data-testid="ui.virtual-list"]'); var row=list && list.querySelector('[data-virtual-id]'); return row && list.scrollTop > 500000 && Number(row.getAttribute('data-virtual-id')) > 10000;})()`,
      );
      if (width !== 600) {
        for (const auth of [
          "login",
          "wrong-pin",
          "throttled",
          "offline-unavailable",
          "device-locked",
          "bound-to-other-user",
          "invalid-client",
          "system-lock",
          "idle-lock",
          "banned",
        ]) {
          await cdp.navigate(
            `${origin}/gallery.html?theme=${theme}&auth=${auth}`,
          );
          await cdp.wait(
            '!!document.querySelector(\'[data-testid="auth.login"], [data-testid="auth.device-locked"]\')',
          );
          await cdp.screenshot(
            path.join(
              SCREENSHOTS,
              `${legacy ? "chrome70" : "current"}-auth-${theme}-${auth}-${width}x${height}.png`,
            ),
          );
        }
        await authFlows(
          cdp,
          origin,
          legacy ? "chrome70" : "current",
          theme,
          width,
          height,
        );
      }
    }
  }
  await cdp.navigate(`${origin}/`);
  await cdp.wait(
    `!!document.querySelector('[data-testid="app.ready"], [data-testid="auth.login"], [data-testid="auth.concealed"]') && !!window.__talosShell`,
  );
  await cdp.wait("!!navigator.serviceWorker.controller");
  const installed = await eventually(
    () => cdp.evaluate("window.__talosShell.status()"),
    (status) => !!status.active,
    "initial shell installation",
  );
  assert.ok(
    installed.builds.some((build) => build.complete),
    "Build is complete in IndexedDB",
  );
  await cdp.evaluate(
    `window.__talosShell.confirmBoot(${JSON.stringify(installed.active)})`,
  );
  await server.stop();
  await cdp.offline(true);
  await cdp.navigate(`${origin}/`);
  await cdp.wait(
    `!!document.querySelector('[data-testid="app.ready"], [data-testid="auth.login"], [data-testid="auth.concealed"]') && !!navigator.serviceWorker.controller`,
  );
  const offline = await cdp.evaluate("window.__talosShell.status()");
  assert.equal(
    offline.active,
    installed.active,
    "Stopped server: installed shell still boots from IndexedDB",
  );
  await cdp.offline(false);
  await server.start();
  assert.deepEqual(
    external,
    [],
    "All fonts, icons, scripts, and styles must be local",
  );
  assert.deepEqual(
    browser.errors.filter(
      (message) =>
        !/WebSocket connection to .*\/link.*failed/.test(message) &&
        !/Failed to load resource: net::ERR_INTERNET_DISCONNECTED \(.*\/app\/manifest\.json\)/.test(
          message,
        ),
    ),
    [],
    "No uncaught exceptions or unexpected console errors (static host has no link)",
  );
  return installed.active;
}

async function authFlows(cdp, origin, browser, theme, width, height) {
  const click = async (label) =>
    cdp.evaluate(
      `Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b){return b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)};}).click()`,
    );
  const pin = async () => {
    for (const digit of "482619") await click(digit);
  };
  const capture = async (state) => {
    await cdp.evaluate(
      "document.fonts ? document.fonts.ready.then(function(){return true;}) : true",
    );
    await cdp.screenshot(
      path.join(
        SCREENSHOTS,
        `${browser}-auth-${theme}-${state}-${width}x${height}.png`,
      ),
    );
  };
  const open = async (preview) => {
    await cdp.navigate(`${origin}/gallery.html?theme=${theme}&auth=${preview}`);
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"auth.onboarding\"], [role=dialog]')",
    );
  };
  await open("onboarding");
  await capture("onboarding-pin");
  await pin();
  await capture("onboarding-choice");
  await click("添加第二个 PIN");
  await capture("onboarding-second-pin");
  for (const digit of "135790") await click(digit);
  await capture("onboarding-profile");
  await open("pins");
  await capture("pins-current");
  await pin();
  await capture("pins-first");
  await pin();
  await capture("pins-choice");
  await click("添加第二个 PIN");
  await capture("pins-second");
  for (const digit of "135790") await click(digit);
  await cdp.wait("document.body.textContent.indexOf('PIN 已更换')>=0");
  await capture("pins-done");
  await open("invitation");
  await click("创建邀请");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.invitation.result\"]')",
  );
  await capture("invitation");
  await open("reset");
  await click("重置本机数据");
  await capture("reset-warning");
  await cdp.navigate(
    `${origin}/gallery.html?theme=${theme}&auth=denied-logout`,
  );
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.device-locked\"]')",
  );
  await click("退出登录");
  await capture("denied-logout");
}
