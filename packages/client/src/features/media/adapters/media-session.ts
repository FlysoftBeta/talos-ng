import type {
  MediaSessionPort,
  PlaybackController,
} from "../model/playback.ts";
/** Older Media Session implementations reject newer action names such as seekto. */
export function setMediaAction(
  session: Pick<MediaSession, "setActionHandler">,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    session.setActionHandler(action, handler);
  } catch {
    // Optional OS controls must never prevent the in-app player from working.
  }
}
/** Feature-detected OS media controls; absent support makes every call a no-op. */
export const browserMediaSession: MediaSessionPort = {
  playing(track) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists.join("、"),
      album: track.album ?? "",
    });
    navigator.mediaSession.playbackState = "playing";
  },
  paused() {
    if ("mediaSession" in navigator)
      navigator.mediaSession.playbackState = "paused";
  },
};
/** Routes OS transport controls to the player; returns the unbind function. */
export function bindMediaControls(
  controls: Pick<
    PlaybackController,
    "resume" | "pause" | "next" | "previous" | "seek"
  >,
): () => void {
  if (!("mediaSession" in navigator)) return () => {};
  const session = navigator.mediaSession;
  setMediaAction(session, "play", () => void controls.resume());
  setMediaAction(session, "pause", controls.pause);
  setMediaAction(session, "nexttrack", () => void controls.next());
  setMediaAction(session, "previoustrack", () => void controls.previous());
  setMediaAction(session, "seekto", (details) => {
    if (details.seekTime !== undefined) controls.seek(details.seekTime);
  });
  return () => {
    for (const action of [
      "play",
      "pause",
      "nexttrack",
      "previoustrack",
      "seekto",
    ] as MediaSessionAction[])
      setMediaAction(session, action, null);
  };
}
