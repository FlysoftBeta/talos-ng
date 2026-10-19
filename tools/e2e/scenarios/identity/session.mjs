import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { eventually, swMessage } from "../../harness/wait.mjs";
import {
  text,
  app,
  locked,
  click,
  pin,
  reveal,
  select,
  captures,
  closeSheet,
  connected,
} from "../../harness/ui.mjs";
import { identityScenarios } from "./identity.mjs";

export async function realSuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser;
  const name = legacy ? "chrome70" : "current";
  const startErrors = browser.errors.length;
  const exceptions = [];
  const rejections = [];
  let observing = true;
  cdp.on("Network.webSocketFrameReceived", ({ response }) => {
    // Later suites transfer binary document bodies. This JSON-only probe belongs
    // to the identity/settings suite and must not parse their frames.
    if (!observing || response.opcode !== 2) return;
    // Chromium 70 emits a raw string with the binary prefix followed by decoded
    // UTF-8 JSON; current CDP uses base64. These tested methods have no reply body.
    const raw = response.payloadData;
    let header;
    if (raw.charCodeAt(0) < 10) {
      if (raw.charCodeAt(0) !== 4) return;
      header = JSON.parse(raw.slice(5));
    } else {
      const bytes = Buffer.from(raw, "base64");
      if (bytes.length < 5 || bytes[0] !== 4) return;
      header = JSON.parse(
        bytes.subarray(5, 5 + bytes.readUInt32BE(1)).toString("utf8"),
      );
    }
    if (header.ok === false) rejections.push(header.e.code);
  });
  cdp.on("Runtime.exceptionThrown", (event) =>
    exceptions.push(event.exceptionDetails),
  );
  await cdp.send("Runtime.enable");
  let cases = 0;
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(locked);
  await reveal(cdp);
  await cdp.wait("!!document.querySelector('[data-testid=\"auth.login\"]')");
  await captures(cdp, name, "light", "login");
  await pin(cdp, "111111", "登录");
  await cdp.wait(`${text}.indexOf('PIN 不正确')>=0`);
  await captures(cdp, name, "light", "wrong-pin");
  cases++;
  // Pad editing keys: 清除 drops every entered digit, 退格 only the last; the PIN entered afterwards must still be exact.
  for (const key of ["9", "9", "清除", "8", "7", "退格", "退格"])
    await click(cdp, key);
  await pin(cdp, "654321", "登录");
  await cdp.wait(app);
  await connected(cdp);
  assert.equal(
    await cdp.evaluate("!!document.querySelector('button[aria-label=管理]')"),
    false,
    "ordinary user cannot see admin rail item",
  );
  await cdp.wait(
    "!!navigator.serviceWorker.controller && !!window.__talosShell",
  );
  await eventually(
    () => cdp.evaluate("window.__talosShell.status()"),
    (value) => !!value.active,
    "offline shell installed",
  );
  cases++;
  for (const theme of ["light", "dark"]) {
    await click(cdp, "设置");
    await select(cdp, "主题", theme);
    await eventually(
      () => server.readSetting("theme"),
      (value) => value === theme,
      "theme committed to real server",
    );
    await captures(cdp, name, theme, "settings");
    await closeSheet(cdp);
    for (const area of ["对话", "阅读", "音乐", "AI"]) {
      await click(cdp, area);
      await captures(
        cdp,
        name,
        theme,
        `frame-${{ 对话: "chat", 阅读: "library", 音乐: "media", AI: "ai" }[area]}`,
      );
    }
    await click(cdp, "状态");
    await connected(cdp);
    await captures(cdp, name, theme, "status-online");
    await closeSheet(cdp);
    await click(cdp, "锁定");
    await cdp.wait(locked);
    assert.equal(
      await cdp.evaluate(app),
      false,
      "lock conceals app immediately",
    );
    await captures(cdp, name, theme, "lock");
    await reveal(cdp, theme === "dark");
    await pin(cdp, "654321");
    await cdp.wait(app);
    cases++;
    await cdp.offline(true);
    await cdp.wait(`${text}.indexOf('离线')>=0`);
    await click(cdp, "设置");
    const size = theme === "light" ? "large" : "normal";
    await select(cdp, "文字大小", size);
    await cdp.wait(`${text}.indexOf('待同步')>=0`);
    await closeSheet(cdp);
    await click(cdp, "状态");
    await cdp.wait(`${text}.indexOf('1 项待同步')>=0`);
    await captures(cdp, name, theme, "status-offline-pending");
    await closeSheet(cdp);
    cases++;
    await cdp.offline(false);
    await connected(cdp);
    await eventually(
      () => server.readSetting("textSize"),
      (value) => value === size,
      "offline setting reaches SQLite",
    );
    await click(cdp, "设置");
    await cdp.wait(`${text}.indexOf('待同步')<0`);
    await closeSheet(cdp);
    cases++;
  }
  // Server-stop is a separate failure mode: navigator.onLine remains true.
  await server.stop();
  await cdp.wait(`${text}.indexOf('离线')>=0 || ${text}.indexOf('连接中')>=0`);
  await click(cdp, "设置");
  await select(cdp, "自动锁定", "15");
  await cdp.wait(`${text}.indexOf('待同步')>=0`);
  await closeSheet(cdp);
  await cdp.offline(true);
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(locked);
  await pin(cdp, "654321", "解锁");
  await cdp.wait(app);
  await cdp.wait(`${text}.indexOf('离线')>=0`);
  assert.equal(
    await cdp.evaluate(
      "!!document.querySelector('button[aria-label=AI][aria-current]')",
    ),
    true,
    "navigation persists across offline restart",
  );
  cases++;
  await server.start();
  await cdp.offline(false);
  await connected(cdp);
  await eventually(
    () => server.readSetting("idleLockMinutes"),
    (value) => value === 15,
    "crash-surviving outbox flush reaches server",
  );
  cases++;
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(locked);
  // Restoring the local gate precedes the online resume handshake. Wait for
  // resume to settle so it cannot supersede this PIN login's auth generation.
  await reveal(cdp);
  await connected(cdp);
  await pin(cdp, "654321", "解锁");
  await cdp.wait(app);
  await click(cdp, "设置");
  assert.equal(
    await cdp.evaluate(
      "Array.prototype.slice.call(document.querySelectorAll('[role=dialog] [role=group] button[aria-pressed=true]')).map(function(e){return e.textContent;}).slice(0,3).join(',')",
    ),
    "深色,标准,15 分钟",
    "settings survive reload",
  );
  await closeSheet(cdp);
  cases++;
  for (const theme of ["light", "dark"]) {
    await click(cdp, "设置");
    await select(cdp, "主题", theme);
    await eventually(
      () => server.readSetting("theme"),
      (value) => value === theme,
      "failure screenshot theme synced",
    );
    await cdp.wait(
      "!document.querySelector('[role=dialog] [data-testid=\"ui.mark\"]')",
    );
    await closeSheet(cdp);
    await rejectedOperation(cdp, server, name, theme, rejections);
    cases += 2;
  }
  await server.stop();
  const build = await server.stageRelease("e2e-real-next");
  await server.start();
  await cdp.wait(`${text}.indexOf('已连接')>=0`);
  await click(cdp, "状态");
  await cdp.wait(`${text}.indexOf('新版本已就绪')>=0`);
  for (const theme of ["light", "dark"]) {
    await closeSheet(cdp);
    await click(cdp, "设置");
    await select(cdp, "主题", theme);
    await eventually(
      () => server.readSetting("theme"),
      (value) => value === theme,
      "update screenshot theme synced",
    );
    await closeSheet(cdp);
    await click(cdp, "状态");
    await captures(cdp, name, theme, "update-ready");
  }
  await click(cdp, "应用新版本");
  await eventually(
    () =>
      cdp.evaluate(locked).catch((error) => {
        if (/Execution context|Cannot find context/.test(error.message))
          return false;
        throw error;
      }),
    (value) => value === true,
    "new release lock screen after navigation",
  );
  await cdp.wait("!!window.__talosShell");
  const updated = await eventually(
    () => cdp.evaluate("window.__talosShell.status()"),
    (value) => value.active === build && value.bootAttempts === 0,
    "new running build confirmed at stable gate",
  );
  assert.equal(updated.active, build);
  cases++;
  cases += await identityScenarios(cdp, server, name);
  // Real gateway serves a complete but non-booting build; SW must retain the
  // confirmed release and roll back without help from the broken application.
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(
    "!!window.__talosShell && !!navigator.serviceWorker.controller",
  );
  await server.stop();
  const confirmedManifest = await readFile(
    path.join(server.assets, "app/manifest.json"),
  );
  const broken = await server.stageRelease("e2e-real-broken", true);
  await server.start();
  const brokenManifest = await (
    await fetch(`${server.url}/app/manifest.json`)
  ).json();
  await cdp.evaluate(
    `window.__talosShell.install(${JSON.stringify(brokenManifest)})`,
  );
  const staged = await cdp.evaluate("window.__talosShell.status()");
  assert.equal(
    staged.active,
    build,
    "background install preserves confirmed A",
  );
  assert.equal(staged.pending, broken);
  await cdp.navigate(`${server.url}/`);
  await cdp.wait("!!window.__talosShell");
  assert.equal(
    (await cdp.evaluate("window.__talosShell.status()")).active,
    build,
    "reload does not implicitly confirm a downloaded update",
  );
  await cdp.evaluate(`window.__talosShell.apply(${JSON.stringify(broken)})`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await cdp.navigate(`${server.url}/`);
    await cdp.wait("!!document.querySelector('[data-broken]')");
    const response = await cdp.evaluate(swMessage({ type: "status" }));
    assert.equal(
      (response.value || response.status || response).bootAttempts,
      attempt,
    );
  }
  await cdp.navigate(`${server.url}/`);
  await cdp.wait("!!window.__talosShell");
  const rolledBack = await cdp.evaluate("window.__talosShell.status()");
  assert.equal(rolledBack.active, build, "real-server broken build rolls back");
  await cdp.evaluate(
    `window.__talosShell.confirmBoot(${JSON.stringify(build)})`,
  );
  // Restore the advertised release for later suites that revisit this origin.
  await server.stop();
  await writeFile(
    path.join(server.assets, "app/manifest.json"),
    confirmedManifest,
  );
  await writeFile(
    path.join(server.assets, "index.html"),
    await readFile(path.join(server.assets, "app", build, "index.html")),
  );
  await server.start();

  cases++;

  // Transport failures are expected while deliberately disconnected. Runtime exceptions never are.
  const errors = browser.errors
    .slice(startErrors)
    .filter(
      (message) =>
        !/WebSocket.*(?:failed|closed)|net::ERR_(?:INTERNET_DISCONNECTED|CONNECTION_REFUSED)|Failed to load resource/.test(
          message,
        ),
    );
  assert.deepEqual(
    errors,
    [],
    "real app has zero unexpected console errors or uncaught exceptions",
  );
  observing = false;
  console.log(
    `${name}: ${cases} real-server scenarios passed (PIN, invitation/onboarding, replacement, role, concealed lock/touch/Back, throttle/ban/revocation, profile/DND, logout/reset, ops backup/frame/offline, offline replay, rejection/retry/discard, WELCOME update).`,
  );
  return cases;
}

