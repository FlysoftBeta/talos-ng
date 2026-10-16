import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";
import { eventually, WAIT_TIMEOUT } from "../../harness/wait.mjs";
const text = "document.body.textContent";
async function click(cdp, label) {
  await cdp.wait(
    `Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}||(b.querySelector('[data-testid=\"ui.row.title\"]')&&b.querySelector('[data-testid=\"ui.row.title\"]').textContent===${JSON.stringify(label)})})`,
  );
  await cdp.evaluate(
    `(function(){var labeled=document.querySelector('button[aria-label='+JSON.stringify(${JSON.stringify(label)})+']');var b=labeled||Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(b){return b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}||(b.querySelector('[data-testid=\"ui.row.title\"]')&&b.querySelector('[data-testid=\"ui.row.title\"]').textContent===${JSON.stringify(label)})}).pop();b.click()})()`,
  );
}
async function fill(cdp, label, value) {
  if (
    label === "曲目来源" ||
    label === "曲目" ||
    label === "目标歌单" ||
    label === "歌曲保留天数"
  ) {
    await cdp.evaluate(
      `(function(){var trigger=Array.prototype.slice.call(document.querySelectorAll('button[aria-haspopup=listbox]')).find(function(b){var l=document.getElementById(b.getAttribute('aria-labelledby').split(' ')[0]);return l&&l.textContent===${JSON.stringify(label)}});if(!trigger)throw Error('Missing picker '+${JSON.stringify(label)});trigger.click()})()`,
    );
    await cdp.wait("!!document.querySelector('[role=listbox] [role=option]')");
    await cdp.evaluate(
      `(function(){var trigger=Array.prototype.slice.call(document.querySelectorAll('button[aria-haspopup=listbox]')).find(function(b){var l=document.getElementById(b.getAttribute('aria-labelledby').split(' ')[0]);return l&&l.textContent===${JSON.stringify(label)}});if(!trigger)throw Error('Missing picker '+${JSON.stringify(label)});var box=document.querySelector('[role=listbox][aria-labelledby=\"'+trigger.getAttribute('aria-labelledby').split(' ')[0]+'\"]');var option=Array.prototype.slice.call(box.querySelectorAll('[role=option]')).find(function(e){return e.getAttribute('data-value')===${JSON.stringify(String(value))}});if(!option)throw Error('Missing option');option.click()})()`,
    );
    return;
  }
  await cdp.evaluate(
    `(function(){var l=Array.prototype.slice.call(document.querySelectorAll('label')).find(function(x){return (x.querySelector('span')?x.querySelector('span').textContent:x.textContent).trim()===${JSON.stringify(label)}});var e=l?l.querySelector('input,select')||document.getElementById(l.htmlFor):document.querySelector('input[aria-label='+JSON.stringify(${JSON.stringify(label)})+']');var setter=Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
}
async function unlock(cdp, pin = "123456") {
  await cdp.wait(
    '!!document.querySelector(\'[data-testid="auth.concealed"],[data-testid="auth.numpad"] button\')',
  );
  if (
    await cdp.evaluate(
      "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
    )
  ) {
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
  }
  await cdp.wait(
    "!!document.querySelector('[data-testid=\"auth.numpad\"] button')",
  );
  for (const n of pin) await click(cdp, n);
  await cdp.wait("!!document.querySelector('[data-testid=\"app.ready\"]')");
}
async function capture(cdp, browser, state) {
  for (const theme of ["浅色", "深色"]) {
    await click(cdp, "设置");
    await cdp.wait("!!document.querySelector('[role=group][aria-label=主题]')");
    await cdp.evaluate(
      `(function(){var g=document.querySelector('[role=group][aria-label=主题]');Array.prototype.slice.call(g.querySelectorAll('button')).find(function(b){return b.textContent.trim()===${JSON.stringify(theme)}}).click()})()`,
    );
    await cdp.evaluate(
      "document.querySelector('[role=dialog] button[aria-label=关闭]').click()",
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
      await cdp.evaluate(
        "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})",
      );
      assert.equal(
        await cdp.evaluate("document.documentElement.scrollWidth<=innerWidth"),
        true,
        `media ${state} overflow`,
      );
      await cdp.screenshot(
        path.join(
          SCREENSHOTS,
          `${browser}-media-${state}-${theme === "浅色" ? "light" : "dark"}-${width}x${height}.png`,
        ),
      );
    }
  }
}
export async function mediaSuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser;
  const errorsAtStart = browser.errors.length;
  const name = legacy ? "chrome70" : "current";
  const wire = await connectChat(server.url, "123456");
  const second = await connectChat(server.url, "654321");
  try {
    const tracks = (
      await wire.call("media.search", { query: "练习曲", limit: 20 })
    ).data.tracks;
    assert.equal(tracks.length, 3);
    await wire.call("admin.settings.set", {
      maxVolume: 0.25,
    });
    const playlist = (
      await wire.call("media.playlist.create", { title: "离线歌单" })
    ).data.playlist;
    await wire.call("media.playlist.items", {
      playlist: playlist.id,
      tracks: tracks.map((t) => t.id),
    });
    await wire.call("media.playlist.share", {
      playlist: playlist.id,
      principalType: "user",
      principal: second.user.id,
      level: "read",
    });
    assert.ok(
      (await second.call("media.library.get", {})).data.playlists.some(
        (p) => p.id === playlist.id,
      ),
    );
    await cdp.navigate(server.url + "/");
    await unlock(cdp);
    await cdp.wait(`${text}.indexOf('已连接')>=0`);
    await click(cdp, "音乐");
    await capture(cdp, name, "home");
    await fill(cdp, "搜索曲目或艺人", "练习曲");
    await click(cdp, "搜索");
    await cdp.wait(`${text}.indexOf('晨光练习曲')>=0`);
    await capture(cdp, name, "search");
    await click(cdp, "更多操作 晨光练习曲");
    await click(cdp, "我的离线保留");
    await fill(cdp, "歌曲保留天数", "7");
    await click(cdp, "保存设置");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await click(cdp, "更多操作 晨光练习曲");
    await click(cdp, "加入队列 晨光练习曲");
    await click(cdp, "更多操作 夜色练习曲");
    await click(cdp, "加入队列 夜色练习曲");
    await click(cdp, "更多操作 雨后练习曲");
    await click(cdp, "加入队列 雨后练习曲");
    await eventually(
      async () =>
        (await wire.call("media.library.get", {})).data.state.queue.length,
      (n) => n === 3,
      "queue synced",
      WAIT_TIMEOUT,
    );
    await click(cdp, "晨光练习曲");
    await cdp.wait("!!document.querySelector('[data-testid=\"media.mini\"]')");
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.audio\"]').currentTime>0",
    );
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.audio\"]').volume<=0.25",
    );
    await fill(cdp, "进度", "14.5");
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.audio\"]').currentTime>=14",
    );
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.mini.play\"]').getAttribute('title').indexOf('夜色练习曲')>=0",
    );
    await click(cdp, "下一首");
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.mini.play\"]').getAttribute('title').indexOf('雨后练习曲')>=0",
    );
    assert.equal(
      (await wire.call("media.track.play", { track: tracks[0].id })).data
        .maxVolume,
      0.25,
    );
    await click(cdp, "播放队列");
    await cdp.wait("!!document.querySelector('[data-testid=\"media.queue\"]')");
    await capture(cdp, name, "queue");
    await cdp.evaluate(
      "document.querySelector('[role=dialog] button[aria-label=关闭]').click()",
    );
    await click(cdp, "离线歌单");
    await capture(cdp, name, "playlist");
    await click(cdp, "新建歌单");
    await fill(cdp, "歌单名称", "临时歌单");
    await click(cdp, "创建");
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.content.title\"]').textContent==='临时歌单'",
    );
    await click(cdp, "添加曲目");
    await fill(cdp, "曲目来源", playlist.id);
    await fill(cdp, "曲目", tracks[0].id);
    await cdp.wait(
      "(function(){var b=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] button')).find(function(x){return x.textContent.trim()==='添加'});return !!b&&!b.disabled})()",
    );
    await click(cdp, "添加");
    await eventually(
      async () => {
        const list = (
          await wire.call("media.library.get", {})
        ).data.playlists.find((p) => p.title === "临时歌单");
        return list?.tracks.length ?? 0;
      },
      (n) => n === 1,
      "playlist membership saved",
      WAIT_TIMEOUT,
    );
    await cdp.wait(
      '!!document.querySelector(\'[data-testid="media.content"] [data-testid="media.track"]\')',
    );
    await click(cdp, "我的离线保留 · 自动");
    await fill(cdp, "保留天数", "123");
    await click(cdp, "保存设置");
    await click(cdp, "分享");
    await cdp.wait("!!document.querySelector('[role=dialog]')");
    assert.equal(
      await cdp.evaluate(
        "document.querySelector('[role=dialog]').textContent.indexOf('可转授')<0",
      ),
      true,
    );
    await cdp.evaluate(
      "Array.prototype.slice.call(document.querySelectorAll('[role=dialog]')).pop().querySelector('button[aria-label=关闭]').click()",
    );
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await click(cdp, "歌单操作");
    await click(cdp, "删除歌单");
    await cdp.wait(
      "document.querySelector('[role=dialog] h2').textContent.indexOf('临时歌单')>=0",
    );
    await click(cdp, "确认删除");
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.content.title\"]').textContent!=='临时歌单'",
    );
    await click(cdp, "离线歌单");
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.content.title\"]').textContent==='离线歌单'",
    );
    await click(cdp, "我的离线保留 · 自动");
    await fill(cdp, "保留天数", "7");
    await click(cdp, "保存设置");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await eventually(
      async () => {
        const result = (await wire.call("media.library.get", {})).data;
        return result.tracks.every((t) => !!t.audio);
      },
      Boolean,
      "materialised playlist",
      WAIT_TIMEOUT,
    );
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"media.content\"] [data-testid=\"media.track\"]').length===3 && Array.prototype.every.call(document.querySelectorAll('[data-testid=\"media.content\"] [data-testid=\"media.track\"]'),function(e){return e.getAttribute('data-device-cache')==='true'})",
    );
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.audio\"]').currentTime>0",
    );
    await cdp.offline(true);
    await cdp.navigate(server.url + "/");
    await unlock(cdp);
    await click(cdp, "音乐");
    await click(cdp, "离线歌单");
    await click(cdp, "晨光练习曲");
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.audio\"]').currentTime>0",
    );
    await capture(cdp, name, "offline");
    await click(cdp, "收藏晨光练习曲");
    await click(cdp, "更多操作 晨光练习曲");
    await click(cdp, "加入队列 晨光练习曲");
    await cdp.offline(false);
    await eventually(
      async () => {
        const state = (await wire.call("media.library.get", {})).data.state;
        return (
          !!state.favorites[tracks[0].id]?.v &&
          state.queue[state.queue.length - 1] === tracks[0].id
        );
      },
      Boolean,
      "offline media edits synced",
      WAIT_TIMEOUT,
    );
    // A fresh second-user browser has only the granted playlist, no discovery path.
    await cdp.navigate("about:blank");
    await cdp.send("Storage.clearDataForOrigin", {
      origin: server.url,
      storageTypes: "indexeddb,service_workers,cache_storage",
    });
    await cdp.navigate(server.url + "/");
    await unlock(cdp, "654321");
    await click(cdp, "音乐");
    await click(cdp, "离线歌单");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"media.track\"]').length===3",
    );
    assert.equal(
      await cdp.evaluate(
        "Array.prototype.every.call(document.querySelectorAll('[data-testid=\"media.track\"]'),function(e){return e.getAttribute('data-device-cache')==='false'})",
      ),
      true,
      "read-only shared playlist defaults to no personal download",
    );
    await click(cdp, "我的离线保留 · 自动");
    await fill(cdp, "保留天数", "1");
    await click(cdp, "保存设置");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await eventually(
      async () => {
        const sync = (await second.call("sync.pull", { cursors: {} })).data;
        return sync.scopes[`me:${second.user.id}`].rows.find(
          (row) => row.type === "mediaRetention" && row.id === playlist.id,
        )?.data.value?.v;
      },
      (value) => value === 1,
      "shared reader personal retention",
      WAIT_TIMEOUT,
    );
    assert.equal(
      (await wire.call("sync.pull", { cursors: {} })).data.scopes[
        `me:${wire.user.id}`
      ].rows.find(
        (row) => row.type === "mediaRetention" && row.id === playlist.id,
      )?.data.value?.v,
      7,
      "reader cannot change owner's retention",
    );
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"media.content\"] [data-testid=\"media.track\"]').length===3 && Array.prototype.every.call(document.querySelectorAll('[data-testid=\"media.content\"] [data-testid=\"media.track\"]'),function(e){return e.getAttribute('data-device-cache')==='true'})",
    );
    await click(cdp, "晨光练习曲");
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.audio\"]').currentTime>0",
    );
    await wire.call("media.playlist.share", {
      playlist: playlist.id,
      principalType: "user",
      principal: second.user.id,
      level: null,
    });
    await cdp.wait(
      "document.querySelector('[data-testid=\"media.audio\"]').paused && document.body.textContent.indexOf('离线歌单')<0",
    );
    await cdp.wait(
      "new Promise(function(resolve){var r=indexedDB.open('talos-app');r.onsuccess=function(){var db=r.result;var q=db.transaction('file_heads').objectStore('file_heads').getAll();q.onsuccess=function(){resolve(q.result.length===0);db.close()}}})",
    );
    await cdp.offline(true);
    await cdp.navigate(server.url + "/");
    await unlock(cdp, "654321");
    await click(cdp, "音乐");
    assert.equal(
      await cdp.evaluate("document.body.textContent.indexOf('离线歌单')<0"),
      true,
    );
    await cdp.offline(false);
    assert.equal(
      browser.errors.length,
      errorsAtStart,
      browser.errors.slice(errorsAtStart).join("\n"),
    );
  } finally {
    await cdp.offline(false).catch(() => {});
    wire.close();
    second.close();
  }
}
