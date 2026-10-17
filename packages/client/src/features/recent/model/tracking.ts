import type { AccessKind } from "../../../core/ranking/index.ts";
import type { AreaId, Nav, Page } from "../../../core/navigation/index.ts";

export interface TrackedRef {
  kind: AccessKind;
  id: string;
}

const COLLECTION = "collection:";
const PLAYLIST = "playlist:";

/** What opening this page counts as, if anything. */
export function pageRef(
  area: AreaId,
  page: Page | undefined,
): TrackedRef | undefined {
  if (!page) return undefined;
  if (area === "chat" && page.kind === "conversation")
    return { kind: "chat", id: page.id };
  if (area === "library" && page.kind === "document")
    return { kind: "book", id: page.id };
  if (
    area === "library" &&
    page.kind === "page" &&
    page.id.startsWith(COLLECTION)
  )
    return { kind: "booklist", id: page.id.slice(COLLECTION.length) };
  if (area === "media" && page.kind === "page" && page.id.startsWith(PLAYLIST))
    return { kind: "playlist", id: page.id.slice(PLAYLIST.length) };
  return undefined;
}

/** The tracked item on top of each area's stack, keyed by area. */
export function visibleRefs(nav: Nav): Map<AreaId, TrackedRef> {
  const out = new Map<AreaId, TrackedRef>();
  for (const area of ["chat", "library", "media"] as const) {
    const stack = nav.areas[area].stack,
      ref = pageRef(area, stack[stack.length - 1]);
    if (ref) out.set(area, ref);
  }
  return out;
}

/** Refs that became visible since `previous`; a ref already visible is not a new open. */
export function newOpens(
  previous: ReadonlyMap<AreaId, TrackedRef>,
  next: ReadonlyMap<AreaId, TrackedRef>,
): TrackedRef[] {
  const out: TrackedRef[] = [];
  next.forEach((ref, area) => {
    const before = previous.get(area);
    if (!before || before.kind !== ref.kind || before.id !== ref.id)
      out.push(ref);
  });
  return out;
}
