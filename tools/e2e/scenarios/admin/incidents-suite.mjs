import { openSection } from "./helpers.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { click } from "../../harness/ui.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";

export async function adminIncidentsSuite(
  browser,
  server,
  { legacy = false } = {},
) {
  const { cdp } = browser;
  const label = legacy ? "chrome70" : "current";
  await openSection(cdp, "事件");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"admin.incidents\"]')",
  );
  await click(cdp, "服务器自检");
  await click(cdp, "确认");
  await cdp.wait(
    "document.querySelector('[data-testid=\"admin.incidents\"] [role=table]') && document.querySelector('[data-testid=\"admin.incidents\"] [role=table]').textContent.indexOf('admin.incident.selfTest')>=0",
  );
  const root = await connectChat(server.url, "123456");
  try {
    const listed = (
      await root.call("admin.incident.list", {
        module: "admin",
        level: "error",
        limit: 50,
        offset: 0,
      })
    ).data;
    assert.ok(listed.items.length >= 1);
    const detail = (
      await root.call("admin.incident.detail", {
        id: listed.items[0].id,
      })
    ).data;
    assert.ok(detail.stack.includes("AdminDiagnostics.selfTest"));
    const ticket = (await root.call("admin.incident.download", {})).data;
    const response = await fetch(new URL(ticket.url, server.url));
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  } finally {
    root.close();
  }
  const errorCount = browser.errors.length;
  await click(cdp, "客户端自检");
  await click(cdp, "确认");
  const observer = await connectChat(server.url, "123456");
  try {
    let captured;
    for (let i = 0; i < 100; i++) {
      const rows = (
        await observer.call("admin.incident.list", { source: "client" })
      ).data.items;
      captured = rows.find((row) => row.summary === "Error: client.error");
      if (captured) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(captured, "real window error reaches incident workbench");
    const detail = (
      await observer.call("admin.incident.detail", { id: captured.id })
    ).data;
    assert.equal(detail.source, "client");
    assert.ok(detail.build && detail.environment.includes("Chrome/"));
    await click(cdp, "刷新事件");
    await cdp.wait(
      "document.querySelector('[data-testid=\"admin.incidents\"]').textContent.indexOf('client.error')>=0",
    );
    assert.ok(
      browser.errors
        .slice(errorCount)
        .some((error) => error.includes("Client diagnostic self-test")),
    );
    // This exception is intentional and its delivery is asserted above.
    browser.errors.splice(
      errorCount,
      browser.errors.length - errorCount,
      ...browser.errors
        .slice(errorCount)
        .filter((error) => !error.includes("Client diagnostic self-test")),
    );
  } finally {
    observer.close();
  }
  await cdp.evaluate(
    "(function(){var row=document.querySelector('[data-testid=\"admin.incidents\"] [role=row][aria-rowindex]');row.querySelector('[aria-label=查看事件]').click();})()",
  );
  await cdp.wait(
    "!!document.querySelector('[role=dialog] .admin-incident-stack')",
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
        `${label}-admin-incident-detail-light-${width}x${height}.png`,
      ),
    );
  }
  await cdp.evaluate(
    "document.querySelector('[role=dialog] button[aria-label=关闭]').click()",
  );
  await openSection(cdp, "设备");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"admin.devices\"] [role=table]')",
  );
  await cdp.evaluate(
    "(function(){var row=document.querySelector('[data-testid=\"admin.devices\"] [role=row][aria-rowindex]');row.querySelector('[aria-label=编辑设备]').click();})()",
  );
  await cdp.wait("!!document.querySelector('[role=dialog]')");
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
        `${label}-admin-device-edit-light-${width}x${height}.png`,
      ),
    );
  }
  await cdp.evaluate(
    "document.querySelector('[role=dialog] button[aria-label=关闭]').click()",
  );
  await openSection(cdp, "调试");
  await cdp.wait("!!document.querySelector('[data-testid=\"admin.debug\"]')");
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
        `${label}-admin-debug-light-${width}x${height}.png`,
      ),
    );
  }
  await click(cdp, "强制离线");
  await cdp.wait("document.body.textContent.indexOf('取消强制离线')>=0");
  await click(cdp, "取消强制离线");
  await cdp.wait("document.body.textContent.indexOf('已连接')>=0");
}
