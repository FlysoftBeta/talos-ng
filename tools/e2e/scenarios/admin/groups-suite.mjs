import { openSection } from "./helpers.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { click } from "../../harness/ui.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";

async function fill(cdp, label, value) {
  await cdp.evaluate(
    `(function(){var field=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] label')).find(function(node){return node.textContent.indexOf(${JSON.stringify(label)})>=0});if(!field)throw new Error('Field missing: ${label}');var input=document.getElementById(field.htmlFor);var proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
}
async function screenshot(cdp, name, label) {
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
      path.join(SCREENSHOTS, `${label}-${name}-${width}x${height}.png`),
    );
  }
}

/** Called with the authenticated root workbench in both current and legacy browser suites. */
export async function adminGroupsSuite(
  browser,
  server,
  { legacy = false } = {},
) {
  const { cdp } = browser;
  const label = legacy ? "chrome70" : "current";
  const groupHandle = `admin_e2e_${label}`;
  await openSection(cdp, "群组");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"admin.groups\"] [role=table]')",
  );
  await screenshot(cdp, "admin-groups-panel", label);
  await click(cdp, "创建群组");
  await cdp.wait("!!document.querySelector('[role=dialog]')");
  await fill(cdp, "名称", "验收群组");
  await fill(cdp, "标识", groupHandle);
  await screenshot(cdp, "admin-group-editor", label);
  await click(cdp, "保存");
  await cdp.wait(
    `!document.querySelector('[role=dialog]') && document.body.textContent.indexOf(${JSON.stringify(groupHandle)})>=0`,
  );
  const member = await connectChat(server.url, "424242");
  const memberId = member.user.id;
  member.close();
  await cdp.evaluate(
    `(function(){var row=Array.prototype.slice.call(document.querySelectorAll('[data-testid=\"admin.groups\"] [role=row][aria-rowindex]')).find(function(node){return node.textContent.indexOf(${JSON.stringify(groupHandle)})>=0});if(!row)throw new Error('Group row missing');row.querySelector('[aria-label=查看成员]').click();})()`,
  );
  await cdp.wait("!!document.querySelector('[role=dialog]')");
  await fill(cdp, "按用户名精确添加", "admintest");
  await cdp.wait(
    "!!document.querySelector('[role=dialog] button:not([disabled])')",
  );
  await cdp.wait(
    "Array.prototype.slice.call(document.querySelectorAll('[role=dialog] button')).some(function(node){return node.textContent.trim()==='添加成员' && !node.disabled})",
  );
  await click(cdp, "添加成员");
  await cdp.wait(
    "!!document.querySelector('[role=dialog] [aria-label=移除成员]')",
  );
  await screenshot(cdp, "admin-group-members", label);
  await cdp.evaluate(
    "(function(){var sheet=document.querySelector('[role=dialog]');var button=sheet.querySelector('[aria-label=移除成员]:not([disabled])');if(!button)throw new Error('Kick missing');button.click();})()",
  );
  await cdp.wait(
    "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(node){return node.textContent.trim()==='确认删除'})",
  );
  await click(cdp, "确认删除");
  await cdp.wait(
    "document.querySelector('[role=dialog]') && !document.querySelector('[role=dialog] [aria-label=移除成员]:not(:disabled)')",
  );
  await cdp.evaluate(
    "document.querySelector('[role=dialog] button[aria-label=关闭]').click()",
  );
  const root = await connectChat(server.url, "123456");
  try {
    const group = (await root.call("admin.group.list", { query: groupHandle }))
      .data.items[0];
    assert.ok(group, "created group exists");
    const members = (await root.call("admin.group.members", { id: group.id }))
      .data;
    assert.equal(
      members.some((item) => item.user === memberId),
      false,
      "member was kicked",
    );
  } finally {
    root.close();
  }
  await openSection(cdp, "公告");
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"admin.announcements\"]')",
  );
  await screenshot(cdp, "admin-announcements-panel", label);
  await click(cdp, "发布新版本");
  await fill(cdp, "标题", "验收公告");
  await fill(cdp, "正文", "请确认这条公告。");
  await click(cdp, "预览");
  await screenshot(cdp, "admin-announcement-preview", label);
  await cdp.evaluate(
    "(function(){var button=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] button')).find(function(node){return node.textContent.trim()==='发布新版本'});if(!button)throw new Error('Publish missing');button.click();})()",
  );
  await cdp.wait(
    "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(node){return node.textContent.trim()==='确认'})",
  );
  await click(cdp, "确认");
  await cdp.wait(
    "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(node){return node.textContent.trim()==='我已阅读并确认'})",
  );
  await click(cdp, "我已阅读并确认");
  await cdp.wait(
    "!document.querySelector('[role=dialog]') && document.body.textContent.indexOf('验收公告')>=0",
  );
  const other = await connectChat(server.url, "424242");
  try {
    const root2 = await connectChat(server.url, "123456");
    let revision;
    try {
      revision = (await root2.call("admin.announcement.list", {})).data.items[0]
        .revision;
      await root2.call("chat.announcement.ack", { revision });
    } finally {
      root2.close();
    }
    await other.call("chat.announcement.ack", { revision });
    const root3 = await connectChat(server.url, "123456");
    try {
      assert.ok(
        (await root3.call("admin.announcement.list", {})).data.items[0]
          .acknowledged >= 1,
        "other user acknowledged published revision",
      );
    } finally {
      root3.close();
    }
  } finally {
    other.close();
  }
}
