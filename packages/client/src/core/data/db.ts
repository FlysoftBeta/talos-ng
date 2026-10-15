import type { Row, IntervalSetJSON } from "@talos/sync";
export interface StoredRow extends Row {
  scope: string;
}
export interface StoredScope {
  scope: string;
  cursor: number;
  windows?: Readonly<Record<string, IntervalSetJSON>>;
}
