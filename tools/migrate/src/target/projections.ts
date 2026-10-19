import {
  libraryStateSchema,
  postSchema,
  chatStateSchema,
} from "@talos/contract";
import type { Db, createKernel } from "@talos/server/migration";

/** Rebuild client-facing projections after all imported attachments exist. */
export function materializeProjections(
  target: Db,
  kernel: ReturnType<typeof createKernel>,
): void {
  for (let offset = 0; ; offset += 500) {
    const states = target.all<{ user: string; conversation: string }>(
      "SELECT user,conversation FROM chat_states ORDER BY rowid LIMIT 500 OFFSET ?",
      offset,
    );
    if (!states.length) break;
    kernel.uow.write((ctx) => {
      for (const state of states)
        kernel.chat.repo.putState(
          state.user,
          kernel.chat.state(state.user, state.conversation),
          ctx.rev,
        );
    });
  }
}

/** SQL presence alone does not prove that the client can decode a migrated row. */
export function verifyProjections(target: Db): string[] {
  const mismatches: string[] = [];
  for (const [table, column, schema] of [
    ["library_states", "body", libraryStateSchema],
    ["chat_posts", "data", postSchema],
    ["chat_states", "data", chatStateSchema],
  ] as const) {
    let invalid = 0;
    for (let offset = 0; ; offset += 500) {
      const rows = target.all<{ data: string }>(
        `SELECT ${column} data FROM ${table} ORDER BY rowid LIMIT 500 OFFSET ?`,
        offset,
      );
      if (!rows.length) break;
      for (const row of rows) {
        try {
          if (!schema.safeParse(JSON.parse(row.data)).success) invalid++;
        } catch {
          invalid++;
        }
      }
    }
    if (invalid)
      mismatches.push(`${table}: ${invalid} rows fail client schema`);
  }
  const missingNames = target.get<{ n: number }>(
    "SELECT count(*) n FROM chat_posts p JOIN users u ON p.author=u.id WHERE json_extract(p.data,'$.authorName') IS NOT u.name",
  )!.n;
  if (missingNames)
    mismatches.push(`chat_posts: ${missingNames} author names differ`);
  const staleStates = target.get<{ n: number }>(
    "SELECT count(*) n FROM chat_states s WHERE json_extract(s.data,'$.lastPost.id') IS NOT (SELECT p.id FROM chat_posts p WHERE p.conversation=s.conversation ORDER BY p.seq DESC LIMIT 1)",
  )!.n;
  if (staleStates)
    mismatches.push(
      `chat_states: ${staleStates} latest-message previews differ`,
    );
  return mismatches;
}
