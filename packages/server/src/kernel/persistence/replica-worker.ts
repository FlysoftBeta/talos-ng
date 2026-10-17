import { parentPort } from "node:worker_threads";
import { AppError } from "@talos/base";
import type { Db } from "./db.ts";
import type { QueryStats } from "./query-stats.ts";
import type { ReplicaReply, ReplicaRequest } from "./replica-pool.ts";

/**
 * Worker side of `ReplicaPool`: answers tasks one at a time, each inside one
 * read transaction of the replica's read-only connection.
 */
export function serveReplica(
  db: Db,
  stats: QueryStats,
  handlers: Readonly<Record<string, (input: unknown) => unknown>>,
): void {
  const port = parentPort;
  if (!port) throw new AppError("E_INTERNAL", "只读连接必须在工作线程中运行");
  port.on("message", (request: ReplicaRequest) => {
    let reply: ReplicaReply;
    try {
      let value: unknown;
      if (request.kind === "replica.stats") value = stats.export();
      else if (request.kind === "replica.reset") value = stats.reset();
      else {
        const handler = handlers[request.kind];
        if (!handler) throw new AppError("E_NOT_FOUND", "只读任务不存在");
        value = db.snapshot(() => handler(request.input));
      }
      reply = { type: "reply", id: request.id, ok: true, value };
    } catch (error) {
      const known = error instanceof AppError;
      reply = {
        type: "reply",
        id: request.id,
        ok: false,
        error: {
          code: known ? error.code : "E_INTERNAL",
          message: known ? error.message : "只读查询失败",
          ...(known && error.data !== undefined ? { data: error.data } : {}),
        },
        // Unexpected failures carry their stack (never their message) so the
        // main thread can file an incident; replicas cannot write one.
        ...(!known && error instanceof Error && error.stack
          ? { stack: error.stack.split("\n").slice(1, 12).join("\n") }
          : {}),
      };
    }
    port.postMessage(reply);
  });
  port.postMessage({ type: "ready" } satisfies ReplicaReply);
}
