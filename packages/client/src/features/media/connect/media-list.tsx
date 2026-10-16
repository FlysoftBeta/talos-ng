import { useState } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import {
  canCreatePlaylist,
  createPlaylist,
  emptyState,
  errorMessage,
  playlistPageId,
  tabTracks,
} from "../model/actions.ts";
import { MediaListView, MediaTile } from "../view/media-list.tsx";
import { mediaRecents } from "../model/recent.ts";
import type { MediaRecentItem } from "../model/recent.ts";
import {
  useAccessEntries,
  useAccessHistory,
} from "../../../platform/react/use-access-history.ts";
import { useMediaPlayer } from "./player.tsx";
import {
  sourcePageId,
  useMediaNavigate,
  useMediaSearch,
  useMediaSelection,
} from "./source.ts";
import { useMedia } from "./use-media.ts";

export function MediaList(): ReactElement {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    data = useMedia(),
    search = useMediaSearch(),
    navigate = useMediaNavigate(),
    selection = useMediaSelection(data),
    canSearch = useCan(contract.media.search),
    player = useMediaPlayer(),
    access = useAccessEntries(useAccessHistory());
  const recents = mediaRecents(data, access, Date.now());
  const view = (item: MediaRecentItem) => ({
    id: `${item.kind}:${item.id}`,
    title: item.title,
    hint: item.hint,
    leading: <MediaTile icon={item.kind === "song" ? "media" : "list"} />,
    selected: item.kind === "playlist" && selection.playlist?.id === item.id,
    onOpen: () => {
      if (item.kind === "playlist") return navigate(playlistPageId(item.id));
      const track = data.tracks.find((t) => t.id === item.id);
      if (track) void player.play(track);
    },
  });
  const [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [createError, setCreateError] = useState("");
  const reason = canSearch.ok ? undefined : canSearch.reason;
  return (
    <MediaListView
      query={search.query}
      onQuery={search.setQuery}
      onSearch={() => {
        navigate(sourcePageId("search"));
        void search.search();
      }}
      searchDisabled={search.busy || !search.query.trim()}
      searchReason={reason}
      source={selection.playlist ? undefined : selection.source}
      counts={{
        recent: tabTracks("recent", data, []).length,
        favorite: tabTracks("favorite", data, []).length,
        search: search.results.length,
      }}
      searched={search.searched}
      onSource={(id) => navigate(sourcePageId(id))}
      playlists={data.playlists.map((p) => ({
        id: p.id,
        title: p.title,
        hint: `${p.tracks.length} 首 · 离线保留`,
        selected: selection.playlist?.id === p.id,
      }))}
      playlistsState={emptyState(snapshot.status.connection)}
      createReason={reason}
      onCreate={() => setCreating(true)}
      onOpenPlaylist={(id) => navigate(playlistPageId(id))}
      recent={recents.recent.map(view)}
      frequent={recents.frequent.map(view)}
      creating={
        creating
          ? {
              title,
              onTitle: setTitle,
              canCreate: canCreatePlaylist(title),
              error: createError,
              onCreate: () => {
                void createPlaylist(runtime, title)
                  .then((created) => {
                    if (!created) return;
                    setCreating(false);
                    setTitle("");
                    setCreateError("");
                  })
                  .catch((e) => setCreateError(errorMessage(e)));
              },
              onClose: () => setCreating(false),
            }
          : undefined
      }
    />
  );
}
