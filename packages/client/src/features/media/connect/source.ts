import { useSyncExternalStore } from "react";
import type { MediaTrack } from "@talos/contract";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import {
  errorMessage,
  playlistOfPage,
  searchTracks,
} from "../model/actions.ts";
import type { MediaData } from "../model/data.ts";

/** The track sources of the list pane besides playlists. */
export type MediaSource = "recent" | "favorite" | "search";
const SOURCE = "source:";
const SOURCES: readonly MediaSource[] = ["recent", "favorite", "search"];

/**
 * Which source the content pane shows: a playlist page on top of the media stack, a
 * source page, or the home page (最近). Pages keep narrow windows stacked and survive reloads.
 */
export function useMediaSelection(data: MediaData): {
  source: MediaSource;
  playlist: MediaData["playlists"][number] | undefined;
} {
  const stack = useClientSnapshot().nav.areas.media.stack;
  const top = stack[stack.length - 1];
  const playlist = playlistOfPage(data, top);
  const id =
    top?.kind === "page" && top.id.indexOf(SOURCE) === 0
      ? (top.id.slice(SOURCE.length) as MediaSource)
      : "recent";
  return {
    source: SOURCES.indexOf(id) >= 0 ? id : "recent",
    playlist,
  };
}

/** Returns to the media home page, then opens the given page (if any). */
export function useMediaNavigate(): (page?: string) => void {
  const runtime = useRuntime(),
    stack = useClientSnapshot().nav.areas.media.stack;
  return (page) => {
    for (let i = stack.length - 1; i > 0; i--)
      runtime.dispatch({ type: "back" });
    if (page)
      runtime.dispatch({
        type: "pushPage",
        area: "media",
        page: { kind: "page", id: page },
      });
  };
}
export const sourcePageId = (source: MediaSource): string => SOURCE + source;

interface SearchState {
  user: string | undefined;
  query: string;
  results: MediaTrack[];
  busy: boolean;
  error: string;
  /** A search ran in this session (the 搜索结果 entry is shown). */
  searched: boolean;
}
const blank = (user: string | undefined): SearchState => ({
  user,
  query: "",
  results: [],
  busy: false,
  error: "",
  searched: false,
});
let state = blank(undefined);
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const read = () => state;
function patch(user: string | undefined, value: Partial<SearchState>): void {
  state = { ...(state.user === user ? state : blank(user)), ...value };
  listeners.forEach((listener) => listener());
}

/** Search query and results, shared by the list pane (field) and the content pane (results). */
export function useMediaSearch(): SearchState & {
  setQuery(query: string): void;
  search(): Promise<void>;
} {
  const runtime = useRuntime(),
    user = useClientSnapshot().user?.id;
  const current = useSyncExternalStore(subscribe, read, read);
  const own = current.user === user ? current : blank(user);
  return {
    ...own,
    setQuery: (query) => patch(user, { query }),
    search: async () => {
      const query = state.user === user ? state.query : "";
      if (!query.trim()) return;
      patch(user, { busy: true, searched: true });
      try {
        patch(user, {
          results: await searchTracks(runtime, query),
          error: "",
        });
      } catch (e) {
        patch(user, { error: errorMessage(e) });
      } finally {
        patch(user, { busy: false });
      }
    },
  };
}
