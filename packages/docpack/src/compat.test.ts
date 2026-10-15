import { build } from "esbuild";
import vm from "node:vm";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { expect, it } from "vitest";
it("bundles for Chrome 70, passes the repository compatibility gate, and executes without post-ES2018 globals", async () => {
  const bundled = await build({
    entryPoints: [path.resolve(import.meta.dirname, "index.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    target: ["chrome70", "es2018"],
    format: "iife",
    globalName: "Docpack",
  });
  const code = bundled.outputFiles[0]!.text;
  const context = vm.createContext({
    TextEncoder,
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    "globalThis = undefined; BigInt = undefined; ReadableStream = undefined; Blob = undefined; Object.fromEntries = undefined; Promise.allSettled = undefined; String.prototype.replaceAll = undefined; Array.prototype.at = undefined;",
    context,
  );
  vm.runInContext(code, context);
  const result: unknown = await vm.runInContext(
    `(async function(){const d=Docpack; const sink=new d.MemorySpool(); const w=new d.PackWriter(sink,new d.MemorySpool(),{kind:'flow'});const bytes=new TextEncoder().encode('hello'.repeat(100));const rid=await w.addResource(bytes,'text/plain');w.addUnit({id:'one',entry:rid,deps:[]});await w.finish();const r=await d.PackReader.open(sink);return new TextDecoder().decode(await r.readDecoded(rid));})()`,
    context,
  );
  expect(result).toBe("hello".repeat(100));
  const dir = await mkdtemp(path.join(tmpdir(), "tdp-compat-"));
  try {
    await writeFile(path.join(dir, "pack.js"), code);
    await promisify(execFile)(process.execPath, [
      path.resolve(import.meta.dirname, "../../../tools/compat-check/cli.mjs"),
      dir,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
