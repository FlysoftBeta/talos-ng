import {
  libraryRetentionEntitySchema,
  libraryCollectionSchema,
  libraryDocSchema,
  libraryStateSchema,
} from "@talos/contract";
import type {
  LibraryRetention,
  LibraryCollection,
  LibraryDoc,
  LibraryState,
} from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
export interface LibraryData {
  retentions: Map<string, LibraryRetention>;
  docs: LibraryDoc[];
  collections: LibraryCollection[];
  states: Map<string, LibraryState>;
  rows: readonly StoredRow[];
}
export function decodeLibrary(
  rows: readonly StoredRow[],
  user?: string,
): LibraryData {
  const docs = new Map<string, LibraryDoc>(),
    collections = new Map<string, LibraryCollection>(),
    states = new Map<string, LibraryState>();
  const admitted = new Map(
    rows
      .filter((row) => !row.deleted && row.type === "libraryCollection")
      .map((row) => [row.scope, libraryCollectionSchema.safeParse(row.data)]),
  );
  const retentions = new Map<string, LibraryRetention>();
  for (const row of rows.slice().sort((a, b) => a.rev - b.rev)) {
    if (row.deleted) continue;
    if (
      row.type === "libraryRetention" &&
      row.scope.startsWith("me:") &&
      (!user || row.scope === `me:${user}`)
    ) {
      const value = libraryRetentionEntitySchema.safeParse(row.data);
      if (value.success) retentions.set(row.id, value.data);
    }
    if (row.type === "libraryDoc") {
      if (row.scope.startsWith("coll:")) {
        const collection = admitted.get(row.scope);
        if (!collection?.success || !collection.data.docs.includes(row.id))
          continue;
      }
      const value = libraryDocSchema.safeParse(row.data);
      if (value.success) docs.set(row.id, value.data);
    }
    if (row.type === "libraryCollection") {
      const value = libraryCollectionSchema.safeParse(row.data);
      if (value.success) collections.set(row.id, value.data);
    }
    if (row.type === "libraryState") {
      const value = libraryStateSchema.safeParse(row.data);
      if (value.success) states.set(row.id, value.data);
    }
  }
  return {
    retentions,
    docs: Array.from(docs.values()).sort(
      (a, b) =>
        (states.get(b.id)?.lastRead ?? b.created) -
        (states.get(a.id)?.lastRead ?? a.created),
    ),
    collections: Array.from(collections.values()),
    states,
    rows,
  };
}
export function collectionLevel(
  data: LibraryData,
  collection: LibraryCollection,
  user: string,
): CollectionLevel {
  if (collection.owner === user) return "own";
  let level: CollectionLevel = "read";
  for (const row of data.rows) {
    if (row.type !== "grant") continue;
    const grant = row.data as { resource?: string; level?: string };
    if (grant.resource !== `coll:${collection.id}`) continue;
    if (grant.level === "own") return "own";
    if (grant.level === "write") level = "write";
  }
  return level;
}
export type CollectionLevel = "read" | "write" | "own";
export interface ListRowModel {
  id: string;
  title: string;
  hint: string;
  selected: boolean;
}
export type LibraryTab = "recent" | "collections";
/** The page on top of the library area's navigation stack. */
export interface ActivePage {
  kind: string;
  id?: string;
}
export const collectionPageId = (id: string): string => `collection:${id}`;
/** Collection id addressed by a library page, if the page is a collection page. */
export function collectionOfPage(page: ActivePage): string | undefined {
  return page.kind === "page" && page.id?.startsWith("collection:")
    ? page.id.slice("collection:".length)
    : undefined;
}
/** Group conversations a collection may be attached to. */
export function groupChoices(
  data: LibraryData,
): { id: string; title: string }[] {
  return data.rows
    .filter(
      (row) =>
        row.type === "communityConversation" &&
        (row.data as { kind?: string }).kind === "group",
    )
    .map((row) => ({
      id: row.id,
      title:
        (row.data as { title?: string; name?: string }).title ??
        (row.data as { name?: string }).name ??
        row.id,
    }));
}
export function documentHint(doc: LibraryDoc): string {
  return doc.status === "processing"
    ? "正在转换 · 查看任务"
    : `${doc.kind === "paged" ? `${doc.units} 页` : `${doc.chars} 字`} · ${new Date(doc.created).toLocaleDateString("zh-CN")}`;
}
/** Recently read or imported documents, ordered by decodeLibrary. */
export function documentRows(
  data: LibraryData,
  active: ActivePage | undefined,
): ListRowModel[] {
  return data.docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    selected: active?.kind === "document" && active.id === doc.id,
    hint: documentHint(doc),
  }));
}
/** Collection rows of the booklist tab, optionally narrowed to one group. */
export function collectionRows(
  data: LibraryData,
  group: string,
  active: ActivePage | undefined,
): ListRowModel[] {
  return data.collections
    .filter((c) => !group || c.group === group)
    .map((c) => ({
      id: c.id,
      title: c.title,
      hint: `${c.docs.length} 份文档`,
      selected: active?.kind === "page" && active.id === collectionPageId(c.id),
    }));
}
/** Built-ins stay in a fixed order at the top of recent view, even when empty. */
export function builtinRows(
  data: LibraryData,
  active: ActivePage | undefined,
): ListRowModel[] {
  return collectionRows(
    {
      ...data,
      collections: data.collections
        .filter((c) => !!c.builtin)
        .sort(
          (a, b) =>
            (a.builtin === "shelf" ? 0 : 1) - (b.builtin === "shelf" ? 0 : 1),
        ),
    },
    "",
    active,
  );
}
/** Collections a user may add documents to; targets of downloads and imports. */
export function writableCollections(
  data: LibraryData,
  user: string,
): { id: string; title: string }[] {
  return data.collections
    .filter((c) => collectionLevel(data, c, user) !== "read")
    .map((c) => ({ id: c.id, title: c.title }));
}
/** Placeholder shown when recent view has no documents. */
export function emptyShelf(connection: string): {
  state: "offline" | "empty" | "loading";
  title: string;
} {
  const loading = connection === "syncing" || connection === "connecting";
  return {
    state: loading ? "loading" : connection === "offline" ? "offline" : "empty",
    title: loading ? "正在同步文档" : "还没有文档",
  };
}

/** Missing local rows cannot establish deletion while sync is incomplete or offline. */
export function missingCollection(connection: string): {
  state: "loading" | "offline" | "forbidden";
  title: string;
  hint: string;
} {
  if (connection === "syncing" || connection === "connecting")
    return {
      state: "loading",
      title: "正在同步书单",
      hint: "同步完成后会自动显示",
    };
  if (connection === "offline")
    return {
      state: "offline",
      title: "此书单尚未缓存在本机",
      hint: "连接服务器后重试",
    };
  return {
    state: "forbidden",
    title: "书单不可用",
    hint: "书单已删除或访问权限已撤销",
  };
}