async function rejectedOperation(cdp, server, name, theme, rejections) {
  const rejectionCount = rejections.filter(
    (code) => code === "E_INVALID",
  ).length;
  await cdp.offline(true);
  await cdp.wait(`${text}.indexOf('离线')>=0`);
  await click(cdp, "设置");
  await select(cdp, "文字大小", "large");
  await cdp.wait(`${text}.indexOf('待同步')>=0`);
  await closeSheet(cdp);
  // Keep contract arguments valid but corrupt the LWW operation identity: the server
  // rejects its mismatch with CALL.op. Assert actual binary error replies below.
  await cdp.evaluate(
    `new Promise(function(resolve,reject){var open=indexedDB.open('talos-app');open.onerror=function(){reject(open.error);};open.onsuccess=function(){var db=open.result;var tx=db.transaction('outbox','readwrite');var store=tx.objectStore('outbox');var cursor=store.openCursor();var count=0;cursor.onsuccess=function(){var c=cursor.result;if(!c)return;var rows=c.value;if(Array.isArray(rows)){rows.forEach(function(row){if(row.method==='me.setting.set'){row.args.value.op='00000000000000000000000000';count++;}});c.update(rows);}c.continue();};tx.oncomplete=function(){db.close();if(count!==1)reject(new Error('Expected one queued setting; got '+count));else resolve(true);};tx.onerror=function(){db.close();reject(tx.error);};};})`,
  );
  await cdp.navigate(`${server.url}/`);
  await cdp.wait(locked);
  await pin(cdp, "654321", "解锁");
  await cdp.wait(app);
  await cdp.offline(false);
  await connected(cdp);
  await click(cdp, "状态");
  await cdp.wait(`${text}.indexOf('失败')>=0 && ${text}.indexOf('重试')>=0`);
  await captures(cdp, name, theme, "status-failed-op");
  await click(cdp, "重试");
  await eventually(
    () =>
      cdp.evaluate(
        `new Promise(function(resolve,reject){var open=indexedDB.open('talos-app');open.onerror=function(){reject(open.error);};open.onsuccess=function(){var db=open.result;var tx=db.transaction('outbox');var all=tx.objectStore('outbox').getAll();all.onsuccess=function(){var rows=[].concat.apply([],all.result);resolve(rows.some(function(row){return row.state==='failed'&&row.attempts>=2;}));};tx.oncomplete=function(){db.close();};};})`,
      ),
    (value) => value === true,
    "retry returned to terminal failure",
  );
  await cdp.wait(`${text}.indexOf('失败')>=0 && ${text}.indexOf('放弃')>=0`);
  assert.equal(
    rejections.filter((code) => code === "E_INVALID").length,
    rejectionCount + 2,
    "initial failure and retry both reached server and received E_INVALID",
  );
  await click(cdp, "放弃");
  await cdp.wait(`${text}.indexOf('重试')<0`);
  await closeSheet(cdp);
}
