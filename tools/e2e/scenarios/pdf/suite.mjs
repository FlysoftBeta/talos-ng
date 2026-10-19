import assert from "node:assert/strict";
import { connectChat } from "../../harness/chat-wire.mjs";
import { imagePdf, libraryPdf } from "../../harness/library-pdf.mjs";
import {
  click,
  close,
  ready,
  text,
  unlock,
  upload,
} from "../library/helpers.mjs";

const pageReady = (ordinal) =>
  `!!document.querySelector('[data-reader-unit="${ordinal}"] [data-page-ready=true]')`;
/** The rendered page's shadow root holds the PDF's own CJK text. */
const pageText = (ordinal) =>
  `(function(){var p=document.querySelector('[data-reader-unit="${ordinal}"] [data-page-ready=true]');return p&&p.shadowRoot?p.shadowRoot.textContent:''})()`;
const packStored = (pack) => `new Promise(function(resolve,reject){
  var r=indexedDB.open('talos-app');
  r.onerror=function(){reject(r.error)};
  r.onsuccess=function(){
    var db=r.result;
    var q=db.transaction('file_heads').objectStore('file_heads').get(${JSON.stringify(pack)});
    q.onsuccess=function(){db.close();resolve(!!q.result)};
    q.onerror=function(){db.close();reject(q.error)};
  };
})`;

export async function pdfSuite({ adapter, legacy }, server) {
  const { cdp } = adapter;
  const errors = adapter.errors.length;
  let wire;
  try {
    wire = await connectChat(server.url, "123456");
    const small = await upload(wire, libraryPdf(2), "中文 PDF", "中文.pdf");
    const large = await upload(wire, libraryPdf(500), "五百页 PDF", "500.pdf");
    const image = await upload(wire, imagePdf(), "大图 PDF", "image.pdf");
    await ready(wire, small.doc);
    await ready(wire, large.doc);
    const imageManifest = (await ready(wire, image.doc)).manifest;
    assert.ok(
      Object.values(imageManifest.resources).some(
        (r) => r.mime === "image/webp" && r.stored > 500 * 1024,
      ),
      "image fixture needs a resource above the link limit",
    );
    const pack = (await wire.call("library.doc.describe", { doc: small.doc }))
      .data.pack.id;

    // Tablets are given the HTTP address; only Chromium 80+ is moved to HTTPS (D-143).
    // Read the engine first: Chromium 80+ is redirected, which replaces the page.
    const version = Number(
      /Chrom(?:e|ium)\/(\d+)/.exec(
        await cdp.evaluate("navigator.userAgent"),
      )[1],
    );
    await cdp.send("Page.navigate", { url: server.lanUrl + "/" });
    const origin = version >= 80 ? server.secureUrl : server.lanUrl;
    await cdp.wait(
      `location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`,
    );
    const worker = version >= 80;
    assert.equal(
      await cdp.evaluate("window.isSecureContext&&!!navigator.serviceWorker"),
      worker,
      `ServiceWorker available on ${origin}`,
    );
    await unlock(cdp);
    await cdp.wait(`${text}.indexOf('已连接')>=0`);

    // Rendering: the small pack travels as framed resources over the link.
    await click(cdp, "阅读");
    await click(cdp, "中文 PDF");
    await cdp.wait(pageReady(0));
    assert.ok(
      (await cdp.evaluate(pageText(0))).includes("你好世界1"),
      "first PDF page rendered with its text",
    );
    // Pages render as they scroll into view; a short viewport holds only the first.
    await cdp.evaluate(
      "document.querySelector('[data-testid=\"reader.scroll\"]').scrollTop=1e9",
    );
    await cdp.wait(pageReady(1));

    // Transfer: a page image above 500 KiB is read by verified HTTP ranges and decodes.
    await click(cdp, "阅读");
    await click(cdp, "大图 PDF");
    await cdp.wait(pageReady(0));
    assert.deepEqual(
      await cdp.evaluate(`new Promise(function(resolve){
        var root=document.querySelector('[data-reader-unit="0"] [data-page-ready=true]').shadowRoot;
        var urls=[];
        Array.prototype.forEach.call(root.querySelectorAll('*'),function(n){
          ['href','src','xlink:href'].forEach(function(a){var v=n.getAttribute(a);if(v&&v.indexOf('blob:')===0)urls.push(v)});
        });
        if(!urls.length)return resolve([]);
        var sizes=[];
        urls.forEach(function(url){
          var img=new Image();
          img.onload=function(){sizes.push(img.naturalWidth>0);if(sizes.length===urls.length)resolve(sizes)};
          img.onerror=function(){sizes.push(false);if(sizes.length===urls.length)resolve(sizes)};
          img.src=url;
        });
      })`),
      [true],
      "ranged page image decodes",
    );

    // Many units: the 500-page pack opens at a jumped-to page.
    await click(cdp, "阅读");
    await click(cdp, "五百页 PDF");
    await cdp.wait(pageReady(0));
    await cdp.evaluate(
      "(function(){var e=document.querySelector('[aria-label=跳转页码]');var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;e.focus();set.call(e,'250');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()",
    );
    await cdp.wait(pageReady(249));
    assert.ok(
      (await cdp.evaluate(pageText(249))).includes("你好世界250"),
      "page 250 of a 500-page pack rendered",
    );

    // Storage: retention downloads the whole small pack into IndexedDB.
    // The document reopens where it was left: its second page.
    await click(cdp, "阅读");
    await click(cdp, "中文 PDF");
    await cdp.wait(pageReady(1));
    await click(cdp, "离线保留");
    await click(cdp, "7 天");
    await click(cdp, "保存策略");
    await cdp.wait("!document.querySelector('[role=dialog]')");
    await click(cdp, "离线保留");
    await cdp.wait(`${text}.indexOf('已保留')>=0`);
    await close(cdp);
    assert.equal(await cdp.evaluate(packStored(pack)), true, "pack stored");

    // Reading from storage without the server, in this page and (with a worker) after reload.
    await cdp.offline(true);
    await server.stop();
    await cdp.wait(`${text}.indexOf('已连接')<0`);
    await click(cdp, "阅读");
    await click(cdp, "中文 PDF");
    await cdp.wait(pageReady(1));
    assert.ok(
      (await cdp.evaluate(pageText(1))).includes("你好世界2"),
      "stored PDF page rendered offline",
    );
    if (worker) {
      await cdp.navigate(origin + "/");
      await unlock(cdp);
      await click(cdp, "阅读");
      await click(cdp, "中文 PDF");
      await cdp.wait(pageReady(1));
      assert.ok(
        (await cdp.evaluate(pageText(1))).includes("你好世界2"),
        "stored PDF page rendered after an offline restart",
      );
    }
    assert.deepEqual(
      adapter.errors.slice(errors),
      [],
      "PDF reading has no browser errors",
    );
    console.log(
      `Chromium ${version}${legacy ? " (snapshot)" : ""}: PDF over ${worker ? "HTTPS with a ServiceWorker" : "plain HTTP"} rendered (500 pages, ranged page image) and read from storage offline.`,
    );
  } finally {
    wire?.close();
    await cdp.offline(false);
  }
}
