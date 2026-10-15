import type { ObjectStore } from "@talos/objectstore";
import {
  createFsObjectStore,
  createMemoryObjectStore,
} from "@talos/objectstore";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createKernel } from "../../../app/create-application.ts";
import { Db } from "../../../kernel/persistence/db.ts";
import { startHttpGateway } from "../../../kernel/transport/httpGateway.ts";
import { restoreBackup } from "./service.ts";
import { BACKUP_CHUNK, copyChecked } from "./stream.ts";

it("creates, downloads over HTTP and restores a 2 GiB synthetic object set with bounded RSS", async () => {
  // This test simultaneously stages several GiB; shared CI tmpfs may be smaller.
  // Keep the full payload and assertions, but allow a disk-backed scratch directory.
  const root = await mkdtemp(
    join(
      process.env.TALOS_LARGE_TEST_TMPDIR ?? tmpdir(),
      "talos-large-backup-",
    ),
  );
  const restoredRoot = join(root, "restored");
  const db = new Db(join(root, "talos.db"));
  const zero = Buffer.alloc(BACKUP_CHUNK);
  const objectSize = 64 * 1024 * 1024;
  const objects = new Map<string, number>();
  function* chunks(seed: number) {
    const first = Buffer.alloc(BACKUP_CHUNK);
    first[0] = seed;
    yield first;
    for (let offset = BACKUP_CHUNK; offset < objectSize; offset += BACKUP_CHUNK)
      yield zero;
  }
  // No source object buffers/files: only one 64 KiB chunk per synthetic object.
  for (let seed = 1; seed <= 33; seed++) {
    const hash = createHash("sha256");
    for (const chunk of chunks(seed)) hash.update(chunk);
    objects.set(hash.digest("hex"), seed);
  }
  const store: ObjectStore = {
    ...createMemoryObjectStore(),
    async *read(id) {
      const seed = objects.get(id);
      if (seed === undefined) throw new Error("unexpected object");
      yield* chunks(seed);
    },
    async readAll() {
      throw new Error("backup must never buffer an object");
    },
  };
  const kernel = createKernel({
    db,
    store,
    build: "large-backup-test",
    printRootPin: () => {},
    ops: { dataDir: root },
  });
  let gateway;
  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  const sample = () => {
    peak = Math.max(peak, process.memoryUsage().rss);
  };
  const sampler = setInterval(sample, 5);
  try {
    for (const id of objects.keys())
      await kernel.objects.publish(
        async () => ({ id, size: objectSize }),
        (info) => kernel.objects.addRef(info.id, "test", info.id),
      );
    const backup = await kernel.ops.backups.create();
    expect(backup.size).toBeGreaterThan(2 * 1024 ** 3);
    const user = db.get<{ id: string }>(
      "SELECT id FROM users WHERE EXISTS(SELECT 1 FROM json_each(roles) WHERE value='root')",
    )!.id;
    const ticket = await kernel.ops.backupDownload(user, backup.id);
    gateway = await startHttpGateway({
      ports: [0],
      build: "large-backup-test",
      store,
      tickets: kernel.tickets,
    });
    const archive = join(root, "download.talos-backup");
    await new Promise<void>((resolve, reject) => {
      const request = get(
        `http://127.0.0.1:${gateway!.addresses[0]!.port}${ticket.url}`,
        (response) => {
          if (
            response.statusCode !== 200 ||
            Number(response.headers["content-length"]) !== backup.size
          ) {
            response.resume();
            reject(new Error("invalid archive response"));
            return;
          }
          void copyChecked(response, archive).then((result) => {
            expect(result.size).toBe(backup.size);
            resolve();
          }, reject);
        },
      );
      request.on("error", reject);
    });
    await restoreBackup(archive, restoredRoot);
    const restoredDb = new Db(join(restoredRoot, "talos.db"));
    try {
      expect(
        restoredDb.get<{ count: number }>(
          "SELECT count(*) AS count FROM objects",
        )?.count,
      ).toBe(33);
    } finally {
      restoredDb.close();
    }
    const restored = createFsObjectStore({ root: restoredRoot });
    for (const id of objects.keys()) {
      expect((await restored.stat(id))?.size).toBe(objectSize);
      expect(await restored.verify(id)).toBe(true);
    }
    sample();
    // Includes snapshot creation, HTTP producer/consumer, parser and final object-store publication.
    console.info(
      `Backup streaming: ${((33 * objectSize) / 1024 ** 3).toFixed(2)} GiB, peak RSS delta ${((peak - baseline) / 1024 ** 2).toFixed(1)} MiB`,
    );
    expect(peak - baseline).toBeLessThan(256 * 1024 * 1024);
  } finally {
    clearInterval(sampler);
    await gateway?.close();
    await kernel.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
