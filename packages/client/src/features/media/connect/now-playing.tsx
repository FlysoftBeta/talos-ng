import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { watchDeviceCache } from "../model/actions.ts";
import {
  artistLine,
  cacheLabel,
  formatTime,
  volumePercent,
} from "../model/format.ts";
import { NowPlayingView } from "../view/now-playing.tsx";
import { useMediaPlayer } from "./player.tsx";
import { useMedia } from "./use-media.ts";

export function NowPlaying(): ReactElement | null {
  const player = useMediaPlayer(),
    runtime = useRuntime(),
    data = useMedia(),
    downloads = useClientSnapshot().status.downloads;
  const [cached, setCached] = useState(false);
  const track = player.current;
  useEffect(
    () => watchDeviceCache(runtime, track?.audio?.id, setCached),
    [runtime, track?.audio?.id, downloads],
  );
  if (!track) return null;
  const total = player.duration || track.durationMs / 1000;
  return (
    <NowPlayingView
      title={track.title}
      artists={artistLine(track)}
      cacheLabel={cacheLabel(track, cached)}
      playing={player.playing}
      position={player.position}
      positionLabel={formatTime(player.position)}
      total={total}
      totalLabel={formatTime(total)}
      volume={player.volume}
      maxVolume={player.maxVolume}
      volumePercent={volumePercent(player.maxVolume)}
      stopAtEnd={!!data.state?.stopAtEnd}
      error={player.error}
      onPrevious={() => void player.previous()}
      onToggle={() => {
        if (player.playing) player.pause();
        else void player.resume();
      }}
      onNext={() => void player.next()}
      onStop={player.stop}
      onSeek={player.seek}
      onVolume={player.setVolume}
      onStopAtEnd={player.setStopAtEnd}
      onQueue={player.toggleQueue}
    />
  );
}
