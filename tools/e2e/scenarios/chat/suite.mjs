import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { STILL_MOTION } from "../../harness/browser.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";
import { eventually, WAIT_TIMEOUT } from "../../harness/wait.mjs";
/** Selector for a data-testid hook (docs/impl/e2e-hooks.md). */
const T = (id) => `[data-testid="${id}"]`;
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function id() {
  return (
    "0" + Array.from(randomBytes(25), (byte) => alphabet[byte % 32]).join("")
  );
}
async function reveal(page) {
  await page
    .locator(`${T("auth.concealed")}, ${T("auth.numpad")}, ${T("app.ready")}`)
    .first()
    .waitFor();
  if (await page.locator(T("auth.concealed")).count())
    for (const key of [
      "ArrowUp",
      "ArrowUp",
      "ArrowDown",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowLeft",
      "ArrowRight",
    ])
      await page.keyboard.press(key);
}
async function unlock(page, pin) {
  await reveal(page);
  await page.locator(T("auth.numpad")).waitFor();
  for (const digit of pin)
    await page
      .locator(T("auth.numpad"))
      .getByRole("button", { name: digit, exact: true })
      .click();
  await page.locator(T("app.ready")).waitFor();
}
async function connected(page) {
  await page.waitForFunction(() =>
    document.body.textContent.includes("已连接"),
  );
}
/** The app lands on 最近; chat scenarios open 对话 through the rail first. */
async function openChat(page) {
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page
    .locator('button[aria-current="page"][aria-label="对话"]')
    .waitFor();
}
async function close(page) {
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "关闭", exact: true })
    .click();
}
async function open(page, name) {
  await page
    .locator(`${T("ui.row")} ${T("ui.row.action")}`)
    .filter({ has: page.locator(T("ui.row.title"), { hasText: name }) })
    .first()
    .click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
}
async function send(page, text) {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("textbox", { name: "消息", exact: true }).press("Enter");
  await page
    .locator(T("chat.post.text"), { hasText: text.slice(0, 80) })
    .last()
    .waitFor();
}
async function selectPost(post) {
  if (
    !(await post.evaluate(
      (node) => node.getAttribute("data-selected") === "true",
    ))
  )
    await post.locator(T("chat.post.text")).click();
}
async function offline(context, page, value) {
  await context.setOffline(value);
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: value,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await session.detach();
  if (value)
    await page.waitForFunction(() =>
      document.body.textContent.includes("离线"),
    );
  else await connected(page);
}
async function captureOffline(page, state) {
  for (const [width, height] of [
    [1280, 800],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: path.join(
        SCREENSHOTS,
        `current-chat-light-${state}-${width}x${height}.png`,
      ),
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}
/** Real production screens at both tablet sizes, with persisted theme changes. */
async function capture(page, account, state) {
  await page
    .locator(T("chat.banner.dismiss"))
    .evaluateAll((buttons) => buttons.forEach((button) => button.click()));
  await mkdir(SCREENSHOTS, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await account.call("me.setting.set", {
      key: "theme",
      value: { v: theme, t: { ms: Date.now(), counter: 0 }, op: id() },
    });
    await page.locator(`[data-theme="${theme}"]`).waitFor();
    await connected(page);
    for (const [width, height] of [
      [1280, 800],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${state} has no page overflow`,
      );
      await page.screenshot({
        path: path.join(
          SCREENSHOTS,
          `current-chat-${theme}-${state}-${width}x${height}.png`,
        ),
      });
    }
  }
  await account.call("me.setting.set", {
    key: "theme",
    value: { v: "light", t: { ms: Date.now(), counter: 0 }, op: id() },
  });
  await page.locator('[data-theme="light"]').waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
}
/** Two independent accounts, real controls, real link/server and durable offline storage. */
export async function chatSuite(browser, server) {
  const aContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const bContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await aContext.addInitScript(STILL_MOTION);
  await bContext.addInitScript(STILL_MOTION);
  const a = await aContext.newPage();
  const b = await bContext.newPage();
  const errors = [];
  for (const page of [a, b])
    page.on("pageerror", (error) => errors.push(error.message));
  let root;
  let demo;
  let cases = 0;
  try {
    await a.goto(server.url);
    await unlock(a, "123456");
    await connected(a);
    await b.goto(server.url);
    await unlock(b, "654321");
    await connected(b);
    root = await connectChat(server.url, "123456");
    demo = await connectChat(server.url, "654321");
    await openChat(a);
    await openChat(b);
    await capture(a, root, "welcome");
    await a.getByRole("button", { name: "添加对话" }).click();
    await a.getByRole("menuitem", { name: "创建群组", exact: true }).click();
    await a.getByLabel("群组名称", { exact: true }).fill("社区验收群");
    await a.getByLabel("群组标识（可选）").fill("community-e2e");
    await a.getByLabel("加入密码（可选）").fill("class-password");
    await capture(a, root, "create");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "创建群组", exact: true })
      .click();
    await a.getByRole("heading", { name: "社区验收群", exact: true }).waitFor();
    await b.getByRole("button", { name: "添加对话" }).click();
    await b.getByRole("menuitem", { name: "查找群组", exact: true }).click();
    await b.getByLabel("群组名称或标识").fill("community-e2e");
    await b.getByRole("button", { name: "查找", exact: true }).click();
    await b
      .getByRole("dialog")
      .locator(T("ui.row.action"), { hasText: "社区验收群" })
      .waitFor();
    await capture(b, demo, "find");
    await b
      .getByRole("dialog")
      .locator(T("ui.row.action"), { hasText: "社区验收群" })
      .click();
    await b.getByLabel("群组密码", { exact: true }).fill("class-password");
    await capture(b, demo, "join");
    await b.getByRole("button", { name: "加入群组", exact: true }).click();
    await b.getByRole("heading", { name: "社区验收群", exact: true }).waitFor();
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await send(a, "实时消息：你好，同学");
    await b
      .locator(T("chat.post.text"), { hasText: "实时消息：你好，同学" })
      .waitFor();
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await b.getByRole("button", { name: "状态", exact: true }).click();
    await b.getByText("所有更改已保存", { exact: true }).waitFor();
    await close(b);
    await capture(b, demo, "conversation");
    await b.getByRole("button", { name: "成员", exact: true }).click();
    await b
      .getByRole("dialog")
      .locator(T("ui.row"), { hasText: "根管理员" })
      .waitFor();
    await capture(b, demo, "members");
    await b
      .getByRole("dialog")
      .locator(T("ui.row"), { hasText: "根管理员" })
      .getByRole("button", { name: "私信", exact: true })
      .click();
    await b
      .getByRole("heading", { name: /根管理员.*测试用户|测试用户.*根管理员/ })
      .waitFor();
    const dmName = await b
      .getByRole("heading", { name: /根管理员.*测试用户|测试用户.*根管理员/ })
      .textContent();
    await send(b, "私信已经建立");
    await capture(b, demo, "direct");
    // The peer's live session reaches the existing conversation from the members list.
    await a.getByRole("button", { name: "成员", exact: true }).click();
    await a
      .getByRole("dialog")
      .locator(T("ui.row"), { hasText: "测试用户" })
      .getByRole("button", { name: "私信", exact: true })
      .click();
    await a.getByRole("heading", { name: dmName, exact: true }).waitFor();
    await a.locator(T("chat.post.text"), { hasText: "私信已经建立" }).waitFor();
    await send(a, "私信回复");
    await b.locator(T("chat.post.text"), { hasText: "私信回复" }).waitFor();
    await open(a, "社区验收群");
    // The peer's live session receives the new conversation without a reload.
    await open(a, dmName);
    await a.locator(T("chat.post.text"), { hasText: "私信已经建立" }).waitFor();
    await send(a, "私信回复");
    await b.locator(T("chat.post.text"), { hasText: "私信回复" }).waitFor();
    await open(a, "社区验收群");
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await send(a, "横幅预览".repeat(20));
    await b.locator(T("chat.banner")).waitFor();
    assert.equal(
      await b.locator(T("chat.banner.preview")).textContent(),
      "横幅预览".repeat(20).slice(0, 60),
    );
    const touchSession = await bContext.newCDPSession(b);
    const bannerBox = await b.locator(T("chat.banner")).boundingBox();
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: bannerBox.x + 80, y: bannerBox.y + bannerBox.height - 5 },
      ],
    });
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: bannerBox.x + 80,
          y: Math.max(0, bannerBox.y + bannerBox.height - 65),
        },
      ],
    });
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await touchSession.detach();
    await b.locator(T("chat.banner")).waitFor({ state: "hidden" });
    await demo.call("me.setting.set", {
      key: "dnd",
      value: { v: true, t: { ms: Date.now(), counter: 0 }, op: id() },
    });
    await b.reload();
    await unlock(b, "654321");
    await connected(b);
    await open(b, dmName);
    await send(a, "全局免打扰不弹横幅");
    await b
      .locator(T("ui.row.hint"), { hasText: "全局免打扰不弹横幅" })
      .waitFor();
    assert.equal(await b.locator(T("chat.banner")).count(), 0);
    await demo.call("me.setting.set", {
      key: "dnd",
      value: { v: false, t: { ms: Date.now(), counter: 0 }, op: id() },
    });
    await b.reload();
    await unlock(b, "654321");
    await connected(b);
    await open(b, dmName);
    await send(a, "点击横幅回到群组");
    await b.locator(T("chat.banner")).waitFor();
    await b.locator(T("chat.banner.open")).first().click();
    await b.getByRole("heading", { name: "社区验收群", exact: true }).waitFor();
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await offline(bContext, b, true);
    await send(b, "离线顺序第一条");
    await send(b, "离线顺序第二条");
    await b.getByText("待发送", { exact: false }).first().waitFor();
    await captureOffline(b, "offline-pending");
    await b.getByRole("button", { name: "对话设置", exact: true }).click();
    await b.getByRole("switch", { name: "置顶对话", exact: true }).click();
    await b.getByRole("switch", { name: "免打扰", exact: true }).click();
    await b
      .getByRole("switch", { name: "置顶对话", exact: true, checked: true })
      .waitFor();
    await close(b);
    await b
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("重新打开后仍在的草稿");
    await b.getByRole("textbox", { name: "消息", exact: true }).blur();
    // The list preview projects the durable outbox: the draft is stored before the reload.
    await b.getByText("草稿：重新打开后仍在的草稿", { exact: true }).waitFor();
    await b.reload();
    await unlock(b, "654321");
    await open(b, "社区验收群");
    await eventually(
      () => b.getByRole("textbox", { name: "消息", exact: true }).inputValue(),
      (value) => value === "重新打开后仍在的草稿",
      "draft survived offline restart",
    );
    await b.getByRole("textbox", { name: "消息", exact: true }).fill("");
    await offline(bContext, b, false);
    await a
      .locator(T("chat.post.text"), { hasText: "离线顺序第二条" })
      .waitFor();
    const ordered = await a.locator(T("chat.post.text")).allTextContents();
    assert(
      ordered.indexOf("离线顺序第一条") < ordered.indexOf("离线顺序第二条"),
    );
    await b.getByRole("button", { name: "对话设置", exact: true }).click();
    await b
      .getByRole("switch", { name: "置顶对话", exact: true, checked: true })
      .waitFor();
    await b
      .getByRole("switch", { name: "免打扰", exact: true, checked: true })
      .waitFor();
    await close(b);
    await open(b, dmName);
    await send(a, "对话免打扰不弹横幅");
    await b
      .locator(T("ui.row.hint"), { hasText: "对话免打扰不弹横幅" })
      .waitFor();
    assert.equal(await b.locator(T("chat.banner")).count(), 0);
    await open(b, "社区验收群");
    cases += 3;
    console.log(`Chat E2E completed ${cases}`);
    const original = a.locator(T("chat.post"), {
      has: a.locator(T("chat.post.text"), { hasText: "对话免打扰不弹横幅" }),
    });
    await selectPost(original);
    await original.getByRole("button", { name: /编辑/ }).click();
    await a.getByLabel("编辑正文").fill("编辑后的消息");
    await capture(a, root, "edit");
    await a.getByRole("button", { name: "保存编辑", exact: true }).click();
    await b.locator(T("chat.post.text"), { hasText: "编辑后的消息" }).waitFor();
    await selectPost(a.locator(T("chat.post"), { hasText: "编辑后的消息" }));
    await a
      .locator(T("chat.post"), { hasText: "编辑后的消息" })
      .getByRole("button", { name: /回复/ })
      .click();
    await send(a, "回复编辑后的消息");
    await a
      .locator(T("chat.post"), { hasText: "回复编辑后的消息" })
      .getByRole("button", { name: /跳到被回复的消息/ })
      .click();
    const toDelete = a
      .locator(T("chat.post"), {
        has: a.locator(T("chat.post.text"), { hasText: "编辑后的消息" }),
      })
      .first();
    await selectPost(toDelete);
    await toDelete.getByRole("button", { name: /删除/ }).click();
    await capture(a, root, "delete");
    await a.getByRole("button", { name: "确认删除", exact: true }).click();
    await b
      .getByText(/消息已删除/)
      .first()
      .waitFor();
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    const long = "长文测试段落。".repeat(3000);
    await a.getByRole("button", { name: "全屏编辑", exact: true }).click();
    await a.getByLabel("完整正文", { exact: true }).fill(long);
    await capture(a, root, "fullscreen");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "发送", exact: true })
      .click();
    await a
      .getByRole("button", { name: /阅读全文/ })
      .last()
      .click();
    await eventually(
      () => a.locator(T("chat.post.full-text")).textContent(),
      (text) => text === long,
      "full long body",
    );
    await capture(a, root, "long-text");
    await close(a);
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await a.getByRole("button", { name: "贴纸", exact: true }).click();
    await a
      .getByRole("tablist", { name: "贴纸包" })
      .getByRole("tab")
      .nth(1)
      .click();
    await a
      .locator(`${T("chat.sticker")} img`)
      .first()
      .waitFor();
    await capture(a, root, "stickers");
    // Every cell state (skeleton, image, missing) fits its fixed row, nothing makes the panel
    // overflow, and a pack switch opens the next pack at its top.
    const stickerPanel = a.getByRole("dialog", { name: "发送贴纸" });
    const stickerList = stickerPanel.getByRole("list", { name: "贴纸" });
    await stickerList.evaluate((list) => {
      list.scrollTop = list.scrollHeight;
    });
    const stickerLayout = () =>
      stickerPanel.evaluate((panel) => {
        const fits = (node) =>
          node.scrollWidth <= node.clientWidth + 1 &&
          node.scrollHeight <= node.clientHeight + 1;
        const list = panel.querySelector('[role="list"]');
        return {
          panel: fits(panel),
          list: list.scrollWidth <= list.clientWidth + 1,
          rows: Array.from(
            list.querySelectorAll("[data-virtual-id]"),
            (row) => row.getBoundingClientRect().height,
          ).every((height) => height === 96),
          cells: Array.from(
            panel.querySelectorAll('[data-testid="chat.sticker"]'),
          ).every(fits),
        };
      });
    assert.deepEqual(await stickerLayout(), {
      panel: true,
      list: true,
      rows: true,
      cells: true,
    });
    await a
      .getByRole("tablist", { name: "贴纸包" })
      .getByRole("tab")
      .nth(2)
      .click();
    await a
      .locator(`${T("chat.sticker")} img`)
      .first()
      .waitFor();
    assert.equal(
      await stickerList.evaluate((list) => list.scrollTop),
      0,
      "a new pack opens at its top",
    );
    assert.deepEqual(await stickerLayout(), {
      panel: true,
      list: true,
      rows: true,
      cells: true,
    });
    await a
      .getByRole("tablist", { name: "贴纸包" })
      .getByRole("tab")
      .nth(1)
      .click();
    await a
      .locator(`${T("chat.sticker")} img`)
      .first()
      .waitFor();
    await a
      .getByRole("button", { name: /发送贴纸：/ })
      .first()
      .click();
    await b
      .locator(`${T("chat.post.sticker")} img`)
      .last()
      .waitFor();
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await a.locator('input[type="file"][aria-label="图片"]').setInputFiles({
      name: "retained.png",
      mimeType: "image/png",
      buffer: await readFile(
        new URL(
          "../../../../packages/server/stickers/akendfield/akendfield-d-1.png",
          import.meta.url,
        ),
      ),
    });
    await b
      .getByRole("button", { name: /查看原图/ })
      .last()
      .click();
    await b.getByRole("dialog").locator("img").waitFor();
    await capture(b, demo, "image");
    await close(b);
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await b.getByRole("button", { name: "对话设置", exact: true }).click();
    await b.getByLabel("离线保留").click();
    await b.locator('[role="option"][data-value="week"]').click();
    await capture(b, demo, "settings");
    await close(b);
    // File download completion is asserted through the production status centre.
    await b.getByRole("button", { name: "状态", exact: true }).click();
    await b
      .getByText(/^离线保留完成 · 社区验收群 · \d+ 条$/)
      .waitFor({ timeout: WAIT_TIMEOUT });
    await close(b);
    // Navigation (including an open sheet) is persisted asynchronously and restored after
    // reload; let the "sheet closed" state land, and tolerate a restored sheet.
    await b.waitForTimeout(400);
    await offline(bContext, b, true);
    await b.reload();
    await unlock(b, "654321");
    if (await b.getByRole("dialog").count()) await close(b);
    await open(b, "社区验收群");
    await b
      .getByRole("button", { name: /查看原图/ })
      .last()
      .click();
    await b.getByRole("dialog").locator("img").waitFor();
    await captureOffline(b, "retained-image");
    await close(b);
    await captureOffline(b, "retained-conversation");
    await offline(bContext, b, false);
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    const history = (
      await root.call("community.group.create", {
        name: "五百条历史",
        discoverable: true,
      })
    ).data;
    await demo.call("community.group.join", {
      group: history.id,
      source: { type: "search" },
    });
    for (let seq = 1; seq <= 500; seq++)
      await root.call("chat.post.send", {
        id: id(),
        conversation: history.id,
        kind: "text",
        text: `历史第 ${String(seq).padStart(3, "0")} 条`,
      });
    await demo.call("chat.state.read", { conversation: history.id, seq: 250 });
    await b.reload();
    await unlock(b, "654321");
    await connected(b);
    await open(b, "五百条历史");
    await b.getByText("以下为未读消息", { exact: true }).waitFor();
    await b.locator('[data-seq="251"]').waitFor();
    assert(
      (await b.locator("[data-seq]").count()) < 100,
      "history stays virtualized",
    );
    await capture(b, demo, "unread-history");
    const list = b.getByRole("list", { name: "对话消息" });
    for (let n = 0; n < 3; n++) {
      await list.evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await b.waitForTimeout(200);
    }
    await b.getByRole("button", { name: "跳到最新消息" }).click();
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await b
      .locator(T("chat.post.text"), { hasText: "历史第 500 条" })
      .waitFor();
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    const parentGroup = (
      await root.call("community.group.find", { query: "community-e2e" })
    ).data[0];
    await root.call("community.group.create", {
      name: "验收子群组",
      parent: parentGroup.id,
      discoverable: true,
    });
    await open(b, "社区验收群");
    await b.getByRole("button", { name: "对话设置", exact: true }).click();
    await b.getByRole("button", { name: "发现子群组", exact: true }).click();
    await b
      .getByRole("dialog")
      .locator(T("ui.row.action"), { hasText: "验收子群组" })
      .waitFor();
    await capture(b, demo, "subgroups");
    await b
      .getByRole("dialog")
      .locator(T("ui.row.action"), { hasText: "验收子群组" })
      .click();
    await b.getByRole("button", { name: "加入群组", exact: true }).click();
    await b.getByRole("heading", { name: "验收子群组", exact: true }).waitFor();
    await b.getByRole("button", { name: "成员", exact: true }).click();
    await b.getByLabel("在成员名单中隐藏自己").click();
    await eventually(
      async () =>
        (
          await demo.call("community.group.members", {
            group: (
              await demo.call("community.group.find", { query: "验收子群组" })
            ).data[0].id,
          })
        ).data.self.hidden,
      Boolean,
      "hide self persisted",
    );
    await b.getByRole("button", { name: "退出群组", exact: true }).click();
    await capture(b, demo, "leave");
    await b.getByRole("button", { name: "确认", exact: true }).click();
    await b
      .getByRole("heading", { name: "验收子群组", exact: true })
      .waitFor({ state: "hidden" });
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await open(b, "社区验收群");
    await offline(bContext, b, true);
    await send(b, "待重试的消息");
    await root.call("chat.user.mute", {
      user: demo.user.id,
      until: Date.now() + 60000,
    });
    await offline(bContext, b, false);
    const failedRetry = b.locator(T("chat.post"), {
      has: b.locator(T("chat.post.text"), { hasText: "待重试的消息" }),
    });
    const failedDiscard = b.locator(T("chat.post"), {
      has: b.locator(T("chat.post.text"), { hasText: "待丢弃的消息" }),
    });
    await failedRetry.getByText("发送失败", { exact: true }).waitFor();
    await capture(b, demo, "failed-posts");
    await b.getByRole("button", { name: "状态", exact: true }).click();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "重试", exact: true })
      .first()
      .waitFor();
    await capture(b, demo, "failed-status");
    await close(b);
    await root.call("chat.user.mute", { user: demo.user.id, until: 0 });
    await failedRetry
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await a.locator(T("chat.post.text"), { hasText: "待重试的消息" }).waitFor();
    await offline(bContext, b, true);
    await send(b, "待丢弃的消息");
    await root.call("chat.user.mute", {
      user: demo.user.id,
      until: Date.now() + 60000,
    });
    await offline(bContext, b, false);
    await failedDiscard.getByText("发送失败", { exact: true }).waitFor();
    await b.getByRole("button", { name: "状态", exact: true }).click();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "放弃", exact: true })
      .first()
      .click();
    await close(b);
    await failedDiscard.waitFor({ state: "hidden" });
    await root.call("chat.user.mute", { user: demo.user.id, until: 0 });

    cases++;
    console.log(`Chat E2E completed ${cases}`);
    await root.call("chat.announcement.publish", {
      title: "验收公告",
      text: "请阅读并确认本次通知。",
    });
    await b.getByRole("dialog").filter({ hasText: "验收公告" }).waitFor();
    await b.keyboard.press("Escape");
    await b
      .locator(`${T("auth.lock")}, ${T("auth.concealed")}`)
      .first()
      .waitFor();
    await unlock(b, "654321");
    await b.getByRole("dialog").filter({ hasText: "验收公告" }).waitFor();
    await capture(b, demo, "announcement");
    await b.getByRole("button", { name: /确认.*阅读|我已阅读|已阅读/ }).click();
    await a.getByRole("button", { name: /确认.*阅读|我已阅读|已阅读/ }).click();
    cases++;
    console.log(`Chat E2E completed ${cases}`);
    assert.deepEqual(errors, []);
    console.log(
      `Community/chat: ${cases} real-server cases passed with two browser contexts.`,
    );
    return cases;
  } catch (error) {
    console.error(
      "Chat A:",
      await a
        .locator("body")
        .innerText()
        .catch(() => "closed"),
    );
    console.error(
      "Chat B:",
      await b
        .locator("body")
        .innerText()
        .catch(() => "closed"),
    );
    throw error;
  } finally {
    root?.close();
    demo?.close();
    await aContext.close();
    await bContext.close();
  }
}
