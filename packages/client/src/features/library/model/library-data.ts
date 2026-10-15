import {
  libraryCollectionSchema,
  libraryDocSchema,
  libraryStateSchema,
} from "@talos/contract";
import type {
  LibraryCollection,
  LibraryDoc,
  LibraryState,
} from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
export interface LibraryData {
  docs: LibraryDoc[];
  collections: LibraryCollection[];
  states: Map<string, LibraryState>;
  rows: readonly StoredRow[];
}
export function decodeLibrary(rows: readonly StoredRow[]): LibraryData {
  const docs = new Map<string, LibraryDoc>(),
    collections = new Map<string, LibraryCollection>(),
    states = new Map<string, LibraryState>();
  const admitted = new Map(
    rows
      .filter((row) => !row.deleted && row.type === "libraryCollection")
      .map((row) => [row.scope, libraryCollectionSchema.safeParse(row.data)]),
  );
  for (const row of rows.slice().sort((a, b) => a.rev - b.rev)) {
    if (row.deleted) continue;
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
  state: "offline" | "empty";
  title: string;
} {
  return {
    state: connection === "offline" ? "offline" : "empty",
    title: "还没有文档",
  };
}
