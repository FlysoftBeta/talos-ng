import { afterEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsObjectStore } from "@talos/objectstore";
import { Db } from "./kernel/persistence/db.ts";
import { createKernel } from "./app/create-application.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});

it("repairs an interrupted disk catalog batch and reseeds idempotently after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "talos-seed-crash-"));
  directories.push(root);
  const child = spawn(
    process.execPath,
    [
      "--experimental-transform-types",
      "--input-type=module",
      "-e",
      `
    import { createFsObjectStore } from ${JSON.stringify(new URL("../../objectstore/src/index.ts", import.meta.url).href)};
    import { Db } from ${JSON.stringify(new URL("./kernel/persistence/db.ts", import.meta.url).href)};
    import { createKernel } from ${JSON.stringify(new URL("./app/create-application.ts", import.meta.url).href)};
    const root = ${JSON.stringify(root)};
    const store = createFsObjectStore({root});
    const begin = store.beginBulk.bind(store);
    store.beginBulk = () => {
      const batch = begin(); let count = 0;
      return {...batch, async put(...args) {
        const info = await batch.put(...args);
        if (++count === 13) {
          process.stdout.write('paused\\n');
          await new Promise(() => setInterval(() => {}, 1000));
        }
        return info;
      }};
    };
    const kernel = createKernel({db: new Db(root + '/talos.db'), store, build:'crash', printRootPin:()=>{}});
    await kernel.chat.ready;
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });
  const exited = once(child, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Seed child stalled: ${logs}`)),
        10_000,
      );
      child.once("error", reject);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Seed exited: ${logs}`));
      });
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("paused")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
  const store = createFsObjectStore({ root });
  const partial = [];
  for await (const info of store.list()) partial.push(info);
  expect(partial.length).toBeGreaterThan(0);
  // Model both missing directory entries and torn bytes after a machine crash.
  await store.delete(partial[0]!.id);
  await writeFile(store.localPath(partial[1]!.id)!, Buffer.from("torn"));
  for (let restart = 0; restart < 2; restart++) {
    const db = new Db(join(root, "talos.db"));
    if (restart === 0)
      expect(
        db.get<{ n: number }>("SELECT count(*) n FROM chat_stickers")!.n,
      ).toBe(0);
    const kernel = createKernel({
      db,
      store,
      build: "crash",
      printRootPin: () => {},
    });
    try {
      await kernel.chat.ready;
      expect(
        db.get<{ n: number }>("SELECT count(*) n FROM chat_stickers")!.n,
      ).toBe(1062);
      expect(
        db.get<{ n: number }>(
          "SELECT count(*) n FROM object_refs WHERE owner_kind='chat-sticker'",
        )!.n,
      ).toBe(1062);
      for await (const info of store.list())
        expect(await store.verify(info.id)).toBe(true);
    } finally {
      await kernel.close();
      db.close();
    }
  }
}, 120_000);
