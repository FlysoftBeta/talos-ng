import type { Row, IntervalSetJSON } from "@talos/sync";
export interface StoredRow extends Row {
  scope: string;
}
export interface StoredScope {
  scope: string;
  cursor: number;
  /** A full pull can certify even an empty scope at cursor zero. */
  complete?: boolean;
  windows?: Readonly<Record<string, IntervalSetJSON>>;
}
