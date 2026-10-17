import type {
  LauncherActions,
  LauncherSurface,
  LauncherView,
} from "../model/launcher.ts";
import type { LauncherItem } from "../model/selection.ts";

/** Video Picture-in-Picture plus canvas capture (Chrome 70); the entry is hidden without both. */
export function launcherSupported(doc: Document = document): boolean {
  return (
    doc.pictureInPictureEnabled === true &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    typeof HTMLVideoElement.prototype.requestPictureInPicture === "function"
  );
}

export const LAUNCHER_WIDTH = 360;
export const LAUNCHER_HEIGHT = 200;

/**
 * The canvas is captured into a hidden playing video. `prepare` creates the stream
 * ahead of the click so `enter` can call requestPictureInPicture inside the gesture.
 */
export function createCanvasSurface(
  draw: (ctx: CanvasRenderingContext2D, view: LauncherView) => void,
  doc: Document = document,
): LauncherSurface & { prepare(): void; dispose(): void } {
  let canvas: HTMLCanvasElement | undefined,
    video: HTMLVideoElement | undefined,
    last: LauncherView = { items: [], selectedId: undefined };
  const leaving = new Set<() => void>(),
    clicks = new Set<() => void>();
  const paint = (): void => {
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) draw(ctx, last);
  };
  const keepPlaying = (): void => {
    // The window's play/pause button pauses the video: treat it as a click.
    if (doc.pictureInPictureElement !== video) return;
    for (const callback of clicks) callback();
    void video?.play().catch(() => undefined);
  };
  const left = (): void => {
    for (const callback of leaving) callback();
  };
  const prepare = (): void => {
    if (video) return;
    canvas = doc.createElement("canvas");
    canvas.width = LAUNCHER_WIDTH;
    canvas.height = LAUNCHER_HEIGHT;
    paint();
    video = doc.createElement("video");
    video.muted = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("aria-hidden", "true");
    video.style.cssText =
      "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none";
    video.addEventListener("pause", keepPlaying);
    video.addEventListener("leavepictureinpicture", left);
    video.srcObject = canvas.captureStream(5);
    doc.body.appendChild(video);
    void video.play().catch(() => undefined);
  };
  return {
    prepare,
    async enter() {
      prepare();
      await video!.requestPictureInPicture();
    },
    leave() {
      if (doc.pictureInPictureElement === video)
        void doc.exitPictureInPicture().catch(() => undefined);
    },
    render(view) {
      last = view;
      paint();
    },
    onLeave(callback) {
      leaving.add(callback);
      return () => void leaving.delete(callback);
    },
    onClick(callback) {
      clicks.add(callback);
      return () => void clicks.delete(callback);
    },
    dispose() {
      if (!video) return;
      video.removeEventListener("pause", keepPlaying);
      video.removeEventListener("leavepictureinpicture", left);
      video.pause();
      video.srcObject = null;
      video.remove();
      video = canvas = undefined;
    },
  };
}

const ACTIONS: readonly MediaSessionAction[] = [
  "play",
  "pause",
  "nexttrack",
  "previoustrack",
];
/**
 * Media Session handlers for the window's transport buttons, where the API exists.
 * `restore` re-installs whoever owned the handlers before (the music player).
 */
export function createMediaActions(
  restore: () => (() => void) | void,
): LauncherActions {
  const session: MediaSession | undefined =
    "mediaSession" in navigator ? navigator.mediaSession : undefined;
  const set = (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null,
  ): void => {
    try {
      session?.setActionHandler(action, handler);
    } catch {
      // Unknown action names must not stop the launcher.
    }
  };
  return {
    bind(handlers) {
      set("play", handlers.click);
      set("pause", handlers.click);
      set("nexttrack", handlers.next);
      set("previoustrack", handlers.previous);
      return () => {
        for (const action of ACTIONS) set(action, null);
        restore();
      };
    },
    describe(item: LauncherItem | undefined) {
      if (!session || typeof MediaMetadata === "undefined") return;
      session.metadata = item
        ? new MediaMetadata({ title: item.title, artist: item.hint })
        : null;
    },
  };
}
