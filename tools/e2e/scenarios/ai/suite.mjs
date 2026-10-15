import assert from "node:assert/strict";
import path from "node:path";
import { SCREENSHOTS } from "../../harness/artifacts.mjs";
import { click, pin, reveal, select, closeSheet } from "../../harness/ui.mjs";
import { connectChat } from "../../harness/chat-wire.mjs";
async function field(cdp, label, value, textarea = false) {
  await cdp.evaluate(
    `(function(){var label=Array.prototype.slice.call(document.querySelectorAll('label')).find(function(l){return l.textContent.trim()===${JSON.stringify(label)}});var input=(label&&document.getElementById(label.htmlFor))||document.querySelector('[aria-label=${label}]');if(!input)throw new Error('Field missing: '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(${textarea ? "HTMLTextAreaElement" : "HTMLInputElement"}.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
}
async function capture(cdp, label, screen, theme) {
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
    await cdp.wait("document.documentElement.scrollWidth<=innerWidth");
    await cdp.screenshot(
      path.join(
        SCREENSHOTS,
        `${label}-ai-${screen}-${theme}-${width}x${height}.png`,
      ),
    );
  }
}
export async function aiSuite(browser, server, { legacy = false } = {}) {
  const { cdp } = browser,
    label = legacy ? "chrome70" : "current",
    seed = await connectChat(server.url, "123456");
  let scenarios = 0;
  const initialErrors = browser.errors.length;
  try {
    await cdp.navigate(server.url + "/");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
    );
    await reveal(cdp);
    await pin(cdp, "123456");
    await cdp.wait("!!document.querySelector('[data-testid=\"app.ready\"]')");
    await cdp.wait(
      "!!navigator.serviceWorker.controller && !!window.__talosShell",
    );
    await cdp.wait(
      "window.__talosShell.status().then(function(s){return !!s.active})",
    );
    await click(cdp, "AI");
    await click(cdp, "新对话");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.composer.input\"]')",
    );
    await field(cdp, "消息", "中文解释", true);
    await cdp.wait("document.body.textContent.indexOf('额度不足')>=0");
    assert.equal(
      await cdp.evaluate(
        "Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b){return b.textContent==='发送'}).disabled",
      ),
      true,
    );
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    await click(cdp, "管理");
    await click(cdp, "AI 额度与统计");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.billing\"] input')",
    );
    await click(cdp, `管理额度：${seed.user.name}`);
    await click(cdp, "分配额度");
    await cdp.evaluate(
      "document.querySelector('[role=dialog] button[aria-haspopup=listbox]').click()",
    );
    await cdp.wait(
      "document.querySelectorAll('[role=dialog] [role=option]').length>1",
    );
    await cdp.evaluate(
      `(function(){var option=Array.prototype.slice.call(document.querySelectorAll('[role=dialog] [role=option]')).find(function(e){return e.textContent.indexOf(${JSON.stringify(seed.user.name)})>=0});if(!option)throw Error('Missing AI user option');option.click()})()`,
    );
    await field(cdp, "充值额度", "100");
    await field(cdp, "充值备注", "端到端验收");
    await click(cdp, "分配额度");
    await cdp.wait(
      "document.body.textContent.indexOf('用户可用额度：100.00')>=0",
    );
    await closeSheet(cdp);
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    await click(cdp, "AI");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.composer.input\"]')",
    );
    await cdp.wait(
      "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.textContent==='发送'&&!b.disabled})",
    );
    await click(cdp, "发送");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]').length===1",
    );
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.message.rich\"] .katex') && !!document.querySelector('[data-testid=\"ai.message.rich\"] code')",
    );
    await cdp.wait("document.body.textContent.indexOf('当前对话正在生成')<0");
    assert.equal(
      await cdp.evaluate(
        "document.body.textContent.indexOf('Mermaid 图表源码（兼容模式）')>=0",
      ),
      true,
    );
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    await click(cdp, "标题与标签");
    await field(cdp, "标题", "中文学习与写作 · 流式回答");
    await field(cdp, "标签（逗号分隔）", "学习，写作");
    await click(cdp, "保存标题与标签");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await field(cdp, "搜索标题和标签", "写作");
    await cdp.wait(
      "document.querySelector('[data-testid=\"ai.list\"]').textContent.indexOf('中文学习与写作')>=0",
    );
    await field(cdp, "搜索标题和标签", "");
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    for (const theme of ["light", "dark"]) {
      await click(cdp, "设置");
      await select(cdp, "主题", theme);
      await closeSheet(cdp);
      await capture(cdp, label, "conversation", theme);
      await click(cdp, "标题与标签");
      await capture(cdp, label, "details", theme);
      await closeSheet(cdp);
    }
    await field(cdp, "消息", "创建文件", true);
    await cdp.wait(
      "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.textContent==='发送'&&!b.disabled})",
    );
    await click(cdp, "发送");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]').length===2 && document.body.textContent.indexOf('当前对话正在生成')<0",
    );
    await click(cdp, "工作区");
    await cdp.wait("document.body.textContent.indexOf('笔记/学习.md')>=0");
    await cdp.evaluate(
      "Array.prototype.slice.call(document.querySelectorAll('[role=dialog] button')).find(function(b){return b.textContent.indexOf('笔记/学习.md')>=0}).click()",
    );
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.workspace.editor\"]')",
    );
    assert.equal(
      await cdp.evaluate(
        "document.querySelector('[data-testid=\"ai.workspace.editor\"]').textContent.indexOf('学习笔记')>=0",
      ),
      true,
    );
    await capture(cdp, label, "workspace", "dark");
    await click(cdp, "编辑源码");
    await capture(cdp, label, "editor", "dark");
    await click(cdp, "预览文件");
    await closeSheet(cdp);
    await click(cdp, "设置");
    await select(cdp, "主题", "light");
    await closeSheet(cdp);
    await click(cdp, "工作区");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.workspace.editor\"]')",
    );
    await capture(cdp, label, "workspace", "light");
    await click(cdp, "编辑源码");
    await capture(cdp, label, "editor", "light");
    await click(cdp, "预览文件");
    await closeSheet(cdp);
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    const conversations = (await seed.call("sync.pull", { cursors: {} })).data;
    const conv = Object.values(conversations.scopes)
      .flatMap((s) => s.rows)
      .find(
        (r) =>
          r.type === "aiConversation" &&
          r.data.title.indexOf("中文学习与写作") >= 0,
      ).id;
    // The browser file input uses an actual File and production upload chunks.
    await cdp.evaluate(
      `(function(){var bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),function(c){return c.charCodeAt(0)});var input=document.querySelector('[data-testid=\"ai.composer\"] input[type=file]');var file=new File([bytes],'测试.png',{type:'image/png'});var transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await cdp.wait(
      "!!document.querySelector('button[aria-label=\"移除图片 1\"]')",
    );
    await field(cdp, "消息", "请看图片", true);
    await cdp.wait(
      "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.textContent==='发送'&&!b.disabled})",
    );
    await click(cdp, "发送");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]').length===3 && document.body.textContent.indexOf('当前对话正在生成')<0",
    );
    assert.equal(
      (
        await seed.call("ai.message.page", { conversation: conv })
      ).data.messages.filter((m) => m.images.length).length,
      1,
    );
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    await field(cdp, "消息", "持续生成", true);
    await cdp.wait(
      "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.textContent==='发送'&&!b.disabled})",
    );
    await click(cdp, "发送");
    await cdp.wait("document.body.textContent.indexOf('当前对话正在生成')>=0");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]').length>=4 && document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]')[3].textContent.length>40",
    );
    await click(cdp, "停止生成");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]')[3].textContent.indexOf('已停止')>=0",
    );
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    await field(cdp, "消息", "持续生成", true);
    await cdp.wait(
      "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.textContent==='发送'&&!b.disabled})",
    );
    await click(cdp, "发送");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]').length===5",
    );
    await cdp.offline(true);
    await cdp.wait(
      "document.body.textContent.indexOf('此操作需要连接服务器')>=0",
    );
    await field(cdp, "消息", "离线草稿：下次继续学习", true);
    await cdp.offline(false);
    await cdp.wait("document.body.textContent.indexOf('当前对话正在生成')>=0");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]')[4].textContent.length>200",
    );
    await click(cdp, "停止生成");
    await cdp.wait(
      "document.querySelectorAll('[data-testid=\"ai.message\"][data-role=assistant]')[4].textContent.indexOf('已停止')>=0",
    );
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    await cdp.offline(true);
    await cdp.wait(
      "document.body.textContent.indexOf('此操作需要连接服务器')>=0",
    );
    await cdp.navigate(server.url + "/");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"auth.concealed\"]')",
    );
    await reveal(cdp);
    await pin(cdp, "123456");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.composer.input\"]')",
    );
    assert.equal(
      await cdp.evaluate(
        "document.querySelector('[data-testid=\"ai.composer.input\"]').value",
      ),
      "离线草稿：下次继续学习",
    );
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.message.rich\"] .katex')",
    );
    assert.equal(
      await cdp.evaluate(
        "document.body.textContent.indexOf('const answer = 42')>=0",
      ),
      true,
    );
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    await cdp.offline(false);
    await cdp.wait(
      "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.getAttribute('aria-label')==='从此创建分支'&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'})",
    );
    await click(cdp, "从此创建分支");
    await cdp.wait(
      "document.querySelector('[data-testid=\"ai.conversation.title\"]').textContent.indexOf('分支')>=0",
    );
    scenarios++;
    console.log(`AI scenario ${scenarios} passed`);
    await field(cdp, "消息", "长回答", true);
    await cdp.evaluate(
      "window.__aiFrames=[];window.__aiMeasure=true;(function tick(last){requestAnimationFrame(function(now){if(last)window.__aiFrames.push(now-last);if(window.__aiMeasure)tick(now);});})(0)",
    );
    await cdp.wait(
      "Array.prototype.slice.call(document.querySelectorAll('button')).some(function(b){return b.textContent==='发送'&&!b.disabled})",
    );
    await click(cdp, "发送");
    await cdp.wait(
      'document.querySelector(\'[data-testid="ai.message"][data-role=assistant] [data-testid="ai.message.rich"]\') && document.querySelector(\'[data-testid="ai.message"][data-role=assistant] [data-testid="ai.message.rich"]\').textContent.length>20000 && document.body.textContent.indexOf(\'当前对话正在生成\')<0',
    );
    const frames = await cdp.evaluate(
      "window.__aiMeasure=false;window.__aiFrames",
    );
    assert.ok(frames.length > 10, "20k response rendered across frames");
    frames.sort((a, b) => a - b);
    assert.ok(
      frames[Math.floor(frames.length * 0.95)] < 150,
      "20k response maintains smooth frames",
    );
    console.log(
      `${label}: 20k stream p95 frame ${frames[Math.floor(frames.length * 0.95)].toFixed(1)} ms`,
    );
    scenarios++;
    await click(cdp, "管理");
    await click(cdp, "AI 额度与统计");
    await cdp.wait(
      "!!document.querySelector('[data-testid=\"ai.billing.chart\"]')",
    );
    await capture(cdp, label, "billing", "light");
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"ai.billing\"]').scrollTop=document.querySelector('[data-testid=\"ai.billing\"]').scrollHeight",
    );
    await capture(cdp, label, "accounts", "light");
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"ai.billing\"]').scrollTop=0",
    );
    await click(cdp, "设置");
    await select(cdp, "主题", "dark");
    await closeSheet(cdp);
    await capture(cdp, label, "billing", "dark");
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"ai.billing\"]').scrollTop=document.querySelector('[data-testid=\"ai.billing\"]').scrollHeight",
    );
    await capture(cdp, label, "accounts", "dark");
    const failed = await cdp.evaluate(
      "new Promise(function(resolve){var r=indexedDB.open('talos-app');r.onsuccess=function(){var db=r.result;var q=db.transaction('outbox').objectStore('outbox').getAll();q.onsuccess=function(){resolve(q.result.filter(function(o){return o.state==='failed'}));db.close()}}})",
    );
    assert.deepEqual(failed, [], "AI workflow has no failed queued operations");
    assert.deepEqual(browser.errors.slice(initialErrors), []);
    console.log(
      `${label} AI: ${scenarios} scenarios passed (stream, stop, reconnect, image, fork, credits, drafts, offline render, workspace, admin).`,
    );
  } finally {
    seed.close();
    await cdp.offline(false);
  }
}
