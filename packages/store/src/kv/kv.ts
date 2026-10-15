import { AppError } from "@talos/base";
import type { Database } from "../database/database.ts";
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type KVValue = JsonValue | ArrayBuffer;
export class KV {
  constructor(
    private readonly db: Database,
    private readonly name = "kv",
  ) {}
  get<T extends KVValue = KVValue>(key: string): Promise<T | undefined> {
    return this.db.table<T, string>(this.name).get(key);
  }
  set(key: string, value: KVValue): Promise<string> {
    try {
      if (!(value instanceof ArrayBuffer)) {
        const visit = (v: unknown, seen: Set<object>): void => {
          if (
            v === null ||
            typeof v === "string" ||
            typeof v === "boolean" ||
            (typeof v === "number" && Number.isFinite(v))
          )
            return;
          if (
            !v ||
            typeof v !== "object" ||
            seen.has(v) ||
            (!Array.isArray(v) &&
              Object.getPrototypeOf(v) !== Object.prototype &&
              Object.getPrototypeOf(v) !== null)
          )
            throw new AppError(
              "E_INVALID",
              "KV accepts JSON values or ArrayBuffer",
            );
          seen.add(v);
          for (const value of Object.values(v)) visit(value, seen);
          seen.delete(v);
        };
        visit(value, new Set());
      }
      return this.db.table<KVValue, string>(this.name).put(value, key);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  delete(key: string): Promise<void> {
    return this.db.table<KVValue, string>(this.name).delete(key);
  }
}
