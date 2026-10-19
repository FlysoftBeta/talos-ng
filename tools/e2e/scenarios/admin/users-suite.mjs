import { openSection } from "./helpers.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { STILL_MOTION } from "../../harness/browser.mjs";
import { click, pin, reveal } from "../../harness/ui.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";
import { prepareChrome70 } from "../../../legacy-chromium/prepare.mjs";
import { launchChrome } from "../../../legacy-chromium/cdp.mjs";

async function targetBrowser(legacy) {
  if (legacy) {
    const chrome = await prepareChrome70();
    const adapter = await launchChrome(chrome.executable);
    await adapter.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: STILL_MOTION,
    });
    return adapter;
  }
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  await context.addInitScript(STILL_MOTION);
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  return {
    cdp: {
      navigate: (url) => page.goto(url, { waitUntil: "load" }),
      wait: (expression) => page.waitForFunction(expression),
      evaluate: (expression) => page.evaluate(expression),
      send: (method, params) =>
        method === "Emulation.setDeviceMetricsOverride"
          ? page.setViewportSize({ width: params.width, height: params.height })
          : session.send(method, params),
      screenshot: (file) => page.screenshot({ path: file }),
    },
    close: () => browser.close(),
  };
}

async function shot(cdp, label, name) {
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
      path.join(SCREENSHOTS, `${label}-admin-${name}-${width}x${height}.png`),
    );
  }
}
async function search(cdp, value) {
  await cdp.evaluate(
    `(function(){var input=document.querySelector('[data-testid=\"admin.users.grid\"] input[type=search]');var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await cdp.wait(
    `document.querySelector('[data-testid=\"admin.users\"] [role=table]') && document.querySelector('[data-testid=\"admin.users\"] [role=table]').textContent.indexOf(${JSON.stringify(value)})>=0`,
  );
}
export async function adminUsersSuite(
  browser,
  server,
  { legacy = false } = {},
) {
  const { cdp } = browser;
  const label = legacy ? "chrome70" : "current";
  await openSection(cdp, "用户");
  const root = await connectChat(server.url, "123456");
  const user = await connectChat(server.url, "424242");
  const target = await targetBrowser(legacy);
  try {
    await target.cdp.navigate(`${server.url}/`);
    await target.cdp.wait(
      "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
    );
    await reveal(target.cdp);
    await pin(target.cdp, "424242");
    await target.cdp.wait(
      "!!document.querySelector('[data-testid=\"app.ready\"]')",
    );
    const mediaRail = "!!document.querySelector('button[aria-label=音乐]')";
    const hadMedia = await target.cdp.evaluate(mediaRail);
    const before = (await user.call("sync.pull", { cursors: {} })).data;
    await root.call("admin.user.update", {
      id: user.user.id,
      features: ["offline", "media"],
    });
    const after = (await user.call("sync.pull", { cursors: {} })).data;
    assert.notDeepEqual(
      after.scopes[`me:${user.user.id}`],
      before.scopes[`me:${user.user.id}`],
      "gate update reaches the open user session",
    );
    if (!hadMedia) await target.cdp.wait(mediaRail);
    // Audit regressions: these commands existed on the server but lacked UI entry points.
    await search(cdp, "admintest");
    await cdp.evaluate(
      "document.querySelector('[aria-label=详细说明]').click()",
    );
    await cdp.wait("document.body.textContent.indexOf('批量编辑逐人执行')>=0");
    await cdp.evaluate(
      "document.querySelector('[aria-label=详细说明]').click()",
    );
    await cdp.evaluate(
      "document.querySelector('[aria-label=编辑用户]').click()",
    );
    await cdp.wait("!!document.querySelector('[role=dialog]')");
    await shot(cdp, label, "user-editor");
    await click(cdp, "保存");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"admin.users\"] [role=row][aria-rowindex] input[type=checkbox]').click()",
    );
    await click(cdp, "批量分配 AI 额度");
    await cdp.wait("!!document.querySelector('[role=dialog]')");
    await cdp.evaluate(
      "(function(){var input=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] label')).find(function(n){return n.textContent.indexOf('每人充值额度')>=0}).control;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'7');input.dispatchEvent(new Event('input',{bubbles:true}))})()",
    );
    const creditBefore = (
      await root.call("ai.admin.account", { user: user.user.id })
    ).data.topup;
    await click(cdp, "确认分配到所选用户");
    await cdp.wait("document.body.textContent.indexOf('成功 1，失败 0')>=0");
    assert.equal(
      (await root.call("ai.admin.account", { user: user.user.id })).data.topup,
      creditBefore + 7000000,
      "batch credit button commits the selected account",
    );
    await shot(cdp, label, "credit-batch");
    await click(cdp, "关闭");
    await click(cdp, "取消选择");
    await search(cdp, "root");
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"admin.users\"] [role=row][aria-rowindex] input[type=checkbox]').click()",
    );
    await search(cdp, "admintest");
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"admin.users\"] [role=row][aria-rowindex] input[type=checkbox]').click()",
    );
    await click(cdp, "批量编辑");
    await cdp.wait("!!document.querySelector('[role=dialog]')");
    await shot(cdp, label, "bulk-editor");
    await cdp.evaluate(
      "(function(){var row=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] [data-testid=\"admin.users.bulk.field\"]')).find(function(n){return n.textContent.indexOf('封禁')>=0});row.querySelectorAll('button')[1].click()})()",
    );
    await click(cdp, "应用到所选用户");
    await shot(cdp, label, "bulk-confirm");
    await click(cdp, "确认");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"admin.users.bulk.report\"]')",
    );
    assert.equal(
      await cdp.evaluate(
        "document.querySelector('[data-testid=\"admin.users.bulk.report\"]').textContent.indexOf('失败 1')>=0",
      ),
      true,
    );
    await assert.rejects(
      user.call("sync.pull", { cursors: {} }),
      "ban revokes the target's open session",
    );
    await target.cdp
      .wait("document.body.textContent.indexOf('设备或账户已被封禁')>=0")
      .catch(async (error) => {
        throw new Error(
          `Target did not show banned state: ${await target.cdp.evaluate("document.body.textContent")} (${error})`,
        );
      });
    assert.ok(
      (await root.call("admin.user.list", { query: "admintest" })).data.items[0]
        .bannedUntil > Date.now(),
      "bulk duration is durable",
    );
    await target.cdp.wait("!!document.querySelector('[role=timer]')");
    await shot(target.cdp, label, "banned-session");
    await shot(cdp, label, "bulk-report");
    await click(cdp, "关闭");
    await root.call("admin.user.update", { id: user.user.id, banned: false });
    await search(cdp, "admintest");
    await cdp.evaluate(
      "(function(){var row=document.querySelector('[data-testid=\"admin.users\"] [role=row][aria-rowindex]');row.querySelector('[aria-label=禁言]').click()})()",
    );
    await shot(cdp, label, "mute-sheet");
    await cdp.evaluate(
      "(function(){var input=document.querySelector('[aria-label=自定义持续时间] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}))})()",
    );
    await click(cdp, "确认禁言");
    await click(cdp, "确认");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    const muted = (await root.call("admin.user.list", { query: "admintest" }))
      .data.items[0].mutedUntil;
    assert.ok(
      Math.abs(muted - Date.now() - 2 * 86400000) < 30000,
      "custom two-day mute reaches the server",
    );
    await cdp.wait("!!document.querySelector('[aria-label=永久清除用户]')");
    await cdp.evaluate(
      "(function(){var row=document.querySelector('[data-testid=\"admin.users\"] [role=row][aria-rowindex]');row.querySelector('[aria-label=永久清除用户]').click()})()",
    );
    await shot(cdp, label, "purge-confirm");
    await click(cdp, "确认");
    await cdp.wait(
      "!document.querySelector('[data-testid=\"admin.users\"] [role=row][aria-rowindex]')",
    );
    const jobs = (await root.call("sync.pull", { cursors: {} })).data.scopes[
      `me:${root.user.id}`
    ];
    assert.ok(jobs, "purge job projects into tasks");
  } finally {
    root.close();
    user.close();
    await target.close();
  }
}
