/**
 * Server load measurement: seeds a community, starts the real server in a
 * child process and drives many WebSocket clients through login, initial sync,
 * reconnect pulls and live posts, then prints the admin performance report of
 * each phase. Usage (see docs/impl/ops-performance.md):
 *   node --import tsx packages/server/bin/testing/sync-load.ts --data .tmp/load \
 *     [--users 400] [--groups 40] [--members 40] [--posts 40] [--readers N] [--writes 200]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createUlid } from "@talos/base";
import { createApi, syncResultSchema } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import { contract } from "@talos/contract";
import { LinkClient } from "@talos/link";
import { connectNodeWebSocket } from "@talos/link/ws-node";
import { createFsObjectStore } from "@talos/objectstore";
import { createKernel } from "../../src/app/create-application.ts";
import { Db } from "../../src/kernel/persistence/db.ts";

const argv = process.argv.slice(2);
const option = (name: string, fallback?: number): number => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) {
    if (fallback === undefined) throw new Error(`--${name} is required`);
    return fallback;
  }
  return Number(argv[index + 1]);
};
const dataIndex = argv.indexOf("--data");
if (dataIndex === -1) throw new Error("--data <directory> is required");
const data = resolve(argv[dataIndex + 1]!);
const shape = {
  users: option("users", 400),
  groups: option("groups", 40),
  members: option("members", 40),
  posts: option("posts", 40),
};
const readers = argv.includes("--readers") ? option("readers") : undefined;
const writes = option("writes", 200);
const ROOT_PIN = "100000";
/** Calls under load may queue far longer than the interactive default. */
const LONG = 600_000;
const pin = (index: number) => String(200000 + index);

async function seed(): Promise<void> {
  await mkdir(data, { recursive: true });
  const db = new Db(join(data, "talos.db"));
  const kernel = createKernel({
    db,
    store: createFsObjectStore({ root: data }),
    build: "load",
    backgroundTasks: false,
    printRootPin: () => {},
  });
  await kernel.chat.ready;
  const id = createUlid();
  const root = kernel.identity.createUser({
    pin: ROOT_PIN,
    name: "负载根管理员",
    handle: "loadroot",
    roles: ["root"],
  });
  const users = Array.from({ length: shape.users }, (_, index) =>
    kernel.identity.createUser({
      pin: pin(index),
      name: `用户${index}`,
      handle: `u${index}`,
    }),
  );
  for (let g = 0; g < shape.groups; g++) {
    const group = kernel.community.create(root.id, {
      name: `群组${g}`,
      discoverable: true,
    });
    const members = Array.from(
      { length: Math.min(shape.members, users.length) },
      (_, k) => users[(g * 7 + k) % users.length]!,
    );
    for (const member of members)
      kernel.community.join(member.id, group.id, { type: "search" });
    for (let p = 0; p < shape.posts; p++)
      kernel.chat.send(members[p % members.length]!.id, {
        id: id(),
        conversation: group.id,
        kind: "text",
        text: `消息 ${g}-${p} ${"内容".repeat(20)}`,
      });
  }
  await kernel.close();
  db.close();
  await writeFile(join(data, "load.json"), JSON.stringify(shape));
}

