import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { AppError } from "@talos/base";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { browserTransfer, elementAudio } from "../adapters/audio.ts";
import {
  bindMediaControls,
  browserMediaSession,
} from "../adapters/media-session.ts";
import { emptyState } from "../model/actions.ts";
import { progressFraction } from "../model/format.ts";
import { PlaybackController } from "../model/playback.ts";
import type { PlayerApi } from "../model/playback.ts";
import { queueRows } from "../model/queue.ts";
import { MiniPlayerView } from "../view/mini-player.tsx";
import { PlayerAudio } from "../view/player-audio.tsx";
import { QueueSheetView } from "../view/queue-sheet.tsx";
import { useMedia } from "./use-media.ts";

/** The player API plus the 播完即停 preference the player bar toggles. */
export type MediaPlayer = PlayerApi & { setStopAtEnd(value: boolean): void };
const Context = createContext<MediaPlayer | null>(null);
export function useMediaPlayer(): MediaPlayer {
  const value = useContext(Context);
  if (!value) throw new AppError("E_INTERNAL", "音乐播放器未初始化");
  return value;
}
export function MediaPlayerProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    data = useMedia();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [controller] = useState(
    () =>
      new PlaybackController(
        runtime,
        elementAudio(() => audio.current),
        browserTransfer,
        browserMediaSession,
      ),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const active = snapshot.gate === "app" && !snapshot.concealed;
  controller.setInput({
    user: snapshot.user?.id,
    offline: snapshot.status.connection === "offline",
    active,
    tracks: data.tracks,
    state: data.state,
    queueReady: snapshot.cacheReady === true,
  });
  useEffect(
    () => controller.inputChanged(),
    [controller, active, data.tracks.map((t) => t.id).join(",")],
  );
  useEffect(() => bindMediaControls(controller), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  const api: MediaPlayer = {
    ...state,
    play: controller.play,
    pause: controller.pause,
    resume: controller.resume,
    next: controller.next,
    previous: controller.previous,
    stop: controller.stop,
    seek: controller.seek,
    setVolume: controller.setVolume,
    toggleQueue: controller.toggleQueue,
    enqueue: controller.enqueue,
    enqueueAll: controller.enqueueAll,
    playAll: controller.playAll,
    setStopAtEnd: (value) => controller.setStopAtEnd(value),
  };
  return (
    <Context.Provider value={api}>
      {children}
      <PlayerAudio
        ref={audio}
        onEnded={() => controller.ended()}
        onTime={(seconds) => controller.timeUpdate(seconds)}
        onDuration={(seconds) => controller.durationChange(seconds)}
        onFailed={() => controller.outputFailed()}
      />
      {state.queueOpen && (
        <QueueSheetView
          rows={queueRows(
            data.state?.queue ?? [],
            data.tracks,
            state.current?.id,
          )}
          emptyState={emptyState(snapshot.status.connection)}
          onPlay={(id) => {
            const track = data.tracks.find((t) => t.id === id);
            if (track) void controller.play(track);
          }}
          onMove={(index, delta) => controller.moveQueued(index, delta)}
          onRemove={(index) => controller.removeQueued(index)}
          onClear={() => controller.clearQueue()}
          onClose={controller.closeQueue}
        />
      )}
    </Context.Provider>
  );
}
export function MediaMiniPlayer(): ReactElement | null {
  const snapshot = useClientSnapshot();
  const player = useMediaPlayer();
  if (!player.current) return null;
  return (
    <MiniPlayerView
      hidden={snapshot.nav.area === "media"}
      title={player.current.title}
      playing={player.playing}
      progress={progressFraction(player.position, player.duration)}
      onToggle={() => {
        if (player.playing) player.pause();
        else void player.resume();
      }}
    />
  );
}
