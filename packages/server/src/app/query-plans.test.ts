// Gate: the statements a sync pull, a delta fan-out and a chat post run must be
// index-driven. Every statement prepared during that workflow is explained; a
// full scan or temporary sort on a table that grows with users or content fails.
import { expect, it } from "vitest";
import { createUlid } from "@talos/base";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "./create-application.ts";
import { Db } from "../kernel/persistence/db.ts";

/** Scans that are bounded anyway, with the reason. */
const BOUNDED = new Map([
  // A partial index holding only queued/running runs.
  ["SCAN ai_runs USING INDEX ai_active_conversation", "active runs only"],
]);
const GROWING =
  /^(users|user_pins|sessions|devices|community_\w+|chat_(posts|states|texts|ack)|library_\w+|media_\w+|ai_\w+|me_settings|learning_progress|jobs|authority_\w+|objects|object_refs|uploads)$/;

it("sync pull, fan-out and posting use indexes on growing tables", async () => {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    backgroundTasks: false,
    printRootPin: () => {},
  });
  const seen = new Set<string>();
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    seen.add(sql);
    return prepare(sql);
  };
  try {
    const id = createUlid();
    const [alice, bob] = ["100001", "100002"].map((pin, n) =>
      kernel.identity.createUser({ pin, name: `用户${n}`, handle: `u${n}` }),
    );
    const group = kernel.community.create(alice!.id, {
      name: "群组",
      discoverable: true,
    });
    kernel.community.join(bob!.id, group.id, { type: "search" });
    const connection = { id: "c", emit: () => {} };
    for (const user of [alice!, bob!]) {
      kernel.library.ensureBuiltins(user.id);
      kernel.community.initializeUser(user.id);
      kernel.chat.ensureStates(user.id);
      kernel.ai.billing.projected(user.id);
    }
    seen.clear();
    const first = kernel.syncHub.pull(bob!.id, { cursors: {} }, connection);
    kernel.chat.send(alice!.id, {
      id: id(),
      conversation: group.id,
      kind: "text",
      text: "你好",
    });
    kernel.syncHub.pull(
      bob!.id,
      {
        cursors: Object.fromEntries(
          Object.entries(first.scopes).map(([scope, page]) => [
            scope,
            page.cursor,
          ]),
        ),
        windowed: [`conv:${group.id}`],
      },
      connection,
    );
    expect(seen.size).toBeGreaterThan(20);
    const failures: string[] = [];
    for (const sql of seen) {
      if (!/^\s*(SELECT|WITH|UPDATE|DELETE|INSERT)/i.test(sql)) continue;
      const params = (sql.match(/\?/g) ?? []).length;
      const plan = db.all<{ detail: string }>(
        `EXPLAIN QUERY PLAN ${sql}`,
        ...Array<number>(params).fill(0),
      );
      for (const { detail } of plan) {
        const scan = /^SCAN (\w+)/.exec(detail);
        const table = scan?.[1];
        if (BOUNDED.has(detail)) continue;
        if (
          (table && GROWING.test(table)) ||
          (/TEMP B-TREE FOR (?:LAST \d+ TERMS OF |LAST TERM OF )?ORDER BY/.test(
            detail,
          ) &&
            !/UNION/i.test(sql))
        )
          failures.push(`${detail} :: ${sql.replace(/\s+/g, " ")}`);
      }
    }
    expect(failures).toEqual([]);
  } finally {
    await kernel.close();
    db.close();
  }
});
