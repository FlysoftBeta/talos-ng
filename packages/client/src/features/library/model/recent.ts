import { accessSections } from "../../../core/ranking/index.ts";
import type { AccessRef, AccessSnapshot } from "../../../core/ranking/index.ts";
import { documentHint } from "./library-data.ts";
import type { LibraryData } from "./library-data.ts";

export interface LibraryRecentItem {
  kind: "book" | "booklist";
  id: string;
  title: string;
  hint: string;
}
export interface LibraryRecents {
  recent: LibraryRecentItem[];
  frequent: LibraryRecentItem[];
}

/** Books and booklists opened lately, and the ones opened often enough to deserve a shortcut. */
export function libraryRecents(
  data: LibraryData,
  access: AccessSnapshot,
  now: number,
): LibraryRecents {
  const docs = new Map(data.docs.map((doc) => [doc.id, doc])),
    lists = new Map(data.collections.map((list) => [list.id, list]));
  const sections = accessSections(
    access,
    ["book", "booklist"],
    now,
    (kind, id) => (kind === "book" ? docs.has(id) : lists.has(id)),
  );
  const items = (refs: readonly AccessRef[]): LibraryRecentItem[] => {
    const out: LibraryRecentItem[] = [];
    for (const ref of refs) {
      const doc = ref.kind === "book" ? docs.get(ref.id) : undefined,
        list = ref.kind === "booklist" ? lists.get(ref.id) : undefined;
      if (doc)
        out.push({
          kind: "book",
          id: doc.id,
          title: doc.title,
          hint: documentHint(doc),
        });
      else if (list)
        out.push({
          kind: "booklist",
          id: list.id,
          title: list.title,
          hint: `书单 · ${list.docs.length} 份文档`,
        });
    }
    return out;
  };
  return { recent: items(sections.recent), frequent: items(sections.frequent) };
}
