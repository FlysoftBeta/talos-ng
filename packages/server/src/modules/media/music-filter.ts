/** The fields of a provider entry that tell music from other uploads. */
export interface MusicCandidate {
  title: string;
  /** Seconds; null or absent when yt-dlp's flat listing does not know it. */
  duration: unknown;
  liveStatus: unknown;
  categories: unknown;
}
export const MIN_TRACK_SECONDS = 45;
export const MAX_TRACK_SECONDS = 20 * 60;
const NON_MUSIC_TITLE =
  /podcast|audiobook|ringtone|trailer|\bads?\b|advert|commercial|广告|铃声|播客|有声(书|小说|读物)|电台节目|\bep\.?\s?\d+\b.*(talk|show)/i;
const NON_MUSIC_CATEGORY = /podcast|news|gaming|howto|education|comedy|film/i;

/** True when the entry looks like a single song: bounded length, not live, not spoken or promotional. */
export function isMusicEntry(entry: MusicCandidate): boolean {
  const seconds = entry.duration;
  // Flat search listings do not always carry a duration (it depends on the
  // YouTube client yt-dlp ends up using); an unknown length must not hide the
  // result. Only a known length outside the track range is rejected.
  if (
    typeof seconds === "number" &&
    seconds > 0 &&
    (seconds < MIN_TRACK_SECONDS || seconds > MAX_TRACK_SECONDS)
  )
    return false;
  if (entry.liveStatus === "is_live" || entry.liveStatus === "is_upcoming")
    return false;
  if (NON_MUSIC_TITLE.test(entry.title)) return false;
  if (
    Array.isArray(entry.categories) &&
    entry.categories.length > 0 &&
    !entry.categories.some((c) => c === "Music") &&
    entry.categories.some(
      (c) => typeof c === "string" && NON_MUSIC_CATEGORY.test(c),
    )
  )
    return false;
  return true;
}

/** The next offset of a raw page: null once the provider returned fewer entries than asked. */
export function nextOffset(
  offset: number,
  limit: number,
  rawCount: number,
): number | null {
  return rawCount >= limit ? offset + limit : null;
}
