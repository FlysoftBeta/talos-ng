import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { AppError } from "@talos/base";
import { migrate } from "./db.ts";
import type { Db } from "./db.ts";
/** Replay credentials are encrypted rather than copied into plaintext JSON rows.
 * The key shares the database: this prevents accidental token exposure, not a
 * full-database compromise. Sessions themselves retain only token hashes. */
export class OpResults {
  private readonly key: Buffer;
  constructor(db: Db) {
    migrate(db, "op-results", [
      {
        n: 1,
        up: (db) =>
          db.exec(
            "CREATE TABLE op_result_key(id INTEGER PRIMARY KEY CHECK(id=1),key BLOB NOT NULL) STRICT",
          ),
      },
    ]);
    this.key = db.tx(() => {
      const row = db.get<{ key: Uint8Array }>(
        "SELECT key FROM op_result_key WHERE id=1",
      );
      if (row) return Buffer.from(row.key);
      const key = randomBytes(32);
      db.run("INSERT INTO op_result_key VALUES(1,?)", key);
      return key;
    });
  }
  fingerprint(metadata: string, body: Uint8Array): string {
    return createHmac("sha256", this.key)
      .update(metadata)
      .update(body)
      .digest("hex");
  }
  encode(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value ?? null), "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    });
  }
  decode(encoded: string): unknown {
    try {
      const record = JSON.parse(encoded) as {
        iv: string;
        tag: string;
        data: string;
      };
      const cipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(record.iv, "base64"),
      );
      cipher.setAuthTag(Buffer.from(record.tag, "base64"));
      return JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(record.data, "base64")),
          cipher.final(),
        ]).toString("utf8"),
      ) as unknown;
    } catch {
      throw new AppError("E_INTEGRITY", "已保存的操作结果已损坏");
    }
  }
}
