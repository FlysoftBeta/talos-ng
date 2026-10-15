import { verifyProjections } from "./target/projections.ts";
import { verifyCounts } from "./verify-counts.ts";
import { verifyBlobs } from "./verify-blobs.ts";
import type { Options } from "./types.ts";
import { exists } from "./legacy/db.ts";
import { createHash } from "node:crypto";
import { LegacyDb } from "./legacy/db.ts";

import { mapId, sourceId, sourceHash } from "./journal.ts";
import { Db } from "@talos/server/migration";

import type { LegacyRow } from "./types.ts";
import { value, json } from "./values.ts";

export function targetContent(
  target: Db,
  table: string,
  id: string,
): string | undefined {
  switch (table) {
    case "posts":
      return target.get<{ body: string }>(
        "SELECT body FROM chat_posts WHERE id=?",
        id,
      )?.body;
    case "articles": {
      const row = target.get<{ body: string }>(
        "SELECT body FROM library_documents WHERE id=?",
        id,
      );
      return row ? (json(row.body, {}) as { title?: string }).title : undefined;
    }
    case "words": {
      const row = target.get<{ english: string; definition: string }>(
        "SELECT english,definition FROM learning_words WHERE id=?",
        id,
      );
      return row ? `${row.english}\0${row.definition}` : undefined;
    }
    case "ai_messages": {
      const row = target.get<{ data: string }>(
        "SELECT data FROM ai_messages WHERE id=?",
        id,
      );
      return row ? (json(row.data, {}) as { text?: string }).text : undefined;
    }
    case "users":
      return target.get<{ name: string }>(
        "SELECT name FROM users WHERE id=?",
        id,
      )?.name;
    default:
      return undefined;
  }
}
export function sourceContent(
  table: string,
  row: LegacyRow,
): string | undefined {
  switch (table) {
    case "posts":
      return value(row, "brief");
    case "articles":
      return value(row, "title").slice(0, 200) || "Untitled";
    case "words":
      return `${value(row, "english").slice(0, 128)}\0${value(row, "definition").slice(0, 2000)}`;
    case "ai_messages":
      return value(row, "content");
    case "users":
      return value(row, "username").slice(0, 30) || value(row, "handle");
    default:
      return undefined;
  }
}

export async function verifyRows(
  source: LegacyDb,
  target: Db,
  counts: Record<string, number>,
  migrated: Record<string, number>,
  issueCount: number,
  failedJobCount: number,
  options: Options,
): Promise<void> {
  const entities = verifyCounts(source, target, Object.keys(counts));
  const mismatches: string[] = [
    ...entities.mismatches,
    ...verifyProjections(target),
    ...(await verifyBlobs(source, target, options)),
  ];
  for (const table of Object.keys(counts)) {
    if (migrated[table] !== counts[table])
      mismatches.push(`${table}: journal ${migrated[table]}/${counts[table]}`);
    const sql =
      table === "users"
        ? "SELECT count(*) n FROM users"
        : table === "posts"
          ? "SELECT count(*) n FROM chat_posts"
          : table === "articles"
            ? "SELECT count(*) n FROM library_documents"
            : table === "words"
              ? "SELECT count(*) n FROM learning_words"
              : table === "ai_messages"
                ? "SELECT count(*) n FROM ai_messages"
                : table === "ai_conversations"
                  ? "SELECT count(*) n FROM ai_rows WHERE type='aiConversation'"
                  : null;
    if (sql) {
      const actual = target.get<{ n: number }>(sql)!.n;
      if (actual !== counts[table])
        mismatches.push(`${table}: target ${actual}/${counts[table]}`);
    }
    for (const offset of new Set([
      0,
      Math.floor((counts[table] ?? 0) / 2),
      (counts[table] ?? 0) - 1,
    ])) {
      if (offset < 0) continue;
      const row = source.all<LegacyRow>(
        `SELECT * FROM "${table}" ORDER BY rowid LIMIT 1 OFFSET ?`,
        offset,
      )[0];
      if (!row) continue;
      const legacyId = sourceId(row),
        recorded = target.get<{ new_id: string; source_hash: string }>(
          "SELECT new_id,source_hash FROM migration_map WHERE entity=? AND legacy_id=?",
          table,
          legacyId,
        );
      if (recorded?.source_hash !== sourceHash(row))
        mismatches.push(`${table}/${legacyId}: source hash differs`);
      const sourceValue = sourceContent(table, row),
        actual = recorded && targetContent(target, table, recorded.new_id);
      if (
        sourceValue !== undefined &&
        createHash("sha256").update(sourceValue).digest("hex") !==
          createHash("sha256")
            .update(actual ?? "")
            .digest("hex")
      )
        mismatches.push(`${table}/${legacyId}: content hash differs`);
    }
  }
  if (exists(source, "ai_credit_accounts")) {
    const expected = source.get<{ n: number }>(
      "SELECT coalesce(sum(top_up_credit_micros),0) n FROM ai_credit_accounts",
    )!.n;
    const actual = target.get<{ n: number }>(
      "SELECT coalesce(sum(topup),0) n FROM ai_accounts",
    )!.n;
    if (expected !== actual)
      mismatches.push(`AI balance sum differs: ${actual}/${expected}`);
    for (let offset = 0; ; offset += 500) {
      const rows = source.all<LegacyRow>(
        "SELECT * FROM ai_credit_accounts ORDER BY rowid LIMIT 500 OFFSET ?",
        offset,
      );
      if (!rows.length) break;
      for (const row of rows) {
        const user = mapId(target, "users", value(row, "user_id"));
        if (
          target.get<{ topup: number }>(
            "SELECT topup FROM ai_accounts WHERE user=?",
            user,
          )?.topup !== row.top_up_credit_micros
        )
          mismatches.push(`AI balance differs: ${user}`);
      }
    }
  }
  if (exists(source, "ai_credit_ledger")) {
    const expected = source.get<{ n: number }>(
      "SELECT coalesce(sum(delta_credit_micros),0) n FROM ai_credit_ledger",
    )!.n;
    const actual = target.get<{ n: number }>(
      "SELECT coalesce(sum(amount),0) n FROM ai_ledger",
    )!.n;
    if (expected !== actual)
      mismatches.push(`AI ledger delta sum differs: ${actual}/${expected}`);
  }
  if (
    target.get<{ n: number }>(
      "SELECT coalesce(sum(reserved-charged),0) n FROM ai_runs WHERE state IN ('queued','running')",
    )!.n !== 0
  )
    mismatches.push("AI active reservations are not zero");
  process.stdout.write(
    JSON.stringify(
      {
        counts,
        migrated,
        targetEntities: entities.counts,
        mismatches,
        issues: issueCount,
        failedConversions: failedJobCount,
      },
      null,
      2,
    ) + "\n",
  );
  if (mismatches.length || issueCount || failedJobCount) process.exitCode = 1;
}
