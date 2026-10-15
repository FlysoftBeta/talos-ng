import type { StatusViewModel } from "./model.ts";
/** Keeps task progress labels stable while replacing one download's current status. */
export function projectDownload(
  current: StatusViewModel["downloads"],
  id: string,
  value:
    | { title: string; progress: number; state?: string; error?: string }
    | undefined,
): StatusViewModel["downloads"] {
  const downloads = current.filter((item) => item.id !== id);
  if (value)
    downloads.push({
      id,
      title: value.error ? `${value.title}：${value.error}` : value.title,
      progress: value.progress,
    });
  return downloads;
}
