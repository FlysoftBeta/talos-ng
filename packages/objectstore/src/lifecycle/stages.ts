import { AppError } from "@talos/base";
import {
  validateChunk,
  validateExpect,
  validateSize,
} from "../content/validation.ts";
import { guard } from "../errors.ts";
import type { ObjectInfo, Stage } from "../ports.ts";
import { KeyLocks } from "./key-locks.ts";

export interface StageDriver {
  ensure(id: string): Promise<number>;
  size(id: string): Promise<number>;
  append(id: string, chunk: Uint8Array, offset: number): Promise<number>;
  commit(id: string, expect?: Partial<ObjectInfo>): Promise<ObjectInfo>;
  remove(id: string): Promise<void>;
}
export class Stages {
  readonly locks = new KeyLocks();
  private readonly active = new Map<
    string,
    { stage: Stage; end: () => void }
  >();
  constructor(private readonly driver: StageDriver) {}
  async open(id: string): Promise<Stage> {
    return this.locks.run(id, async () => {
      const current = this.active.get(id);
      if (current) return current.stage;
      let size = await this.driver.ensure(id),
        ended = false;
      const end = (): void => {
        ended = true;
        this.active.delete(id);
      };
      const live = (): void => {
        if (ended)
          throw new AppError("E_CONFLICT", "Stage is no longer active");
      };
      const stage: Stage = {
        get size() {
          return size;
        },
        append: (chunk, atOffset) =>
          guard(() =>
            this.locks.run(id, async () => {
              live();
              validateChunk(chunk);
              validateSize(atOffset);
              size = await this.driver.size(id);
              if (atOffset !== size)
                throw new AppError("E_CONFLICT", "Stage offset mismatch", {
                  size,
                });
              validateSize(size + chunk.byteLength);
              try {
                size = await this.driver.append(id, chunk, size);
              } catch (error) {
                size = await this.driver.size(id);
                throw error;
              }
              return size;
            }),
          ),
        commit: (expect) =>
          guard(() =>
            this.locks.run(id, async () => {
              live();
              validateExpect(expect);
              const info = await this.driver.commit(id, expect);
              end();
              return info;
            }),
          ),
        abort: () =>
          guard(() =>
            this.locks.run(id, async () => {
              if (ended) return;
              await this.driver.remove(id);
              end();
            }),
          ),
      };
      this.active.set(id, { stage, end });
      return stage;
    });
  }
  // Caller holds the stage key lock, including its freshness check.
  invalidate(id: string): void {
    this.active.get(id)?.end();
  }
}
