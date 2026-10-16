import type { LibraryDoc } from "@talos/contract";
import { documentHint } from "../model/library-data.ts";
import type { LibraryData } from "../model/library-data.ts";
import type { RowTag } from "../view/library-list.tsx";

type Download = { id: string; progress: number; error?: string };

/** Row hint (size · date · progress) and the inline retention/download tag of a document. */
export function documentRowExtras(
  data: LibraryData,
  downloads: readonly Download[],
  doc: LibraryDoc,
): { hint: string; tag?: RowTag } {
  const state = data.states.get(doc.id),
    read =
      doc.status === "ready" && state && state.lastRead > 0 && doc.units > 0
        ? ` · 已读 ${Math.round((Math.min(doc.units, state.furthest + 1) / doc.units) * 100)}%`
        : "";
  const download = downloads.find((d) => d.id === `library:${doc.id}`),
    policy = data.retentions.get(doc.id)?.value?.v;
  const tag: RowTag | undefined = download
    ? download.error
      ? { label: "待下载", tone: "pending" }
      : {
          label: `下载中 ${Math.round(download.progress * 100)}%`,
          tone: "accent",
        }
    : policy !== undefined && policy !== "auto"
      ? { label: "离线保留已设置", tone: "pending" }
      : undefined;
  return { hint: documentHint(doc) + read, tag };
}