interface Client {
  link: LinkClient;
  api: ReturnType<typeof createApi>;
  cursors: Record<string, number>;
  windowed: string[];
  groups: string[];
}
async function connect(url: string, userPin: string): Promise<Client> {
  let device: string | null = null;
  const link = new LinkClient({
    connect: () => connectNodeWebSocket(url),
    hello: () => ({ v: 1, build: "load", device, lang: "zh-CN" }),
    connectTimeoutMs: 60_000,
  });
  const welcomed = new Promise<void>((done) => {
    const off = link.onWelcome(() => {
      off();
      done();
    });
  });
  link.start();
  await welcomed;
  const api = createApi(link.call.bind(link));
  device = (await api.auth.device.register({}, { timeoutMs: LONG })).device;
  const session = await api.auth.login({ pin: userPin }, { timeoutMs: LONG });
  if ("onboarding" in session) throw new Error("unexpected onboarding");
  return { link, api, cursors: {}, windowed: [], groups: [] };
}
type Pull = ResultOf<typeof contract.sync.pull>;
async function pull(client: Client): Promise<number> {
  let rows = 0;
  for (let round = 0; round < 1000; round++) {
    let response: Pull = await client.api.sync.pull(
      { cursors: client.cursors, windowed: client.windowed },
      { timeoutMs: LONG },
    );
    if (response.transfer) {
      const chunks: string[] = [];
      let repull = false;
      for (;;) {
        chunks.push(response.transfer!.chunk);
        repull ||= !!response.repull;
        if (!response.transfer!.more) break;
        response = await client.api.sync.pull(
          {
            cursors: client.cursors,
            windowed: client.windowed,
            continuation: response.transfer!.token,
          },
          { timeoutMs: LONG },
        );
      }
      response = {
        ...syncResultSchema.parse(JSON.parse(chunks.join(""))),
        ...(repull ? { repull } : {}),
      };
    }
    let more = !!response.repull;
    for (const scope of response.gone) delete client.cursors[scope];
    for (const [scope, page] of Object.entries(response.scopes)) {
      client.cursors[scope] = page.cursor;
      rows += page.rows.length;
      for (const row of page.rows)
        if (
          row.type === "communityConversation" &&
          (row.data as { type?: string } | null)?.type === "normal" &&
          !client.groups.includes(row.id)
        )
          client.groups.push(row.id);
      more ||= page.more;
      if (scope.startsWith("conv:") && !client.windowed.includes(scope))
        client.windowed.push(scope);
    }
    if (!more) return rows;
  }
  throw new Error("pull did not converge");
}
async function timed<T>(
  items: readonly T[],
  run: (item: T) => Promise<unknown>,
): Promise<{ wallMs: number; p50: number; p95: number; max: number }> {
  const started = performance.now();
  const durations = await Promise.all(
    items.map(async (item) => {
      const begin = performance.now();
      await run(item);
      return performance.now() - begin;
    }),
  );
  durations.sort((a, b) => a - b);
  const at = (q: number) =>
    Math.round(
      durations[
        Math.min(durations.length - 1, Math.floor(q * durations.length))
      ]!,
    );
  return {
    wallMs: Math.round(performance.now() - started),
    p50: at(0.5),
    p95: at(0.95),
    max: Math.round(durations[durations.length - 1] ?? 0),
  };
}
function print(
  phase: string,
  latency: Awaited<ReturnType<typeof timed>>,
  report: ResultOf<typeof contract.admin.performance.get>,
): void {
  const top = report.queries.statements.slice(0, 12);
  process.stdout.write(
    `\n## ${phase}\nclient latency ms: wall ${latency.wallMs}, p50 ${latency.p50}, p95 ${latency.p95}, max ${latency.max}\n` +
      `event loop ms: p50 ${report.eventLoop.p50Ms}, p99 ${report.eventLoop.p99Ms}, max ${report.eventLoop.maxMs}, utilisation ${report.eventLoop.utilization}\n` +
      `replicas: ${JSON.stringify(report.replicas)}\n` +
      "| source | kind | count | total ms | p50 | p95 | max | sql |\n|---|---|--:|--:|--:|--:|--:|---|\n" +
      top
        .map(
          (row) =>
            `| ${row.source} | ${row.kind} | ${row.count} | ${Math.round(row.totalMs)} | ${row.p50Ms} | ${row.p95Ms} | ${row.maxMs} | ${row.sql.slice(0, 110).replace(/\|/g, "\\|")} |`,
        )
        .join("\n") +
      "\n",
  );
}

if (!existsSync(join(data, "talos.db"))) {
  process.stdout.write(`seeding ${JSON.stringify(shape)} into ${data}\n`);
  await seed();
}
const seeded = JSON.parse(
  await readFile(join(data, "load.json"), "utf8"),
) as typeof shape;
const assets = join(data, "assets");
await mkdir(assets, { recursive: true });
await writeFile(join(assets, "sw.js"), "");
const server = spawn(
  process.execPath,
  [
    ...(process.env.LOAD_SERVER_NODE_OPTIONS?.split(" ").filter(Boolean) ?? []),
    "--import",
    "tsx",
    join(import.meta.dirname, "server.ts"),
  ],
  {
    env: {
      ...process.env,
      TALOS_PORTS: "0",
      TALOS_BIND_HOST: "127.0.0.1",
      TALOS_DATA_DIR: data,
      TALOS_ASSETS_DIR: assets,
      TALOS_WORKER_FILE: join(assets, "sw.js"),
      ...(readers !== undefined ? { TALOS_DB_READERS: String(readers) } : {}),
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
const port = await new Promise<number>((done, fail) => {
  let output = "";
  server.once("exit", (code) => fail(new Error(`server exited ${code}`)));
  server.stdout!.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    const match = /"port":(\d+)/.exec(output);
    if (match) done(Number(match[1]));
  });
});
const url = `ws://127.0.0.1:${port}/link`;
try {
  const admin = await connect(url, ROOT_PIN);
  const report = (reset = true) =>
    admin.api.admin.performance.get({ reset }, { timeoutMs: LONG });
  await report();
  const clients: Client[] = [];
  const login = await timed(
    Array.from({ length: seeded.users }, (_, index) => index),
    async (index) => {
      clients.push(await connect(url, pin(index)));
    },
  );
  print(`login ${seeded.users} clients`, login, await report());
  const initial = await timed(clients, pull);
  print("initial sync (all clients concurrently)", initial, await report());
  const again = await timed(clients, pull);
  print("reconnect pull with cursors", again, await report());
  const id = createUlid();
  const live = await timed(
    Array.from({ length: writes }, (_, n) => n),
    async (n) => {
      const index = (n * 13) % clients.length;
      const conversation = clients[index]!.groups[0];
      if (!conversation) return;
      await clients[index]!.api.chat.post.send(
        { id: id(), conversation, kind: "text", text: `实时消息 ${n}` },
        { timeoutMs: LONG },
      );
    },
  );
  print(
    `${writes} live posts with all clients subscribed`,
    live,
    await report(),
  );
  for (const client of clients) client.link.stop();
  admin.link.stop();
} finally {
  server.kill("SIGTERM");
}
