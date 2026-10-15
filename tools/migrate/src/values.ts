import type { LegacyRow } from "./types.ts";

export const value = (r: LegacyRow, key: string): string =>
  String(r[key] ?? "");
export const number = (r: LegacyRow, key: string, fallback = 0): number => {
  const n = Number(r[key]);
  return Number.isFinite(n) && r[key] != null ? n : fallback;
};
export const time = (v: unknown): number => {
  if (typeof v === "number") return v;
  const text = String(v ?? "");
  // SQLite datetime('now') is UTC even when the host process has a local TZ.
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    text,
  )
    ? text.replace(" ", "T") + "Z"
    : text;
  const n = Date.parse(normalized);
  return Number.isFinite(n) ? n : 0;
};
export const json = (v: unknown, fallback: unknown): unknown => {
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
};
