import { selectFrecent, selectFrequent, selectRecent } from "./frecency.ts";
import type { CutOff, Ranked } from "./frecency.ts";
import { parseAccessKey } from "./history.ts";
import type { AccessKind, AccessSnapshot } from "./history.ts";

export interface AccessRef {
  kind: AccessKind;
  id: string;
}
export type AccessExists = (kind: AccessKind, id: string) => boolean;

function candidates(
  entries: AccessSnapshot,
  kinds: readonly AccessKind[],
  exists: AccessExists,
): Ranked[] {
  const out: Ranked[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    const ref = parseAccessKey(key);
    // Items that vanished (deleted, access lost) must not use up the cut-off.
    if (ref && kinds.includes(ref.kind) && exists(ref.kind, ref.id))
      out.push({ key, entry });
  }
  return out;
}
const refs = (keys: readonly string[]): AccessRef[] => {
  const out: AccessRef[] = [];
  for (const key of keys) {
    const ref = parseAccessKey(key);
    if (ref) out.push(ref);
  }
  return out;
};

/** One mixed list ranked by frecency with a variable-length cut-off. */
export function accessFrecent(
  entries: AccessSnapshot,
  kinds: readonly AccessKind[],
  now: number,
  exists: AccessExists,
  cutOff?: Partial<CutOff>,
): AccessRef[] {
  return refs(selectFrecent(candidates(entries, kinds, exists), now, cutOff));
}

/** Recently opened items, then frequently opened ones the first list does not repeat. */
export function accessSections(
  entries: AccessSnapshot,
  kinds: readonly AccessKind[],
  now: number,
  exists: AccessExists,
): { recent: AccessRef[]; frequent: AccessRef[] } {
  const items = candidates(entries, kinds, exists),
    recent = selectRecent(items, now);
  return {
    recent: refs(recent),
    frequent: refs(selectFrequent(items, now, recent)),
  };
}
