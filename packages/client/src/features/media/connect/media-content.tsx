import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import type { MediaTrack } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { PlaylistSharing } from "./playlist-sharing.tsx";
import {
  addToPlaylist,
  addableTracks,
  deletePlaylist,
  emptyState,
  emptyTitle,
  errorMessage,
  listBody,
  playlistSharing,
  retentionChoices,
  saveRetention,
  tabTracks,
  validRetention,
} from "../model/actions.ts";
import { canEditPlaylist } from "../model/data.ts";
import {
  MediaContentView,
  PlaylistActionsView,
  PlaylistDialogsView,
  TrackListView,
} from "../view/media-content.tsx";
import type { PlaylistPanelProps } from "../view/media-content.tsx";
import { sourceTitle } from "../view/media-list.tsx";
import { NowPlaying } from "./now-playing.tsx";
import { useMediaPlayer } from "./player.tsx";
import { useMediaSearch, useMediaSelection } from "./source.ts";
import { TrackRow } from "./track-row.tsx";
import { useMedia } from "./use-media.ts";

const emptyHints = {
  recent: "播放过的曲目会出现在这里",
  favorite: "点曲目旁的心形即可收藏",
  search: "换个关键词试试",
} as const;

export function MediaContent(): ReactElement {
  const runtime = useRuntime(),
    data = useMedia(),
    player = useMediaPlayer(),
    snapshot = useClientSnapshot(),
    search = useMediaSearch(),
    { source, playlist } = useMediaSelection(data);
  const canRetention = useCan(contract.media.retention.set),
    canItems = useCan(contract.media.playlist.items),
    canShare = useCan(contract.media.playlist.grants),
    canDelete = useCan(contract.media.playlist.delete);
  const [removing, setRemoving] = useState(false),
    [sharing, setSharing] = useState(false),
    [retentionOpen, setRetentionOpen] = useState(false),
    [adding, setAdding] = useState(false),
    [choice, setChoice] = useState(""),
    [addSource, setAddSource] = useState("search"),
    [days, setDays] = useState<number | "auto">("auto"),
    [error, setError] = useState("");
  useEffect(() => {
    if (playlist) setDays(data.retentions.get(playlist.id)?.value?.v ?? "auto");
  }, [
    playlist?.id,
    data.retentions.get(playlist?.id ?? "")?.value?.v,
    retentionOpen,
  ]);
  useEffect(() => setError(""), [playlist?.id, source]);
  const adapter = useMemo(
    () => (playlist ? playlistSharing(runtime, playlist.id) : null),
    [runtime, playlist?.id],
  );
  const run = (promise: Promise<unknown>) => {
    void promise.catch((e) => setError(errorMessage(e)));
  };
  const canEdit =
    !!playlist && canEditPlaylist(data, playlist, snapshot.user?.id);
  const writeReason = canEdit ? undefined : "没有歌单写入权限";
  const connection = emptyState(snapshot.status.connection);
  const footer = player.current ? <NowPlaying /> : undefined;
  // A failed start leaves no player bar; its error is shown in the pane instead.
  const shownError = error || (player.current ? "" : player.error);

  if (playlist) {
    const panel: PlaylistPanelProps = {
      title: playlist.title,
      personalRetention: data.retentions.get(playlist.id)?.value?.v ?? "auto",
      retentionOpen,
      onToggleRetention: () => setRetentionOpen(!retentionOpen),
      days,
      daysChoices: retentionChoices(
        data.retentions.get(playlist.id)?.value?.v ?? "auto",
      ),
      daysValid: validRetention(days),
      editable: true,
      retentionReason: canRetention.ok ? undefined : canRetention.reason,
      onDays: setDays,
      onSaveDays: () => {
        run(
          saveRetention(runtime, playlist.id, days).then(() =>
            setRetentionOpen(false),
          ),
        );
      },
      shareReason: canShare.ok ? undefined : canShare.reason,
      onShare: () => setSharing(true),
      addReason: writeReason ?? (canItems.ok ? undefined : canItems.reason),
      onAdd: () => setAdding(true),
      deleteReason:
        playlist.owner === snapshot.user?.id
          ? { reason: canDelete.ok ? undefined : canDelete.reason }
          : undefined,
      onDelete: () => setRemoving(true),
      adding: adding
        ? {
            title: `添加到「${playlist.title}」`,
            choice,
            onChoice: setChoice,
            source: addSource,
            sources: [
              { id: "search", title: "当前搜索结果" },
              ...data.playlists
                .filter((p) => p.id !== playlist.id)
                .map((p) => ({ id: p.id, title: p.title })),
            ],
            onSource: (id) => {
              setAddSource(id);
              setChoice("");
            },
            tracks: addableTracks(data, playlist, addSource, search.results),
            onSubmit: () =>
              run(
                addToPlaylist(runtime, playlist, choice).then(() => {
                  setAdding(false);
                  setChoice("");
                }),
              ),
            onClose: () => setAdding(false),
          }
        : undefined,
      removing: removing
        ? {
            name: playlist.title,
            onConfirm: () => {
              run(deletePlaylist(runtime, playlist.id));
              setRemoving(false);
            },
            onClose: () => setRemoving(false),
          }
        : undefined,
      share:
        sharing && adapter ? (
          <PlaylistSharing
            title={`分享「${playlist.title}」`}
            adapter={adapter}
            onClose={() => setSharing(false)}
          />
        ) : null,
    };
    const tracks = playlist.tracks
      .map((id) => data.tracks.find((v) => v.id === id))
      .filter((t): t is MediaTrack => !!t);
    return (
      <MediaContentView
        title={playlist.title}
        count={playlist.tracks.length}
        actions={<PlaylistActionsView {...panel} />}
        error={shownError}
        footer={footer}
      >
        <TrackListView
          state={tracks.length ? "tracks" : connection}
          emptyTitle="歌单为空"
          emptyHint="点右上角的 + 添加曲目"
        >
          {tracks.map((t, i) => (
            <TrackRow
              key={t.id}
              index={i + 1}
              track={t}
              playlist={playlist}
              editable={canEdit}
            />
          ))}
        </TrackListView>
        <PlaylistDialogsView {...panel} />
      </MediaContentView>
    );
  }

  const isSearch = source === "search";
  const tracks = tabTracks(source, data, search.results);
  const body = listBody({
    tab: source,
    busy: isSearch && search.busy,
    error: isSearch ? search.error : "",
    tracks: tracks.length,
  });
  return (
    <MediaContentView
      title={sourceTitle(source)}
      count={body === "tracks" || body === "empty" ? tracks.length : undefined}
      error={shownError}
      footer={footer}
    >
      <TrackListView
        state={
          isSearch && connection === "offline"
            ? "offline"
            : body === "empty" || body === "playlists"
              ? connection
              : body
        }
        emptyTitle={
          isSearch && connection === "offline"
            ? "连接后搜索音乐"
            : emptyTitle(source)
        }
        emptyHint={emptyHints[source]}
        error={search.error}
        onRetry={() => void search.search()}
      >
        {tracks.map((t, i) => (
          <TrackRow key={t.id} index={i + 1} track={t} />
        ))}
      </TrackListView>
    </MediaContentView>
  );
}
