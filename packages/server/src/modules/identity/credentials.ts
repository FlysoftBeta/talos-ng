import { createHash } from "node:crypto";
import {
  createHmac,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { Semaphore } from "@talos/base";
export interface PinRecord {
  hash: string;
  salt: string | null;
  verifier: string | null;
}
/** Both the database-salted lookup and individual credential verifier are memory-hard. */
export class PinCredentials {
  private readonly semaphore = new Semaphore(2);
  constructor(
    private readonly secret: string,
    private readonly random: (size: number) => Uint8Array = randomBytes,
  ) {}
  index(pin: string): string {
    return "s2:" + scryptSync(pin, this.secret, 32).toString("hex");
  }
  async indexAsync(pin: string): Promise<string> {
    return "s2:" + (await this.derive(pin, this.secret)).toString("hex");
  }
  legacyIndex(pin: string): string {
    return createHmac("sha256", Buffer.from(this.secret, "hex"))
      .update(pin)
      .digest("hex");
  }
  create(pin: string): PinRecord {
    const salt = Buffer.from(this.random(16)).toString("hex");
    return {
      hash: this.index(pin),
      salt,
      verifier: scryptSync(pin, salt, 32).toString("hex"),
    };
  }
  async createAsync(pin: string): Promise<PinRecord> {
    const salt = Buffer.from(this.random(16)).toString("hex");
    return {
      hash: await this.indexAsync(pin),
      salt,
      verifier: (await this.derive(pin, salt)).toString("hex"),
    };
  }
  verify(pin: string, record: PinRecord | undefined): boolean {
    const actual = scryptSync(pin, record?.salt ?? this.secret, 32);
    return (
      !!record &&
      (record.verifier === null ||
        timingSafeEqual(actual, Buffer.from(record.verifier, "hex")))
    );
  }
  async verifyAsync(
    pin: string,
    record: PinRecord | undefined,
  ): Promise<boolean> {
    const actual = await this.derive(pin, record?.salt ?? this.secret);
    return (
      !!record &&
      (record.verifier === null ||
        timingSafeEqual(actual, Buffer.from(record.verifier, "hex")))
    );
  }
  private derive(pin: string, salt: string): Promise<Buffer> {
    return this.semaphore.run(
      () =>
        new Promise<Buffer>((resolve, reject) =>
          scrypt(pin, salt, 32, (error, key) =>
            error ? reject(error) : resolve(key),
          ),
        ),
    );
  }
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
