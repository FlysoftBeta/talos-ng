export interface Options {
  source: string;
  blobs: string;
  target: string;
  resume: boolean;
}
export interface LegacyRow {
  [key: string]: string | number | Uint8Array | null;
}
