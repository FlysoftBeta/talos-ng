import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { createApi } from "@talos/contract";
import { LinkClient } from "@talos/link";
import { connectNodeWebSocket } from "@talos/link/ws-node";
import { parseConfig } from "../kernel/config/config.ts";
import { startServer } from "../main.ts";

it("serves sync pulls from read-only replica workers with the writer's results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talos-replica-"));
  await mkdir(join(dir, "assets"));
  const server = await startServer(
    parseConfig({
      ports: [0],
      bindHost: "127.0.0.1",
      dataDir: dir,
      assetsDir: join(dir, "assets"),
      dev: true,
      testSeed: true,
    }),
    {
      printRootPin: () => {},
      readers: 2,
      replicaEntry: new URL("../../bin/testing/server.ts", import.meta.url),
    },
  );
  const client = new LinkClient({
    connect: () =>
      connectNodeWebSocket(`ws://127.0.0.1:${server.addresses[0]!.port}/link`),
    hello: () => ({ v: 1, build: "test", device, lang: "zh-CN" }),
  });
  let device: string | null = null;
  try {
    for (let i = 0; i < 300; i++) {
      if (server.replicas()?.ready === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(server.replicas()?.ready).toBe(2);
    const welcomed = deferred<void>();
    client.onWelcome(() => welcomed.resolve());
    client.start();
    await welcomed.promise;
    const api = createApi(client.call.bind(client));
    device = (await api.auth.device.register({})).device;
    const session = await api.auth.login({ pin: "654321" });
    if ("onboarding" in session) throw new Error("unexpected onboarding");
    const user = session.user.id;
    const first = await api.sync.pull({ cursors: {} });
    // Read-your-writes: a write committed before the pull is in its snapshot.
    const op = createUlid()();
    await api.me.setting.set(
      {
        key: "theme",
        value: { v: "dark", t: { ms: Date.now(), counter: 0 }, op },
      },
      { op },
    );
    const cursors = Object.fromEntries(
      Object.entries(first.scopes).map(([scope, page]) => [scope, page.cursor]),
    );
    const second = await api.sync.pull({ cursors });
    expect(
      second.scopes[`me:${user}`]?.rows.some((row) => row.type === "setting"),
    ).toBe(true);
    const local = server.kernel.syncHub.snapshot(user, { cursors }).response;
    expect(second).toEqual(local);
    // Both pulls were answered by replicas, not the local fallback.
    expect(server.replicas()?.completed).toBeGreaterThanOrEqual(2);
    expect(server.replicas()?.failed).toBe(0);
  } finally {
    client.stop();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
