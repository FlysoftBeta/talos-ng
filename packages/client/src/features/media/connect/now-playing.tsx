import type { ReactElement } from "react";
import {
  artistLine,
  cacheLabel,
  formatTime,
  volumePercent,
} from "../model/format.ts";
import { useDeviceCache } from "./device-cache.ts";
import { NowPlayingView } from "../view/now-playing.tsx";
import { useMediaPlayer } from "./player.tsx";
import { useMedia } from "./use-media.ts";

export function NowPlaying(): ReactElement | null {
  const player = useMediaPlayer(),
    data = useMedia();
  const track = player.current;
  const cached = useDeviceCache(track?.audio?.id);
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
      shuffle={player.shuffle}
      repeat={player.repeat}
      onShuffle={player.setShuffle}
      onRepeat={player.setRepeat}
    />
  );
}
