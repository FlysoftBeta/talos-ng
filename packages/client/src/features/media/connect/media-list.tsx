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
import { MediaListView } from "../view/media-list.tsx";
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
    canSearch = useCan(contract.media.search);
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
