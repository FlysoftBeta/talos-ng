import { MAX_RESOURCES, MAX_RESOURCE_BYTES, isRid } from "@talos/docpack";
import { archiveError } from "./zip.ts";
import type { ZipEntry } from "./zip.ts";
export interface ArchiveResource {
  contentId: string;
  mime: string;
  encoding: "identity" | "zstd" | "zstd-dictionary";
  rawSize: number;
  storedSize: number;
  storedOffset: number;
  path: string;
}
export interface ArchivePage {
  id: string;
  ordinal: number;
  width: number;
  height: number;
  document: string;
  dependencies: string[];
}
export interface ArchiveManifest {
  format: "classapp-render-archive";
  version: 1;
  dictionary: null | {
    contentId: string;
    path: "dictionary.zdict";
    size: number;
    storedOffset: number;
  };
  resources: ArchiveResource[];
  files: { path: string; contentId: string }[];
  document: {
    layout: "fixed";
    sourceMime: string;
    sourcePages: number;
    firstPage: number;
    lastPage: number;
    resolution: number;
    webpQuality: number;
    shared: string[];
    items: ArchivePage[];
  };
}
function obj(v: unknown, keys: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) archiveError("object");
  const o = v as Record<string, unknown>;
  if (
    Object.keys(o).some((k) => !keys.split(" ").includes(k)) ||
    keys.split(" ").some((k) => !(k in o))
  )
    archiveError("fields");
  return o;
}
function str(v: unknown, max = 255): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}
function num(v: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): v is number {
  return (
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
  );
}
function arr(v: unknown, max = MAX_RESOURCES): unknown[] {
  if (!Array.isArray(v) || v.length > max) archiveError("array");
  return v;
}
export function validateArchiveManifest(
  value: unknown,
  entries: Map<string, ZipEntry>,
): ArchiveManifest {
  const m = obj(value, "format version dictionary resources files document");
  if (m.format !== "classapp-render-archive" || m.version !== 1)
    archiveError("version");
  const resources = new Map<string, Record<string, unknown>>();
  const paths = new Set<string>();
  const match = (p: unknown, offset: unknown, size: unknown): void => {
    const e = typeof p === "string" ? entries.get(p) : undefined;
    if (!e || e.offset !== offset || e.size !== size || paths.has(e.name))
      archiveError("declared data offset or size");
    paths.add(e.name);
  };
  for (const v of arr(m.resources)) {
    const r = obj(
      v,
      "contentId mime encoding rawSize storedSize storedOffset path",
    );
    if (
      !isRid(r.contentId) ||
      resources.has(r.contentId) ||
      !str(r.mime) ||
      !["identity", "zstd", "zstd-dictionary"].includes(String(r.encoding)) ||
      !num(r.rawSize, MAX_RESOURCE_BYTES) ||
      !num(r.storedSize, MAX_RESOURCE_BYTES) ||
      !num(r.storedOffset)
    )
      archiveError("resource");
    if (
      r.path !==
        `objects/${r.contentId}${r.encoding === "identity" ? "" : ".zst"}` ||
      (r.encoding === "identity" && r.rawSize !== r.storedSize)
    )
      archiveError("resource path or size");
    match(r.path, r.storedOffset, r.storedSize);
    resources.set(r.contentId, r);
  }
  if (m.dictionary !== null) {
    const d = obj(m.dictionary, "contentId path size storedOffset");
    if (
      !isRid(d.contentId) ||
      resources.has(d.contentId) ||
      d.path !== "dictionary.zdict" ||
      !num(d.size, 1024 * 1024, 1) ||
      !num(d.storedOffset)
    )
      archiveError("dictionary");
    match(d.path, d.storedOffset, d.size);
  }
  if (entries.size !== paths.size + 1) archiveError("unexpected entry");
  for (const r of resources.values())
    if (
      (m.dictionary === null && r.encoding === "zstd-dictionary") ||
      (m.dictionary !== null && r.encoding === "zstd")
    )
      archiveError("dictionary encoding");
  const ref = (v: unknown): void => {
    if (!isRid(v) || !resources.has(v))
      archiveError("missing resource reference");
  };
  const refs = (v: unknown): void => {
    arr(v, 4096).forEach(ref);
  };
  const d = obj(
    m.document,
    "layout sourceMime sourcePages firstPage lastPage resolution webpQuality shared items",
  );
  if (
    d.layout !== "fixed" ||
    !str(d.sourceMime) ||
    !num(d.sourcePages, Number.MAX_SAFE_INTEGER, 1) ||
    !num(d.firstPage, d.sourcePages, 1) ||
    !num(d.lastPage, d.sourcePages, d.firstPage) ||
    typeof d.resolution !== "number" ||
    !Number.isFinite(d.resolution) ||
    d.resolution <= 0 ||
    !num(d.webpQuality, 100)
  )
    archiveError("document");
  refs(d.shared);
  const ids = new Set<string>();
  const items = arr(d.items);
  if (items.length !== d.lastPage - d.firstPage + 1) archiveError("page count");
  items.forEach((v, index) => {
    const p = obj(v, "id ordinal width height document dependencies");
    if (
      !str(p.id) ||
      ids.has(p.id) ||
      p.ordinal !== index ||
      typeof p.width !== "number" ||
      !Number.isFinite(p.width) ||
      p.width <= 0 ||
      typeof p.height !== "number" ||
      !Number.isFinite(p.height) ||
      p.height <= 0
    )
      archiveError("page");
    ids.add(p.id);
    ref(p.document);
    refs(p.dependencies);
    if (
      !/^text\/html(?:;|$)/i.test(
        String(resources.get(p.document as string)!.mime),
      )
    )
      archiveError("page entry must be HTML");
  });
  const filePaths = new Set<string>();
  for (const v of arr(m.files)) {
    const f = obj(v, "path contentId");
    if (
      !str(f.path, 4096) ||
      /^[\/\\]|^[a-z]:/i.test(f.path) ||
      f.path.includes("\\") ||
      f.path.includes("\0") ||
      f.path.split("/").some((p) => p === ".." || p === "." || !p) ||
      filePaths.has(f.path)
    )
      archiveError("file path");
    filePaths.add(f.path);
    ref(f.contentId);
  }
  return value as ArchiveManifest;
}
