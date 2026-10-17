import { accessSections } from "../../../core/ranking/index.ts";
import type { AccessRef, AccessSnapshot } from "../../../core/ranking/index.ts";
import type { MediaData } from "./data.ts";

export interface MediaRecentItem {
  kind: "song" | "playlist";
  id: string;
  title: string;
  hint: string;
}
export interface MediaRecents {
  recent: MediaRecentItem[];
  frequent: MediaRecentItem[];
}

/** Songs and playlists played or opened lately, and the ones used often. */
export function mediaRecents(
  data: MediaData,
  access: AccessSnapshot,
  now: number,
): MediaRecents {
  const tracks = new Map(data.tracks.map((track) => [track.id, track])),
    lists = new Map(data.playlists.map((list) => [list.id, list]));
  const sections = accessSections(
    access,
    ["song", "playlist"],
    now,
    (kind, id) => (kind === "song" ? tracks.has(id) : lists.has(id)),
  );
  const items = (refs: readonly AccessRef[]): MediaRecentItem[] => {
    const out: MediaRecentItem[] = [];
    for (const ref of refs) {
      const track = ref.kind === "song" ? tracks.get(ref.id) : undefined,
        list = ref.kind === "playlist" ? lists.get(ref.id) : undefined;
      if (track)
        out.push({
          kind: "song",
          id: track.id,
          title: track.title,
          hint: track.artists.join(" / "),
        });
      else if (list)
        out.push({
          kind: "playlist",
          id: list.id,
          title: list.title,
          hint: `歌单 · ${list.tracks.length} 首`,
        });
    }
    return out;
  };
  return { recent: items(sections.recent), frequent: items(sections.frequent) };
}
