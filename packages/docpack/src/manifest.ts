import { AppError } from "@talos/base";
export const MAX_RESOURCES = 200_000;
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
export const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;
export type Encoding = "raw" | "deflate";
export type PackKind = "paged" | "flow";
export interface Resource {
  mime: string;
  enc: Encoding;
  size: number;
  stored: number;
  offset: number;
}
export interface Unit {
  ordinal: number;
  id: string;
  entry: string;
  deps: string[];
  w?: number;
  h?: number;
  chars?: number;
  label?: string;
}
export interface OutlineEntry {
  title: string;
  ordinal: number;
  level: number;
}
export interface Manifest {
  v: 1;
  kind: PackKind;
  title?: string;
  meta: Record<string, unknown>;
  units: Unit[];
  shared: string[];
  resources: Record<string, Resource>;
  outline?: OutlineEntry[];
}
export type ClientManifest = Omit<Manifest, "resources"> & {
  resources: Record<string, Omit<Resource, "offset">>;
};
export const isRid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export function invalid(detail: string): never {
  throw new AppError("E_INVALID", "文档包格式无效", { detail });
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("object");
  return value as Record<string, unknown>;
}
export function integer(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
  );
}
export function validateManifest(
  value: unknown,
  payloadSize: number,
): Manifest {
  const m = record(value);
  if (m.v !== 1) throw new AppError("E_VERSION", "不支持的文档包版本");
  if ((m.kind !== "paged" && m.kind !== "flow") || !integer(payloadSize))
    invalid("kind or payload size");
  record(m.meta);
  if (m.title !== undefined && typeof m.title !== "string") invalid("title");
  const resources = record(m.resources);
  const ids = Object.keys(resources);
  if (ids.length > MAX_RESOURCES)
    throw new AppError("E_TOO_LARGE", "文档资源过多");
  const ranges: { start: number; end: number }[] = [];
  for (const rid of ids) {
    const r = record(resources[rid]);
    if (
      !isRid(rid) ||
      typeof r.mime !== "string" ||
      !r.mime.length ||
      r.mime.length > 255 ||
      (r.enc !== "raw" && r.enc !== "deflate") ||
      !integer(r.size, MAX_RESOURCE_BYTES) ||
      !integer(r.stored, MAX_RESOURCE_BYTES) ||
      !integer(r.offset) ||
      r.offset > payloadSize - r.stored ||
      (r.enc === "raw" && r.size !== r.stored)
    )
      invalid("resource");
    if (r.stored) ranges.push({ start: r.offset, end: r.offset + r.stored });
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i]!.start < ranges[i - 1]!.end) invalid("overlap");
  const ref = (v: unknown): void => {
    if (!isRid(v) || !Object.prototype.hasOwnProperty.call(resources, v))
      invalid("reference");
  };
  const refs = (v: unknown): void => {
    if (!Array.isArray(v)) invalid("references");
    v.forEach(ref);
  };
  refs(m.shared);
  if (!Array.isArray(m.units)) invalid("units");
  const unitIds = new Set<string>();
  m.units.forEach((value: unknown, index: number) => {
    const u = record(value);
    if (
      u.ordinal !== index ||
      typeof u.id !== "string" ||
      !u.id.length ||
      unitIds.has(u.id)
    )
      invalid("unit id or ordinal");
    unitIds.add(u.id);
    ref(u.entry);
    refs(u.deps);
    for (const key of ["w", "h"])
      if (
        (m.kind === "paged" || u[key] !== undefined) &&
        (!integer(u[key]) || u[key] === 0)
      )
        invalid("dimensions");
    if (u.chars !== undefined && !integer(u.chars)) invalid("chars");
    if (u.label !== undefined && typeof u.label !== "string") invalid("label");
  });
  if (m.outline !== undefined) {
    if (!Array.isArray(m.outline)) invalid("outline");
    for (const value of m.outline) {
      const o = record(value);
      if (
        typeof o.title !== "string" ||
        !o.title.length ||
        !integer(o.ordinal, m.units.length - 1) ||
        !integer(o.level) ||
        !o.level
      )
        invalid("outline entry");
    }
  }
  return value as Manifest;
}
