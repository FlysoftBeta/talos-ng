import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { connectChat } from "../../harness/chat-wire.mjs";
import { click, unlock, upload, ready } from "../library/helpers.mjs";
import { libraryPdf } from "../../harness/library-pdf.mjs";
import { seedAdminUsers } from "../admin/seed.mjs";
import { OUTPUT, SCREENSHOTS } from "../../harness/artifacts.mjs";
import { eventually } from "../../harness/wait.mjs";
const app = "!!document.querySelector('[data-testid=\"app.ready\"]')";
const id = (n) => "01HRDN000000000000" + String(n).padStart(8, "0");
const readDb = (cdp, store, key) =>
  cdp.evaluate(
    `new Promise(function(resolve,reject){var q=indexedDB.open('talos-app');q.onsuccess=function(){var d=q.result;var r=d.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).get(${JSON.stringify(key)});r.onsuccess=function(){resolve(r.result);d.close()};r.onerror=function(){reject(r.error)}}})`,
  );
async function close(cdp) {
  await cdp.evaluate(
    "var ds=document.querySelectorAll('[role=dialog]');if(ds.length)ds[ds.length-1].querySelector('[aria-label=关闭]').click()",
  );
}
async function frame(cdp) {
  await cdp.evaluate(
    "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})",
  );
}
export async function hardeningSuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser,
    startErrors = browser.errors.length;
  const wire = await connectChat(server.url, "123456");
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wire.call("learning.corpus.import", {
      text: "hello#你好￥world#世界",
    });
    const initial = (await wire.call("sync.pull", { cursors: {} })).data;
    const conv = Object.keys(initial.scopes)
      .find((s) => s.startsWith("conv:"))
      .slice(5);
    const doc = (
      await wire.call("library.doc.importText", {
        title: "锚点与离线",
        body: Array.from(
          { length: 2000 },
          (_, i) => `${i} 阅读字符锚点在重排后保持位置。`,
        ).join("\n"),
      })
    ).data.doc;
    const opened = await ready(wire, doc);
    await wire.call("library.retention.set", {
      kind: "doc",
      id: doc,
      value: { v: 7, t: { ms: Date.now(), counter: 0 }, op: id(1) },
    });
    // Reproduce a cached cursor without this account's scope admission. The
    // authoritative first sync must span pages, not just one final snapshot.
    for (let n = 0; n < 250; n++)
      await wire.call("me.setting.set", {
        key: `cursor-regression.${n}`,
        value: { v: n, t: { ms: Date.now(), counter: 0 }, op: id(10000 + n) },
      });
    const personal = `me:${wire.user.id}`;
    const firstPage = (await wire.call("sync.pull", { cursors: {} })).data
      .scopes[personal];
    assert.equal(firstPage.more, true, "login regression requires pagination");
    const finalPage = (
      await wire.call("sync.pull", {
        cursors: { [personal]: firstPage.cursor },
      })
    ).data.scopes[personal];
    assert.ok(finalPage.cursor > firstPage.cursor);
    await cdp.navigate(server.url + "/");
    await cdp.wait(
      '!!document.querySelector(\'[data-testid="auth.concealed"],[data-testid="auth.numpad"] button\')',
    );
    await cdp.evaluate(`new Promise(function(resolve,reject){
      var r=indexedDB.open('talos-app');
      r.onerror=function(){reject(r.error)};
      r.onsuccess=function(){
        var db=r.result,tx=db.transaction(['scopes'],'readwrite');
        tx.objectStore('scopes').put({scope:${JSON.stringify(personal)},cursor:${finalPage.cursor}});
        tx.oncomplete=function(){db.close();resolve(true)};
        tx.onabort=function(){db.close();reject(tx.error)};
      }
    })`);
    await unlock(cdp);
    // Admission is independent of the paginated pull. Data assertions belong
    // after background synchronization, not at the moment the app first opens.
    await cdp.wait(app);
    await cdp.wait("document.body.textContent.indexOf('已连接')>=0");
    assert.ok(
      (await readDb(cdp, "scopes", personal)).cursor >= finalPage.cursor,
    );
    const admitted = await readDb(cdp, "kv", `scopes:${wire.user.id}`);
    assert.ok(
      admitted.includes(personal),
      "paginated first login admits scope",
    );
    const restoredSettings =
      await cdp.evaluate(`new Promise(function(resolve,reject){
      var r=indexedDB.open('talos-app');
      r.onerror=function(){reject(r.error)};
      r.onsuccess=function(){
        var db=r.result,q=db.transaction('rows').objectStore('rows').getAll();
        q.onsuccess=function(){db.close();resolve(q.result.filter(function(row){
          return row.scope===${JSON.stringify(personal)} && row.type==='setting' && row.id.indexOf('cursor-regression.')===0;
        }).length)};
        q.onerror=function(){db.close();reject(q.error)};
      }
    })`);
    assert.equal(
      restoredSettings,
      250,
      "all pages are eventually persisted after background sync",
    );
    console.log("Paginated login with a pre-existing unadmitted cursor passed");
    await cdp.wait(
      "!!navigator.serviceWorker.controller && !!window.__talosShell",
    );
    await eventually(
      () => cdp.evaluate("window.__talosShell.status()"),
      (x) => !!x.active,
      "cached shell",
    );
    await click(cdp, "阅读");
    await click(cdp, "锚点与离线");
    await cdp.wait("!!document.querySelector('[data-testid=\"reader.flow\"]')");
    await eventually(
      () => readDb(cdp, "file_heads", opened.pack.id),
      (x) => x?.state === "complete",
      "retained pack",
    );
    // Character anchoring uses real DOM line geometry at two tablet widths.
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop=450",
    );
    await frame(cdp);
    const savedPosition = async () => {
      const db = new DatabaseSync(path.join(server.data, "talos.db"));
      try {
        const row = db
          .prepare("SELECT body FROM library_states WHERE user_id=? AND id=?")
          .get(wire.user.id, doc);
        return row && JSON.parse(row.body).resume?.v;
      } finally {
        db.close();
      }
    };
    const anchor = await eventually(
      savedPosition,
      (value) => value?.charOffset > 0,
      "character position persisted",
    );
    // Preserve the character's actual on-screen inset, including a partially read
    // line. Assuming zero would snap every same-layout reopen to the next line.
    const characterPosition = () =>
      cdp.evaluate(
        `(function(){var viewport=document.querySelector('[data-testid="reader.scroll"]'), element=viewport.querySelector('[data-reader-unit="${anchor.unit}"] [data-testid="reader.flow"]'), range=document.createRange();range.setStart(element.firstChild,${anchor.charOffset});range.setEnd(element.firstChild,${anchor.charOffset + 1});return range.getBoundingClientRect().top-viewport.getBoundingClientRect().top-viewport.clientTop})()`,
      );
    const initialInset = await characterPosition();
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 768,
      height: 1024,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await frame(cdp);
    await click(cdp, "对话");
    await click(cdp, "阅读");
    await cdp.wait("!!document.querySelector('[data-testid=\"reader.flow\"]')");
    await frame(cdp);
    const reflow = await savedPosition();
    const displacement = (await characterPosition()) - initialInset;
    assert.ok(
      Math.abs(displacement) < 2,
      `character restore displacement ${displacement}px`,
    );
    assert.equal(reflow.unitId, anchor.unitId);
    assert.equal(
      reflow.charOffset,
      anchor.charOffset,
      "exact character survives reflow and remount",
    );
    await cdp.offline(true);
    // Exercise cold SW reload and persisted navigation for every product area.
    for (const label of [
      "对话",
      "阅读",
      "学习",
      "音乐",
      "AI",
      "管理",
      "任务",
    ]) {
      console.log("Offline matrix", label);
      await click(cdp, label);
      await frame(cdp);
      await cdp.navigate(server.url + "/");
      await unlock(cdp);
      await cdp.wait(app);
      const readyArea = {
        对话: '[data-testid="chat.list"]',
        阅读: '[data-testid="reader.flow"]',
        学习: '[data-testid="learning.page"]',
        音乐: '[data-testid="media.content"]',
        AI: '[data-testid="ai.list"]',
        管理: "[aria-label=管理栏目]",
        任务: "[role=dialog]",
      }[label];
      await cdp.wait(`!!document.querySelector(${JSON.stringify(readyArea)})`);
      await frame(cdp);
      assert.equal(
        await cdp.evaluate("document.body.textContent.indexOf('离线')>=0"),
        true,
        `${label} offline state`,
      );
      await cdp.screenshot(
        path.join(
          SCREENSHOTS,
          `${legacy ? "chrome70" : "current"}-hardening-offline-${label}.png`,
        ),
      );
      if (label === "管理" || label === "任务") await close(cdp);
    }
    const session = await readDb(cdp, "session", "active"),
      device = await readDb(cdp, "session", "device");
    const sql = new DatabaseSync(path.join(server.data, "talos.db"));
    const word = sql.prepare("SELECT id FROM learning_words LIMIT 1").get().id;
    sql.close();
    const stamp = (n) => ({ op: id(n), t: { ms: Date.now(), counter: n } });
    const operations = [
      {
        method: "chat.post.send",
        args: {
          id: id(10),
          conversation: conv,
          kind: "text",
          text: "offline matrix",
        },
      },
      {
        method: "library.favourite.set",
        args: { doc, value: { v: true, ...stamp(11) } },
      },
      {
        method: "learning.answer.record",
        args: {
          word,
          device,
          counter: { learned: 1, wrong: 0, answered: 1, lastAt: Date.now() },
        },
      },
      { method: "media.stopAtEnd.set", args: { value: true, ...stamp(13) } },
      {
        method: "library.favourite.set",
        args: { doc: id(99), value: { v: true, ...stamp(14) } },
      },
    ].map((o, i) => ({
      ...o,
      op: id(10 + i),
      createdAt: Date.now() + i,
      attempts: 0,
      state: "pending",
    }));
    // Seed durable intents while offline; the real production outbox performs replay.
    await cdp.evaluate(
      `new Promise(function(r){var q=indexedDB.open('talos-app');q.onsuccess=function(){var d=q.result;var t=d.transaction('outbox','readwrite');t.objectStore('outbox').put(${JSON.stringify(operations)},${JSON.stringify(session.user.id)});t.oncomplete=function(){d.close();r()}}})`,
    );
    await cdp.navigate(server.url + "/");
    await unlock(cdp);
    await cdp.offline(false);
    await eventually(
      () => readDb(cdp, "outbox", session.user.id),
      (x) => x?.length === 1 && x[0].state === "failed",
      "four ordered acknowledgements and one rejected operation",
    );
    const verify = new DatabaseSync(path.join(server.data, "talos.db"));
    const replay = verify
      .prepare(
        "SELECT method FROM ops WHERE op IN (?,?,?,?) ORDER BY created,rowid",
      )
      .all(...operations.slice(0, 4).map((o) => o.op));
    verify.close();
    assert.deepEqual(
      replay.map((r) => r.method),
      operations.slice(0, 4).map((o) => o.method),
    );
    await click(cdp, "状态");
    await cdp.wait(
      "document.body.textContent.indexOf('放弃')>=0 && document.body.textContent.indexOf('重试')>=0",
    );
    await click(cdp, "放弃");
    await close(cdp);
    // Artificial pressure: reconstructible content is evicted; retained pack survives.
    await cdp.evaluate(
      "new Promise(function(r){var q=indexedDB.open('talos-app');q.onsuccess=function(){var d=q.result,t=d.transaction(['kv','cache_entries'],'readwrite');t.objectStore('kv').put('x'.repeat(4096),'feature:fixture:ai:full:cached:1');t.objectStore('cache_entries').put({key:'feature:fixture:ai:full:cached:1',bytes:8192,accessed:0});t.oncomplete=function(){d.close();r()}}})",
    );
    await cdp.evaluate(
      "Object.defineProperty(navigator.storage,'estimate',{configurable:true,value:function(){return Promise.resolve({usage:8192,quota:4096})}})",
    );
    await click(cdp, "阅读");
    await click(cdp, "对话");
    await click(cdp, "阅读");
    await eventually(
      () => readDb(cdp, "kv", "feature:fixture:ai:full:cached:1"),
      (value) => value === undefined,
      "quota cache eviction",
    );
    assert.equal(
      (await readDb(cdp, "file_heads", opened.pack.id)).state,
      "complete",
    );
    assert.deepEqual(browser.errors.slice(startErrors), []);
    if (!legacy) await performanceRun(cdp, server, wire, conv);
  } finally {
    wire.close();
    await cdp.offline(false);
  }
}
async function performanceRun(cdp, server, wire, conv) {
  for (let n = 0; n < 500; n++)
    await wire.call("chat.post.send", {
      id: id(1000 + n),
      conversation: conv,
      kind: "text",
      text: `性能消息 ${n}`,
    });
  const pdf = await upload(wire, libraryPdf(500), "性能五百页 PDF", "500.pdf");
  await ready(wire, pdf.doc);
  seedAdminUsers(server);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const version = (await cdp.send("Browser.getVersion")).product;
  const values = {};
  const measure = async (name, action, ready) => {
    const start = Date.now();
    await action();
    await cdp.wait(ready);
    await frame(cdp);
    values[name] = Date.now() - start;
  };
  await measure(
    "SW boot",
    () => cdp.navigate(server.url + "/"),
    "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
  );
  await unlock(cdp);
  await cdp.evaluate(
    "window.__longTasks=[];new PerformanceObserver(function(list){list.getEntries().forEach(function(e){window.__longTasks.push(e.duration)})}).observe({entryTypes:['longtask']})",
  );
  await click(cdp, "对话");
  const name = (await wire.call("community.group.list", {})).data;
  const conversation = Array.isArray(name)
    ? name.find((v) => v.id === conv)
    : name.conversations?.find((v) => v.id === conv);
  await measure(
    "500-post conversation",
    () => click(cdp, conversation?.name ?? "广场"),
    "!!document.querySelector('[data-testid=\"chat.post\"]') && !document.querySelector('[data-testid=\"chat.loader\"]')",
  );
  values["Conversation scroll longest task"] = await scrollBudget(
    cdp,
    '[data-testid="chat.history"] [data-testid="ui.virtual-list"]',
  );
  await click(cdp, "阅读");
  await measure(
    "500-page PDF",
    () => click(cdp, "性能五百页 PDF"),
    "!!document.querySelector('[data-page-ready=true]')",
  );
  values["PDF scroll longest task"] = await scrollBudget(
    cdp,
    '[data-testid="reader.scroll"]',
  );
  await click(cdp, "管理");
  await measure(
    "2000-user grid",
    () => click(cdp, "用户"),
    "!!document.querySelector('[role=table][aria-rowcount=\"2002\"]')",
  );
  values["Grid scroll longest task"] = await scrollBudget(
    cdp,
    '[data-testid="admin.users.grid"] [data-testid="ui.virtual-list"]',
  );
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(
    path.join(OUTPUT, "PERFORMANCE.md"),
    `Measured ${new Date().toISOString()} on ${version} with CDP CPU throttling ×6. Wall time includes automation dispatch and two animation frames. SW boot measures the interactive concealment screen; PIN entry is excluded. Real server fixtures: 500 posts, 500 PDF pages, 2,000 additional users.\n\n| Scenario | ms |\n|---|---:|\n${Object.entries(
      values,
    )
      .map(([key, value]) => `| ${key} | ${value} |`)
      .join(
        "\n",
      )}\n\nScroll samples drive 12 animation frames and allow 250 ms for observer delivery. Zero means no Long Tasks API entries (tasks of at least 50 ms), not zero CPU work. Conversation rendering reuses its date formatter to avoid per-row construction. Reproduce with node tools/e2e/run.mjs hardening after building the shell and client.\n`,
  );
  console.log("Hardening performance", values);
  for (const [scenario, duration] of Object.entries(values))
    assert.ok(
      duration <= (scenario.includes("scroll") ? 200 : 2000),
      `${scenario} exceeded budget: ${duration}ms`,
    );
}

async function scrollBudget(cdp, selector) {
  await cdp.evaluate(
    `window.__longTasks=[];new Promise(function(resolve){var node=document.querySelector(${JSON.stringify(selector)}), step=0;if(!node||node.scrollHeight<=node.clientHeight)throw Error('Performance fixture is not scrollable: '+${JSON.stringify(selector)});function next(){node.scrollTop=(node.scrollHeight-node.clientHeight)*(++step/12); if(step<12)requestAnimationFrame(next);else setTimeout(resolve,250)}requestAnimationFrame(next)})`,
  );
  return cdp.evaluate("Math.max(0,...window.__longTasks)");
}
