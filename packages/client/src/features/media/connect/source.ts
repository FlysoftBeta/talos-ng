import { useSyncExternalStore } from "react";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { playlistOfPage } from "../model/actions.ts";
import type { OnlineCollection, SearchKind } from "../model/actions.ts";
import { OnlineSearch, emptySearch } from "../model/online-search.ts";
import type { SearchState } from "../model/online-search.ts";
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

const online = new OnlineSearch();

/** Search query and results, shared by the list pane (field) and the content pane (results). */
export function useMediaSearch(): SearchState & {
  setQuery(query: string): void;
  search(kind?: SearchKind): Promise<void>;
  open(collection: OnlineCollection): Promise<void>;
  back(): Promise<void>;
  loadMore(): Promise<void>;
} {
  const runtime = useRuntime(),
    user = useClientSnapshot().user?.id;
  const current = useSyncExternalStore(
    online.subscribe,
    online.get,
    online.get,
  );
  const own = current.user === user ? current : emptySearch(user);
  return {
    ...own,
    setQuery: (query) => online.setQuery(user, query),
    search: (kind) => online.search(user, runtime, kind),
    open: (collection) => online.open(user, runtime, collection),
    back: () => online.back(user, runtime),
    loadMore: () => online.loadMore(user, runtime),
  };
}
