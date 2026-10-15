import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { createStaticServer } from "./static-server.mjs";

test("static server serves shell and MIME, blocks paths, stops and restarts at same origin", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "talos-static-test-"));
  await writeFile(path.join(root, "index.html"), "<p>测试</p>");
  await writeFile(path.join(root, "sw.js"), "self.test=true;");
  const server = createStaticServer({ root, sw: path.join(root, "sw.js") });
  try {
    const url = await server.start();
    const html = await fetch(url);
    assert.equal(await html.text(), "<p>测试</p>");
    assert.match(html.headers.get("content-type"), /text\/html/);
    assert.equal(html.headers.get("cache-control"), "no-store");
    assert.equal(
      (await fetch(`${url}/sw.js`)).headers.get("service-worker-allowed"),
      "/",
    );
    assert.equal((await fetch(`${url}/missing`)).status, 404);
    assert.equal((await fetch(`${url}/%5Cetc%5Cpasswd`)).status, 400);
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
    server.overrides.set("/hello.js", {
      bytes: Buffer.from("fixture"),
      mime: "text/javascript",
    });
    assert.equal(await (await fetch(`${url}/hello.js`)).text(), "fixture");
    await server.stop();
    await assert.rejects(fetch(url));
    assert.equal(await server.start(), url);
    assert.equal((await fetch(url)).status, 200);
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});
