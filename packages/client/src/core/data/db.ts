import type { Coverage, Row } from "@talos/sync";
export interface StoredRow extends Row {
  scope: string;
}
/** A scope's coverage is persisted in the same transaction as its rows. */
export interface StoredScope {
  scope: string;
  coverage: Coverage;
}
