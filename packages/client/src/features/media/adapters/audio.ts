import type { AudioPort, AudioTransfer } from "../model/playback.ts";

/** Wraps the mounted audio element and owns the temporary object URL of its source. */
export function elementAudio(
  element: () => HTMLAudioElement | null,
): AudioPort {
  let url: string | null = null;
  const release = (): void => {
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  };
  return {
    ready: () => !!element(),
    load(bytes, mime) {
      const el = element();
      if (!el) return;
      release();
      url = URL.createObjectURL(
        new Blob([bytes.buffer as ArrayBuffer], { type: mime }),
      );
      el.src = url;
    },
    play: async () => {
      await element()?.play();
    },
    pause: () => element()?.pause(),
    stop() {
      const el = element();
      el?.pause();
      el?.removeAttribute("src");
      release();
    },
    dispose() {
      element()?.pause();
      release();
    },
    seek(seconds) {
      const el = element();
      if (!el) return 0;
      el.currentTime = Math.max(
        0,
        Math.min(seconds, Number.isFinite(el.duration) ? el.duration : seconds),
      );
      return el.currentTime;
    },
    setVolume(value) {
      const el = element();
      if (el) el.volume = value;
    },
    get duration() {
      return element()?.duration ?? NaN;
    },
  };
}
export const browserTransfer: AudioTransfer = {
  async fetch(url) {
    const response = await fetch(url);
    return {
      ok: response.ok,
      status: response.status,
      read: async () => new Uint8Array(await response.arrayBuffer()),
    };
  },
  async sha256(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer)),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  },
};
