import assert from "node:assert/strict";
import { eventually } from "../../harness/wait.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectChat } from "../../harness/chat-wire.mjs";
import {
  text,
  click,
  fill,
  unlock,
  close,
  upload,
  ready,
  captures,
} from "./helpers.mjs";
import { sharingPicker } from "./overlays.mjs";
import { pagePlacement } from "./placement.mjs";
import { libraryPdf } from "../../harness/library-pdf.mjs";

/** Same real-server scenarios run on current Chromium and the actual Chromium 70. */
export async function librarySuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser;
  const name = legacy ? "chrome70" : "current";
  const errors = browser.errors.length;
  const leaveReader = async () => {
    const visible = `Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).some(function(b){return b.getAttribute('aria-label')==='添加'&&b.getClientRects().length>0;})`;
    for (let i = 0; i < 10 && !(await cdp.evaluate(visible)); i++) {
      await click(cdp, "返回");
      await cdp.evaluate("new Promise(function(r){requestAnimationFrame(r);})");
    }
    assert.equal(
      await cdp.evaluate(visible),
      true,
      "leave reader focus mode before using library menus",
    );
  };
  const contexts = new Set();
  cdp.on("Runtime.executionContextCreated", ({ context }) =>
    contexts.add(context.id),
  );
  cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) =>
    contexts.delete(executionContextId),
  );
  cdp.on("Runtime.executionContextsCleared", () => contexts.clear());
  await cdp.send("Runtime.enable");
  const directory = await mkdtemp(
    path.join(tmpdir(), "talos-library-fixtures-"),
  );
  let wire, second;
  try {
    wire = await connectChat(server.url, "123456");
    second = await connectChat(server.url, "654321");
    await cdp.navigate(server.url + "/");
    await unlock(cdp);
    await cdp.wait(`${text}.indexOf('已连接')>=0`);
    await click(cdp, "阅读");
    await cdp.wait(
      `${text}.indexOf('我的书架')>=0 && ${text}.indexOf('我的收藏')>=0`,
    );
    await click(cdp, "我的收藏");
    assert.equal(
      await cdp.evaluate(
        "!!document.querySelector('.lib-collection [aria-label=分享]')",
      ),
      false,
      "built-in cannot share",
    );
    assert.equal(
      await cdp.evaluate(
        "!!document.querySelector('.lib-collection [aria-label=更多操作]')",
      ),
      false,
      "built-in cannot delete",
    );
    await captures(cdp, name, "home");
    await click(cdp, "添加");
    await click(cdp, "导入文档");
    await fill(cdp, "标题", "离线阅读测试");
    await fill(
      cdp,
      "正文",
      Array.from(
        { length: 1000 },
        (_, i) => `第${i + 1}段：春风吹过校园，阅读让世界更加宽广。`,
      ).join("\n\n"),
    );
    await captures(cdp, name, "import");
    await click(cdp, "开始导入");
    await cdp.wait(`${text}.indexOf('任务')>=0`);
    if (await cdp.evaluate("!!document.querySelector('[role=dialog]')"))
      await close(cdp);
    await cdp.wait(`${text}.indexOf('离线阅读测试')>=0`);
    await cdp.wait(`${text}.indexOf('正在转换')<0`);
    await click(cdp, "离线阅读测试");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"reader.scroll\"]')",
    );
    await captures(cdp, name, "text");
    await click(cdp, "收藏");
    await click(cdp, "离线保留");
    await click(cdp, "7 天");
    await click(cdp, "保存策略");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await click(cdp, "离线保留");
    await cdp.wait(`${text}.indexOf('已保留')>=0`);
    await captures(cdp, name, "retention");
    await close(cdp);
    const pdfPath = path.join(directory, "中文.pdf");
    await writeFile(pdfPath, libraryPdf(2));
    // Leave reader focus mode before opening a menu in the library pane.
    await leaveReader();
    await click(cdp, "添加");
    await click(cdp, "导入文档");
    await click(cdp, "PDF");
    await fill(cdp, "标题", "中文 PDF");
    const tree = await cdp.send("DOM.getDocument");
    const input = await cdp.send("DOM.querySelector", {
      nodeId: tree.root.nodeId,
      selector: 'input[type="file"]',
    });
    await cdp.send("DOM.setFileInputFiles", {
      nodeId: input.nodeId,
      files: [pdfPath],
    });
    await click(cdp, "开始导入");
    await cdp.wait("!!document.querySelector('[role=dialog]')");
    await close(cdp);
    const smallRow = await eventually(
      async () => {
        const pull = (await wire.call("sync.pull", { cursors: {} })).data;
        return Object.values(pull.scopes)
          .flatMap((scope) => scope.rows)
          .find(
            (row) => row.type === "libraryDoc" && row.data.title === "中文 PDF",
          );
      },
      (value) => !!value,
      "PDF import published",
    );
    const small = { doc: smallRow.id };
    const large = await upload(wire, libraryPdf(500), "五百页 PDF", "500.pdf");
    await ready(wire, small.doc);
    await ready(wire, large.doc);
    await click(cdp, "状态");
    await cdp.wait(`${text}.indexOf('完成')>=0`);
    await captures(cdp, name, "tasks");
    await close(cdp);
    await click(cdp, "阅读");
    await click(cdp, "中文 PDF");
    await cdp.wait(
      "!!document.querySelector('[data-page-ready][aria-label=\"文档第 1 页\"]')",
    );
    await cdp.wait("!!document.querySelector('[data-page-ready=true]')");
    await pagePlacement(cdp);
    await eventually(
      async () => {
        for (const contextId of contexts) {
          try {
            const result = await cdp.send("Runtime.evaluate", {
              contextId,
              returnByValue: true,
              expression:
                "(function(){if(parent===window||document.body.textContent.indexOf('你好世界')<0)return false;var r=document.createRange();r.selectNodeContents(document.body);var s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString().indexOf('你好世界')>=0})()",
            });
            if (result.result.value) return true;
          } catch {
            /* A virtualized frame may have just unloaded. */
          }
        }
        return false;
      },
      (value) => value,
      "PDF selectable CJK text",
    );
    const wheelStart = await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop",
    );
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 600,
      y: 250,
      deltaX: 0,
      deltaY: 120,
    });
    await cdp.wait(
      `document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop>${wheelStart}`,
    );
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop=0",
    );
    const keyStart = await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop",
    );
    for (const contextId of contexts) {
      try {
        const key = await cdp.send("Runtime.evaluate", {
          contextId,
          returnByValue: true,
          expression:
            "(function(){if(parent===window||document.body.textContent.indexOf('你好世界')<0)return false;dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'}));return true})()",
        });
        if (key.result.value) break;
      } catch {
        /* A scrolled-out frame can unload between context events. */
      }
    }
    await cdp.wait(
      `document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop>${keyStart}`,
    );
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop=0",
    );
    const dragStart = await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop",
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 600, y: 350 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 600, y: 250 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.wait(
      `document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop>${dragStart}`,
    );
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop=0",
    );
    await captures(cdp, name, "pdf");
    await click(cdp, "更多操作");
    await click(cdp, "详情");
    await cdp.wait("!!document.querySelector('[role=dialog]')");
    const metadata = await cdp.evaluate(
      "document.querySelector('[role=dialog]').textContent",
    );
    for (const expected of [
      "中文 PDF",
      "页数",
      "最远阅读",
      "阅读时长",
      "导入时间",
    ])
      assert.ok(metadata.includes(expected), `metadata includes ${expected}`);
    assert.equal(
      await cdp.evaluate(
        "Array.prototype.slice.call(document.querySelectorAll('[role=dialog] [data-testid=\"ui.keyvalue\"]')).find(function(n){return n.querySelector('[data-testid=\"ui.keyvalue.label\"]').textContent==='页数'}).querySelector('[data-testid=\"ui.keyvalue.value\"]').textContent",
      ),
      "2",
      "metadata page count comes from the imported PDF",
    );
    await captures(cdp, name, "metadata");
    await close(cdp);
    await click(cdp, "离线保留");
    await click(cdp, "7 天");
    await click(cdp, "保存策略");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await click(cdp, "离线保留");
    await cdp.wait(`${text}.indexOf('已保留')>=0`);
    await close(cdp);
    await click(cdp, "阅读");
    await click(cdp, "五百页 PDF");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"reader.scroll\"]')",
    );
    await cdp.evaluate(
      "new Promise(function(resolve){var n=0;function step(){var s=document.querySelector('[data-testid=\"reader.scroll\"]');var u=s.querySelector('[data-reader-unit]');s.scrollTop=(++n)*u.getBoundingClientRect().height;s.dispatchEvent(new Event('scroll'));if(n===50)return resolve(true);requestAnimationFrame(step)}step()})",
    );
    await fill(cdp, "跳转页码", "50");
    await cdp.evaluate(
      "(function(){var e=document.querySelector('[aria-label=跳转页码]');e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()",
    );
    await cdp.wait("!!document.querySelector('[data-reader-unit=\"49\"]')");
    assert.ok(
      await cdp.evaluate(
        "document.querySelectorAll('[data-reader-unit]').length<=12",
      ),
      "500-page pack mounted window bounded",
    );
    await captures(cdp, name, "pdf-window");
    await leaveReader();
    await click(cdp, "书单");
    await click(cdp, "添加");
    await click(cdp, "新建书单");
    await fill(cdp, "书单名称", "共享书单");
    await click(cdp, "创建书单");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await click(cdp, "共享书单");
    await click(cdp, "我的离线保留");
    await fill(cdp, "保留天数", "7");
    await click(cdp, "保存设置");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    assert.equal(
      await cdp.evaluate("!!document.querySelector('[aria-label=添加文档]')"),
      false,
      "no destination-side add control",
    );
    const collection = (
      await wire.call("sync.pull", { cursors: {} })
    ).data.scopes[`me:${wire.user.id}`].rows.find(
      (row) =>
        row.type === "libraryCollection" && row.data.title === "共享书单",
    ).id;
    // Personal policy is queued; deleting its collection before acceptance creates
    // a legitimate failed operation that must remain visible in the outbox.
    await eventually(
      async () =>
        (await wire.call("sync.pull", { cursors: {} })).data.scopes[
          `me:${wire.user.id}`
        ].rows.find(
          (row) => row.type === "libraryRetention" && row.id === collection,
        )?.data.value?.v,
      (value) => value === 7,
      "personal collection retention acknowledged before collection deletion",
    );
    await click(cdp, "最近");
    await click(cdp, "我的书架");
    for (const title of ["中文 PDF", "五百页 PDF"]) {
      await click(cdp, `更多操作 ${title}`);
      await click(cdp, "转存到书单");
      await fill(cdp, "目标书单", collection);
      await click(cdp, "确认转存");
      await cdp.wait("!document.querySelector('[role=dialog]')");
    }
    await click(cdp, "书单");
    await click(cdp, "共享书单");
    await click(cdp, "更多操作 五百页 PDF");
    await click(cdp, "上移");
    await captures(cdp, name, "collection");
    await click(cdp, "分享");
    await captures(cdp, name, "sharing");
    await sharingPicker(cdp, name);
    await close(cdp);
    await wire.call("library.sharing.set", {
      collection,
      principalType: "user",
      principal: second.user.id,
      level: "read",
      delegate: false,
    });
    await second.call("library.doc.open", { doc: small.doc });
    await assert.rejects(
      second.call("library.collection.items", { collection, docs: [] }),
      (e) => e.code === "E_DENIED",
    );
    await wire.call("library.sharing.set", {
      collection,
      principalType: "user",
      principal: second.user.id,
      level: "write",
      delegate: false,
    });
    await second.call("library.collection.items", { collection, docs: [] });
    await click(cdp, "更多操作");
    await click(cdp, "删除书单");
    await cdp.wait(`${text}.indexOf('共享书单')>=0`);
    await click(cdp, "确认删除");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await click(cdp, "最近");
    await click(cdp, "五百页 PDF");
    const uncachedPack = (
      await wire.call("library.doc.describe", { doc: large.doc })
    ).data.pack.id;
    await cdp.offline(true);
    await server.stop();
    // Viewing or a temporary collection policy can cache the whole small fixture
    // pack, including unvisited pages. Evict only this unretained PDF's bytes so
    // the following missing-content assertion has a deterministic precondition.
    await cdp.evaluate(`new Promise(function(resolve,reject){
      var r=indexedDB.open('talos-app');
      r.onerror=function(){reject(r.error)};
      r.onsuccess=function(){
        var db=r.result, rid=${JSON.stringify(uncachedPack)};
        var tx=db.transaction(['file_heads','file_chunks','file_owners','file_leases'],'readwrite');
        tx.oncomplete=function(){db.close();resolve(true)};
        tx.onabort=function(){db.close();reject(tx.error)};
        tx.objectStore('file_heads').delete(rid);
        tx.objectStore('file_leases').delete(rid);
        var chunks=tx.objectStore('file_chunks').openCursor(IDBKeyRange.bound([rid,0],[rid,Number.MAX_SAFE_INTEGER]));
        chunks.onsuccess=function(){var cursor=chunks.result;if(cursor){cursor.delete();cursor.continue()}};
        var owners=tx.objectStore('file_owners').index('rid').openCursor(IDBKeyRange.only(rid));
        owners.onsuccess=function(){var cursor=owners.result;if(cursor){cursor.delete();cursor.continue()}};
      }
    })`);
    await cdp.navigate(server.url + "/");
    await unlock(cdp);
    await cdp.wait(`${text}.indexOf('离线未缓存')>=0`);
    await click(cdp, "阅读");
    await click(cdp, "中文 PDF");
    await cdp.wait("!!document.querySelector('[data-page-ready]')");
    await captures(cdp, name, "offline-pdf");
    await click(cdp, "阅读");
    await click(cdp, "离线阅读测试");
    await cdp.wait(`${text}.indexOf('春风吹过校园')>=0`);
    await click(cdp, "取消收藏");
    await cdp.evaluate(
      "var s=document.querySelector('[data-testid=\"reader.scroll\"]');s.scrollTop=1000;s.dispatchEvent(new Event('scroll'))",
    );
    await captures(cdp, name, "offline-text");
    const beforeRestore = await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop",
    );
    await eventually(
      () =>
        cdp.evaluate(
          "new Promise(function(resolve,reject){var r=indexedDB.open('talos-app');r.onsuccess=function(){var db=r.result;var q=db.transaction('outbox').objectStore('outbox').getAll();q.onsuccess=function(){db.close();resolve(q.result.some(function(items){return items.some(function(row){return row.method==='library.progress.set'&&row.args.resume.v.offset>0})}))};q.onerror=function(){db.close();reject(q.error)}};r.onerror=function(){reject(r.error)}})",
        ),
      (value) => value,
      "offline reading position persisted",
    );
    await cdp.navigate(server.url + "/");
    await unlock(cdp);
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"reader.scroll\"]')",
    );
    await eventually(
      () =>
        cdp.evaluate(
          "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop",
        ),
      (value) => Math.abs(value - beforeRestore) < 3,
      "exact reader position restored after offline restart",
    );
    await server.start();
    await cdp.offline(false);
    await cdp.wait(`${text}.indexOf('已连接')>=0`);
    await eventually(
      () =>
        cdp.evaluate(
          "new Promise(function(resolve,reject){var r=indexedDB.open('talos-app');r.onsuccess=function(){var db=r.result;var q=db.transaction('outbox').objectStore('outbox').getAll();q.onsuccess=function(){db.close();resolve(q.result.every(function(items){return items.length===0}))};q.onerror=function(){db.close();reject(q.error)}};r.onerror=function(){reject(r.error)}})",
        ),
      (value) => value,
      "queued library writes acknowledged",
      30000,
    );
    wire.close();
    wire = await connectChat(server.url, "123456");
    const synced = (await wire.call("sync.pull", { cursors: {} })).data.scopes[
      `me:${wire.user.id}`
    ].rows;
    const textId = synced.find(
      (row) => row.type === "libraryDoc" && row.data.title === "离线阅读测试",
    ).id;
    const progress = synced.find(
      (row) => row.type === "libraryState" && row.id === textId,
    ).data;
    assert.equal(
      progress.favourite.v,
      false,
      "offline favourite reached server",
    );
    assert.ok(progress.resume.v.offset > 0, "offline position reached server");

    await click(cdp, "阅读");
    await click(cdp, "中文 PDF");
    await click(cdp, "更多操作");
    await click(cdp, "删除文档");
    await cdp.wait(`${text}.indexOf('中文 PDF')>=0`);
    await click(cdp, "确认删除");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    const temporary = (
      await wire.call("library.collection.create", { title: "最后容器" })
    ).data.id;
    const orphan = (
      await wire.call("library.doc.importText", {
        title: "移出即回收",
        body: "仅在最后容器中的书",
        collection: temporary,
      })
    ).data.doc;
    await ready(wire, orphan);
    await click(cdp, "书单");
    await click(cdp, "最后容器");
    await click(cdp, "更多操作 移出即回收");
    await click(cdp, "移出书单");
    await cdp.wait(
      "document.querySelector('.lib-collection').textContent.indexOf('书单还是空的')>=0",
    );
    await assert.rejects(
      wire.call("library.doc.open", { doc: orphan }),
      (error) => error.code === "E_DENIED",
    );
    const reclaimed = (await wire.call("sync.pull", { cursors: {} })).data
      .scopes[`me:${wire.user.id}`].rows;
    assert.ok(
      reclaimed.some(
        (row) => row.type === "libraryDoc" && row.id === orphan && row.deleted,
      ),
      "last-container removal is a durable tombstone",
    );
    assert.deepEqual(
      browser.errors.slice(errors),
      [],
      "library has no browser exceptions",
    );
    console.log(
      `${name}: library real PDF/text import, 500-page window, grants, offline restart, queued favourite/progress, source transfers and last-container reclamation passed.`,
    );
  } finally {
    wire?.close();
    second?.close();
    await cdp.offline(false);
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}
