import { AppError } from "@talos/base";
import type { LegacyDb } from "../legacy/db.ts";
import { owner as legacyOwner } from "../legacy/access.ts";
import { Db } from "@talos/server/migration";

import type { LegacyRow } from "../types.ts";
import { value, number, time, json } from "../values.ts";
import { rev, legacyUlid, mapId, issue } from "../journal.ts";

export function importLibrary(
  target: Db,
  table: string,
  row: LegacyRow,
  legacyId: string,
  source?: LegacyDb,
): string {
  const id = mapId(target, table, legacyId);
  const r = rev(target);
  const user = (key: string): string => mapId(target, "users", value(row, key));
  const group = (key: string): string =>
    mapId(target, "groups", value(row, key));
  const hasUser = (id: string): boolean =>
    !!target.get("SELECT 1 FROM users WHERE id=?", id);
  switch (table) {
    case "articles": {
      let owner = user("user_id");
      if (!hasUser(owner)) {
        if (row.user_id) throw new AppError("E_INVALID", "orphan article");
        owner =
          target.get<{ id: string }>(
            "SELECT id FROM users WHERE deleted=0 ORDER BY created,id LIMIT 1",
          )?.id ?? "";
        if (!owner)
          throw new AppError("E_INVALID", "no owner for ownerless article");
        issue(
          target,
          table,
          legacyId,
          "Ownerless article assigned earliest imported user; bearer-token recovery replaced by readable collection access (D-076)",
        );
      }
      const provider = json(row.provider_json, {});
      const isText = (provider as { type?: string }).type === "text";
      const body = {
        id,
        title: value(row, "title").slice(0, 200) || "Untitled",
        owner,
        created: time(row.created_at),
        kind: isText ? "flow" : "paged",
        status: "processing",
        pack: null,
        units: 0,
        chars: 0,
      };
      target.run(
        "INSERT INTO library_documents VALUES(?,?,?,?,?,?,0)",
        id,
        owner,
        "",
        value(row, "title"),
        JSON.stringify(body),
        r,
      );
      if (!isText)
        issue(
          target,
          table,
          id,
          "PDF source requires docpipe rerender; queued for manual recovery",
        );
      break;
    }
    case "text_article_segments": {
      const article = mapId(target, "articles", value(row, "article_id"));
      if (!target.get("SELECT 1 FROM library_documents WHERE id=?", article))
        throw new AppError("E_INVALID", "orphan segment");
      target.run(
        "INSERT OR IGNORE INTO migration_text_segments(article_id,segment_index,content) VALUES(?,?,?)",
        article,
        number(row, "segment_index"),
        value(row, "content"),
      );
      break;
    }
    case "booklists": {
      if (!source) throw new AppError("E_INVALID", "Missing legacy source");
      const owner = legacyOwner(source, target, "booklist", legacyId);
      const body = {
        id,
        title: value(row, "title").slice(0, 200) || "Untitled",
        owner,
        group: null,
        docs: [],
      };
      target.run(
        "INSERT INTO library_collections VALUES(?,?,?,?,0)",
        id,
        owner,
        JSON.stringify(body),
        r,
      );
      break;
    }
    case "booklist_items":
      if (
        target.get(
          "SELECT 1 FROM library_collections WHERE id=?",
          mapId(target, "booklists", value(row, "booklist_id")),
        ) &&
        target.get(
          "SELECT 1 FROM library_documents WHERE id=?",
          mapId(target, "articles", value(row, "article_id")),
        )
      )
        target.run(
          "INSERT OR IGNORE INTO library_items VALUES(?,?,?,0)",
          mapId(target, "booklists", value(row, "booklist_id")),
          mapId(target, "articles", value(row, "article_id")),
          r,
        );
      else throw new AppError("E_INVALID", "orphan booklist item");
      break;
    case "group_booklists":
      target.run(
        "UPDATE library_collections SET body=json_set(body,'$.group',?) WHERE id=?",
        group("group_id"),
        mapId(target, "booklists", value(row, "booklist_id")),
      );
      break;
    case "user_favorites":
    case "article_read_progress": {
      const u = user("user_id"),
        doc = mapId(
          target,
          "articles",
          value(row, table === "user_favorites" ? "resource_id" : "article_id"),
        );
      if (!hasUser(u)) throw new AppError("E_INVALID", "orphan reading state");
      if (
        table === "user_favorites" &&
        value(row, "resource_kind") !== "article"
      ) {
        issue(
          target,
          table,
          legacyId,
          "Unsupported favourite kind: only article and track favourites have target state",
        );
        break;
      }
      if (!target.get("SELECT 1 FROM library_documents WHERE id=?", doc))
        throw new AppError("E_INVALID", "orphan reading state");
      const old = target.get<{ body: string }>(
        "SELECT body FROM library_states WHERE user_id=? AND id=?",
        u,
        doc,
      );
      const state = old
        ? (JSON.parse(old.body) as Record<string, unknown>)
        : {
            id: doc,
            favourite: null,
            resume: null,
            furthest: 0,
            seconds: {},
            retention: null,
            lastRead: 0,
          };
      const t =
        table === "user_favorites"
          ? number(row, "updated_at_ms")
          : number(row, "updated_at_ms");
      const stamp = {
        t: { ms: t, counter: 0 },
        op: "00000000000000000000000000",
      };
      if (table === "user_favorites")
        state.favourite = { v: !!row.favorited, ...stamp };
      else {
        state.resume = {
          v: { unit: 0, offset: number(row, "offset") },
          ...stamp,
        };
        state.furthest = number(row, "offset");
        state.seconds = {
          [legacyUlid("device", "legacy")]: number(row, "total_read_seconds"),
        };
        state.lastRead = t;
      }
      target.run(
        "INSERT INTO library_states VALUES(?,?,?,?,0) ON CONFLICT(user_id,id) DO UPDATE SET body=excluded.body,rev=excluded.rev",
        u,
        doc,
        JSON.stringify(state),
        r,
      );
      break;
    }
    case "resource_possession":
      issue(
        target,
        table,
        legacyId,
        "F-144 bearer token discarded; access is recovered only through currently readable collections (D-076), favourites confer no authority",
      );
      break;
    case "access_bindings":
      break; // Authority/delegation imported after all collections exist.
  }
  return id;
}
