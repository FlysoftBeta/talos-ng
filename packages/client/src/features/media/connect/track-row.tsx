import { useState } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import type { MediaPlaylist, MediaTrack } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import {
  addToPlaylist,
  errorMessage,
  isFavorite,
  recordPlay,
  saveRetention,
  removeFromPlaylist,
  setFavorite,
  writablePlaylists,
} from "../model/actions.ts";
import { artistLine, formatTime } from "../model/format.ts";
import { TrackRetentionView } from "../view/track-retention.tsx";
import { TrackRowView } from "../view/track-row.tsx";
import { useDeviceCache } from "./device-cache.ts";
import { useMediaPlayer } from "./player.tsx";
import { useMedia } from "./use-media.ts";

export function TrackRow({
  track,
  index,
  playlist,
  editable = true,
  list,
}: {
  track: MediaTrack;
  /** 1-based position in the shown list. */
  index: number;
  playlist?: MediaPlaylist;
  editable?: boolean;
  /** The list this row belongs to; playing the row makes it the playback context. */
  list?: { title: string; tracks: readonly MediaTrack[] };
}): ReactElement {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    data = useMedia(),
    player = useMediaPlayer(),
    canItems = useCan(contract.media.playlist.items),
    canRetention = useCan(contract.media.retention.set);
  const [error, setError] = useState(""),
    [retentionOpen, setRetentionOpen] = useState(false),
    [days, setDays] = useState("auto"),
    [addingTo, setAddingTo] = useState(false),
    [target, setTarget] = useState("");
  const deviceCached = useDeviceCache(track.audio?.id);
  const execute = (promise: Promise<unknown>) =>
    void promise.catch((e) => setError(errorMessage(e)));
  const writable = writablePlaylists(data, track.id, snapshot.user?.id);
  const itemsReason = canItems.ok ? undefined : canItems.reason;
  return (
    <TrackRowView
      onRetention={() => {
        setDays(String(data.retentions.get(track.id)?.value?.v ?? "auto"));
        setRetentionOpen(true);
      }}
      retentionDialog={
        <TrackRetentionView
          title={track.title}
          open={retentionOpen}
          value={days}
          error={error}
          reason={canRetention.ok ? undefined : canRetention.reason}
          onOpen={() => setRetentionOpen(true)}
          onClose={() => setRetentionOpen(false)}
          onValue={setDays}
          onSave={() =>
            execute(
              saveRetention(
                runtime,
                track.id,
                days === "auto" ? "auto" : Number(days),
                "track",
              ).then(() => setRetentionOpen(false)),
            )
          }
        />
      }
      index={index}
      title={track.title}
      artist={artistLine(track)}
      album={track.album}
      duration={formatTime(track.durationMs / 1000)}
      current={player.current?.id === track.id}
      playing={player.current?.id === track.id && player.playing}
      deviceCached={deviceCached}
      serverCached={!!track.audio}
      favorite={isFavorite(data, track.id)}
      inPlaylist={!!playlist}
      addReason={itemsReason}
      removeReason={!editable ? "没有歌单写入权限" : itemsReason}
      error={error}
      onPlay={() => {
        void player.play(track, list);
        if (playlist) execute(recordPlay(runtime, playlist.id));
      }}
      onFavorite={() =>
        execute(setFavorite(runtime, track.id, !isFavorite(data, track.id)))
      }
      onEnqueue={() => player.enqueue(track.id)}
      onPlayNext={() => player.playNext(track.id)}
      onAdd={() => setAddingTo(true)}
      onRemove={() =>
        playlist && execute(removeFromPlaylist(runtime, playlist, track.id))
      }
      adding={
        addingTo
          ? {
              playlists: writable,
              target,
              onTarget: setTarget,
              onSubmit: () => {
                const p = writable.find((v) => v.id === target);
                if (p)
                  execute(
                    addToPlaylist(runtime, p, track.id).then(() => {
                      setAddingTo(false);
                      setTarget("");
                    }),
                  );
              },
              onClose: () => setAddingTo(false),
            }
          : undefined
      }
    />
  );
}
