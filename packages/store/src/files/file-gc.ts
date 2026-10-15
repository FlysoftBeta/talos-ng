import type { FileEngine } from "./file-engine.ts";
import { FILE_TABLES } from "./file-schema.ts";
import type { FileHead, Lease, Owner } from "./file-schema.ts";
import { validSize } from "./file-types.ts";
export async function collect(
  engine: FileEngine,
  options: {
    incompleteOlderThanMs: number;
  },
): Promise<{ files: number; bytes: number }> {
  validSize(options.incompleteOlderThanMs);
  const result = { files: 0, bytes: 0 };
  let lower: string | undefined;
  for (;;) {
    const page = await engine.db
      .table<FileHead, string>("file_heads")
      .range({ lower, lowerOpen: lower !== undefined, limit: 32 });
    if (!page.length) return result;
    for (const head of page) {
      const token = engine.token();
      const claimed = await engine.locked(head.rid, () =>
        engine.db.tx(FILE_TABLES, "readwrite", (tx) =>
          tx
            .table<Lease, string>("file_leases")
            .get(head.rid)
            .then((lease) => {
              if (lease && lease.expires > engine.clock()) return undefined;
              return tx
                .table<FileHead, string>("file_heads")
                .get(head.rid)
                .then((current) => {
                  if (!current) return undefined;
                  return tx
                    .table<Owner>("file_owners")
                    .byIndex<string>("rid")
                    .count({ lower: head.rid, upper: head.rid })
                    .then((owners) => {
                      if (
                        current.state === "complete"
                          ? owners > 0
                          : current.state !== "deleting" &&
                            engine.clock() - current.updatedAt <
                              options.incompleteOlderThanMs
                      )
                        return undefined;
                      tx.table<Lease>("file_leases").put({
                        rid: head.rid,
                        token,
                        expires: engine.clock() + engine.leaseMs,
                      });
                      tx.table<FileHead>("file_heads").put({
                        ...current,
                        state: "deleting",
                      });
                      return current;
                    });
                });
            }),
        ),
      );
      if (claimed) {
        await engine.remove(head.rid, token);
        result.files++;
        result.bytes += claimed.written;
      }
    }
    lower = page[page.length - 1]!.rid;
  }
}
