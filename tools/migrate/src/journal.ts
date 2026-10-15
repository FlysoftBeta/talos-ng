import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { Db } from "@talos/server/migration";

import type { LegacyRow } from "./types.ts";
import { value } from "./values.ts";

export function rev(db: Db): number {
  db.run("UPDATE _revision SET rev=rev+1 WHERE id=1");
  return db.get<{ rev: number }>("SELECT rev FROM _revision WHERE id=1")!.rev;
}
export function mapped(db: Db, entity: string, id: string): string | undefined {
  return db.get<{ new_id: string }>(
    "SELECT new_id FROM migration_map WHERE entity=? AND legacy_id=?",
    entity,
    id,
  )?.new_id;
}
export const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function legacyUlid(entity: string, id: string): string {
  // Zero time plus an 80-bit domain-separated digest gives repeatable, canonical ULIDs.
  const digest = createHash("sha256")
    .update(entity)
    .update("\0")
    .update(id)
    .digest();
  let suffix = "";
  for (let i = 0; i < 16; i++) {
    let index = 0;
    for (let bit = 0; bit < 5; bit++) {
      const n = i * 5 + bit;
      index = (index << 1) | ((digest[n >> 3]! >> (7 - (n & 7))) & 1);
    }
    suffix += alphabet[index];
  }
  return "0000000000" + suffix;
}
export function mapId(db: Db, entity: string, id: string): string {
  return mapped(db, entity, id) ?? legacyUlid(entity, id);
}
export function issue(
  db: Db,
  entity: string,
  id: string,
  reason: string,
): void {
  db.run(
    "INSERT OR IGNORE INTO migration_issues(entity,legacy_id,reason) VALUES(?,?,?)",
    entity,
    id,
    reason,
  );
}
export function sourceId(row: LegacyRow): string {
  return value(row, "id") || sourceHash(row);
}
export function setup(db: Db): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migration_map(entity TEXT NOT NULL,legacy_id TEXT NOT NULL,new_id TEXT NOT NULL,source_hash TEXT NOT NULL,PRIMARY KEY(entity,legacy_id)) STRICT; CREATE TABLE IF NOT EXISTS migration_issues(entity TEXT NOT NULL,legacy_id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(entity,legacy_id,reason)) STRICT; CREATE TABLE IF NOT EXISTS migration_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS migration_roles(user_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(user_id,role)) STRICT; CREATE TABLE IF NOT EXISTS migration_parents(child TEXT PRIMARY KEY,parent TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS migration_text_segments(article_id TEXT NOT NULL,segment_index INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(article_id,segment_index)) STRICT; CREATE TABLE IF NOT EXISTS migration_documents(legacy_id TEXT PRIMARY KEY,source_id TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS migration_images(legacy_id TEXT PRIMARY KEY,original_id TEXT NOT NULL,thumbnail_id TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS migration_sticker_refs(post_id TEXT PRIMARY KEY,pack TEXT NOT NULL,sticker_id TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0) STRICT; CREATE TABLE IF NOT EXISTS migration_media_objects(legacy_id TEXT PRIMARY KEY,object_id TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS migration_workspace_rows(legacy_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,blob_id TEXT NOT NULL,object_id TEXT) STRICT; CREATE TABLE IF NOT EXISTS migration_workspace_files(user_id TEXT NOT NULL,path TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(user_id,path)) STRICT;`,
  );
}
export function sourceHash(row: LegacyRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify(row, (_, v) =>
        v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v,
      ),
    )
    .digest("hex");
}
export async function sourceFingerprint(
  path: string,
  secret: string,
): Promise<string> {
  const hash = createHash("sha256").update(secret);
  for (const filename of [path, `${path}-wal`]) {
    hash.update(filename === path ? "db" : "wal");
    if (!existsSync(filename)) {
      hash.update("absent");
      continue;
    }
    for await (const chunk of createReadStream(filename, {
      highWaterMark: 256 * 1024,
    }))
      hash.update(chunk as Uint8Array);
  }
  return hash.digest("hex");
}
