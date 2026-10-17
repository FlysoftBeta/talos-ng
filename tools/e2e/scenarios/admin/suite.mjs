import { openSection, usersGridLoaded } from "./helpers.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { click, pin, reveal } from "../../harness/ui.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";
import { adminUsersSuite } from "./users-suite.mjs";
import { adminGroupsSuite } from "./groups-suite.mjs";
import { adminIncidentsSuite } from "./incidents-suite.mjs";

export async function adminSuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser;
  const label = legacy ? "chrome70" : "current";
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
  );
  await reveal(cdp);
  await pin(cdp, "123456");
  await cdp.wait("!!document.querySelector('[data-testid=\"app.ready\"]')");
  await click(cdp, "管理");
  await cdp.wait("document.body.textContent.indexOf('管理工作台')>=0");
  await openSection(cdp, "用户");
  await usersGridLoaded(cdp, 2002);
  assert.equal(
    await cdp.evaluate("document.body.textContent.indexOf('2002')>=0"),
    true,
    "seeded user count is visible in paged grid",
  );
  await click(cdp, "创建用户");
  await cdp.wait("!!document.querySelector('[role=dialog]')");
  for (const [field, value] of [
    ["账号", "admintest"],
    ["姓名", "管理验收用户"],
    ["六位 PIN", "424242"],
  ]) {
    await cdp.evaluate(
      `(function(){var label=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] label')).find(function(l){return l.textContent.indexOf(${JSON.stringify(field)})>=0});var input=document.getElementById(label.htmlFor);var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  }
  await click(cdp, "保存");
  await cdp.wait("!document.querySelector('[role=dialog]')");
  const created = await connectChat(server.url, "424242");
  assert.equal(created.user.handle, "admintest", "created user can log in");
  created.close();
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
    assert.equal(
      await cdp.evaluate("document.documentElement.scrollWidth<=innerWidth"),
      true,
      "admin grid has no page overflow",
    );
    await cdp.screenshot(
      path.join(
        SCREENSHOTS,
        `${label}-admin-users-light-${width}x${height}.png`,
      ),
    );
  }
  await cdp.evaluate(
    '(function(){var body=document.querySelector(\'[data-testid="admin.users.grid"] [data-testid="ui.virtual-list"]\');if(body)body.scrollTop=body.scrollHeight;})()',
  );
  await cdp.wait("!!document.querySelector('[role=table] [role=row]')");
  await cdp.evaluate(
    "(function(){var input=document.querySelector('[data-testid=\"admin.users.grid\"] input[type=search]');var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'fixture00001999');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await cdp.wait("document.body.textContent.indexOf('fixture00001999')>=0");
  await cdp.evaluate(
    "(function(){var input=document.querySelector('[data-testid=\"admin.users.grid\"] input[type=search]');var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await cdp.wait("document.body.textContent.indexOf('2003')>=0");
  await click(cdp, "按账号排序");
  await cdp.wait("!!document.querySelector('[role=table]')");
  await cdp.evaluate(
    "(function(){var row=document.querySelector('[data-testid=\"admin.users\"] [role=row][aria-rowindex]');var edit=row.querySelector('[aria-label=编辑用户]');if(!edit)throw new Error('Edit missing');edit.click();})()",
  );
  await cdp.wait("!!document.querySelector('[role=dialog]')");
  await cdp.evaluate(
    "(function(){var label=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] label')).find(function(l){return l.textContent.indexOf('姓名')>=0});var input=document.getElementById(label.htmlFor);var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'管理员验收');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  await click(cdp, "保存");
  await cdp.wait("!document.querySelector('[role=dialog]')");
  await adminGroupsSuite(browser, server, { legacy });
  await adminUsersSuite(browser, server, { legacy });
  await adminIncidentsSuite(browser, server, { legacy });
  await openSection(cdp, "审计");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"admin.audit\"] [role=table]')",
  );
  await cdp.screenshot(
    path.join(SCREENSHOTS, `${label}-admin-audit-light-768x1024.png`),
  );
  await cdp.offline(true);
  await cdp.wait("document.body.textContent.indexOf('离线不可用')>=0");
  await cdp.screenshot(
    path.join(SCREENSHOTS, `${label}-admin-offline-light-768x1024.png`),
  );
  await cdp.offline(false);
  await cdp.wait("document.body.textContent.indexOf('已连接')>=0");
  const root = await connectChat(server.url, "123456");
  try {
    for (const theme of ["light", "dark"]) {
      await root.call("me.setting.set", {
        key: "theme",
        value: {
          v: theme,
          t: { ms: Date.now(), counter: theme === "light" ? 0 : 1 },
          op:
            theme === "light"
              ? "01ADMN00000000000000000001"
              : "01ADMN00000000000000000002",
        },
      });
      await cdp.wait(`!!document.querySelector('[data-theme=${theme}]')`);
      for (const [section, testId] of [
        ["用户", "admin.users"],
        ["邀请", "admin.invitations"],
        ["设备", "admin.devices"],
        ["群组", "admin.groups"],
        ["系统", "admin.system"],
        ["事件", "admin.incidents"],
        ["性能", "admin.performance"],
        ["审计", "admin.audit"],
      ]) {
        await click(cdp, section);
        await cdp.wait(
          `!!document.querySelector('[data-testid="${testId}"]') && document.querySelector('[data-testid="${testId}"]').textContent.indexOf('加载中')<0`,
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
          assert.equal(
            await cdp.evaluate(
              "document.documentElement.scrollWidth<=innerWidth",
            ),
            true,
            `${section} has no horizontal overflow`,
          );
          await cdp.screenshot(
            path.join(
              SCREENSHOTS,
              `${label}-${testId}-${theme}-${width}x${height}.png`,
            ),
          );
        }
      }
    }
  } finally {
    root.close();
  }
  console.log(
    `${label}: 8 admin workbench flows and 32 screen captures passed`,
  );
}
