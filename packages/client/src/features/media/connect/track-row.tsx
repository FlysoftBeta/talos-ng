import { useEffect, useState } from "react";
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
  removeFromPlaylist,
  setFavorite,
  watchDeviceCache,
  writablePlaylists,
} from "../model/actions.ts";
import { artistLine, formatTime } from "../model/format.ts";
import { TrackRowView } from "../view/track-row.tsx";
import { useMediaPlayer } from "./player.tsx";
import { useMedia } from "./use-media.ts";

export function TrackRow({
  track,
  index,
  playlist,
  editable = true,
}: {
  track: MediaTrack;
  /** 1-based position in the shown list. */
  index: number;
  playlist?: MediaPlaylist;
  editable?: boolean;
}): ReactElement {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    data = useMedia(),
    player = useMediaPlayer(),
    canItems = useCan(contract.media.playlist.items);
  const [error, setError] = useState(""),
    [addingTo, setAddingTo] = useState(false),
    [target, setTarget] = useState(""),
    [deviceCached, setDeviceCached] = useState(false);
  const downloads = snapshot.status.downloads;
  useEffect(
    () => watchDeviceCache(runtime, track.audio?.id, setDeviceCached),
    [runtime, track.audio?.id, downloads],
  );
  const execute = (promise: Promise<unknown>) =>
    void promise.catch((e) => setError(errorMessage(e)));
  const writable = writablePlaylists(data, track.id, snapshot.user?.id);
  const itemsReason = canItems.ok ? undefined : canItems.reason;
  return (
    <TrackRowView
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
        void player.play(track);
        if (playlist) execute(recordPlay(runtime, playlist.id));
      }}
      onFavorite={() =>
        execute(setFavorite(runtime, track.id, !isFavorite(data, track.id)))
      }
      onEnqueue={() => player.enqueue(track.id)}
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
