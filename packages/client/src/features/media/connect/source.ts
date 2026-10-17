import { useSyncExternalStore } from "react";
import type { MediaTrack } from "@talos/contract";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import {
  errorMessage,
  openCollection,
  playlistOfPage,
  searchTracks,
} from "../model/actions.ts";
import type {
  MediaPage,
  OnlineCollection,
  SearchKind,
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
  /** The 歌曲/歌单/歌手 tab of the results. */
  kind: SearchKind;
  collections: OnlineCollection[];
  /** An opened playlist or artist whose tracks fill `results`; null while listing search hits. */
  opened: OnlineCollection | null;
  /** Offset of the next page, null when everything was loaded. */
  next: number | null;
  busy: boolean;
  error: string;
  /** A search ran in this session (the 搜索结果 entry is shown). */
  searched: boolean;
}
const blank = (user: string | undefined): SearchState => ({
  user,
  query: "",
  results: [],
  kind: "song",
  collections: [],
  opened: null,
  next: null,
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

const pageOf = (
  page: MediaPage,
  more: boolean,
): Pick<SearchState, "results" | "collections" | "next"> => ({
  results: more ? [...state.results, ...page.tracks] : page.tracks,
  collections: more
    ? [...state.collections, ...page.collections]
    : page.collections,
  next: page.next,
});

/** Search query and results, shared by the list pane (field) and the content pane (results). */
export function useMediaSearch(): SearchState & {
  setQuery(query: string): void;
  search(kind?: SearchKind): Promise<void>;
  open(collection: OnlineCollection | null): Promise<void>;
  loadMore(): Promise<void>;
} {
  const runtime = useRuntime(),
    user = useClientSnapshot().user?.id;
  const current = useSyncExternalStore(subscribe, read, read);
  const own = current.user === user ? current : blank(user);
  const run = async (
    start: Partial<SearchState>,
    load: () => Promise<MediaPage>,
    more: boolean,
  ) => {
    patch(user, { ...start, busy: true, searched: true });
    try {
      patch(user, { ...pageOf(await load(), more), error: "" });
    } catch (e) {
      patch(user, { error: errorMessage(e) });
    } finally {
      patch(user, { busy: false });
    }
  };
  return {
    ...own,
    setQuery: (query) => patch(user, { query }),
    search: async (kind) => {
      const query = state.user === user ? state.query : "";
      if (!query.trim()) return;
      const k = kind ?? (state.user === user ? state.kind : "song");
      await run(
        { kind: k, opened: null, results: [], collections: [], next: null },
        () => searchTracks(runtime, query, k),
        false,
      );
    },
    open: async (collection) => {
      if (!collection) {
        const { query, kind } = state;
        return run(
          { opened: null, results: [], collections: [], next: null },
          () => searchTracks(runtime, query, kind),
          false,
        );
      }
      await run(
        { opened: collection, results: [], collections: [], next: null },
        () => openCollection(runtime, collection),
        false,
      );
    },
    loadMore: async () => {
      const at = state.next;
      if (at === null || state.busy || state.user !== user) return;
      const { opened, query, kind } = state;
      patch(user, { busy: true });
      try {
        const page = opened
          ? await openCollection(runtime, opened, at)
          : await searchTracks(runtime, query, kind, at);
        patch(user, { ...pageOf(page, true), error: "" });
      } catch (e) {
        patch(user, { error: errorMessage(e) });
      } finally {
        patch(user, { busy: false });
      }
    },
  };
}
