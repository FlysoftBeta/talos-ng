import type { MediaTrack } from "@talos/contract";
import { errorMessage, openCollection, searchTracks } from "./actions.ts";
import type { MediaPage, OnlineCollection, SearchKind } from "./actions.ts";

export interface SearchState {
  user: string | undefined;
  query: string;
  results: MediaTrack[];
  /** The 歌曲/歌单/专辑/歌手 tab of the results. */
  kind: SearchKind;
  collections: OnlineCollection[];
  /** The opened playlist, album or artist whose page is shown; null while listing search hits. */
  opened: OnlineCollection | null;
  /** The opened collections, newest last: an album opened from an artist keeps the artist below. */
  trail: OnlineCollection[];
  /** Offset of the next page, null when everything was loaded. */
  next: number | null;
  busy: boolean;
  error: string;
  /** A search ran in this session (the 搜索结果 entry is shown). */
  searched: boolean;
}
type Port = Parameters<typeof searchTracks>[0];
export const emptySearch = (user: string | undefined): SearchState => ({
  user,
  query: "",
  results: [],
  kind: "song",
  collections: [],
  opened: null,
  trail: [],
  next: null,
  busy: false,
  error: "",
  searched: false,
});
const empty = (): Partial<SearchState> => ({
  results: [],
  collections: [],
  next: null,
});

/**
 * Online search state shared by the list pane (field) and the content pane (tabs, hits and
 * collection pages). It belongs to one account at a time and survives remounts of the panes.
 */
export class OnlineSearch {
  private state = emptySearch(undefined);
  private listeners = new Set<() => void>();
  get = (): SearchState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  private patch(user: string | undefined, value: Partial<SearchState>): void {
    this.state = {
      ...(this.state.user === user ? this.state : emptySearch(user)),
      ...value,
    };
    this.listeners.forEach((listener) => listener());
  }
  private own(user: string | undefined): SearchState {
    return this.state.user === user ? this.state : emptySearch(user);
  }
  setQuery(user: string | undefined, query: string): void {
    this.patch(user, { query });
  }
  private async load(
    user: string | undefined,
    start: Partial<SearchState>,
    fetch: () => Promise<MediaPage>,
  ): Promise<void> {
    this.patch(user, { ...start, busy: true, searched: true });
    try {
      const page = await fetch();
      this.patch(user, {
        results: page.tracks,
        collections: page.collections,
        next: page.next,
        // The server's header carries the cover the search hit did not have.
        opened: page.collection ?? this.state.opened,
        error: "",
      });
    } catch (e) {
      this.patch(user, { error: errorMessage(e) });
    } finally {
      this.patch(user, { busy: false });
    }
  }
  /** Runs the query on a tab (the current one by default), dropping any opened page. */
  async search(
    user: string | undefined,
    port: Port,
    kind?: SearchKind,
  ): Promise<void> {
    const { query, kind: current } = this.own(user);
    if (!query.trim()) return;
    const k = kind ?? current;
    await this.load(
      user,
      { ...empty(), kind: k, trail: [], opened: null },
      () => searchTracks(port, query, k),
    );
  }
  private show(
    user: string | undefined,
    port: Port,
    trail: OnlineCollection[],
  ): Promise<void> {
    const top = trail[trail.length - 1];
    const { query, kind } = this.own(user);
    return this.load(user, { ...empty(), trail, opened: top ?? null }, () =>
      top ? openCollection(port, top) : searchTracks(port, query, kind),
    );
  }
  /** Opens the details page of a playlist, album or artist on top of the current page. */
  open(
    user: string | undefined,
    port: Port,
    collection: OnlineCollection,
  ): Promise<void> {
    return this.show(user, port, [...this.own(user).trail, collection]);
  }
  /** Closes the details page, returning to the page below or to the search hits. */
  back(user: string | undefined, port: Port): Promise<void> {
    return this.show(user, port, this.own(user).trail.slice(0, -1));
  }
  /** Appends the next page of the search hits or of the opened page. */
  async loadMore(user: string | undefined, port: Port): Promise<void> {
    const { next, busy, opened, query, kind } = this.own(user);
    if (next === null || busy || this.state.user !== user) return;
    this.patch(user, { busy: true });
    try {
      const page = opened
        ? await openCollection(port, opened, next)
        : await searchTracks(port, query, kind, next);
      this.patch(user, {
        results: [...this.state.results, ...page.tracks],
        collections: [...this.state.collections, ...page.collections],
        next: page.next,
        error: "",
      });
    } catch (e) {
      this.patch(user, { error: errorMessage(e) });
    } finally {
      this.patch(user, { busy: false });
    }
  }
}
