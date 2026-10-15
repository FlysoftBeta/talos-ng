import { beginObjectBatch } from "@talos/objectstore";
import type { ObjectBatch, ObjectInfo, ObjectStore } from "@talos/objectstore";
import type { Kernel } from "@talos/server/migration";

/** Offline import: flush bytes before committing a bounded group of ownership/journal rows. */
export class ImportObjectBatch {
  private batch: ObjectBatch;
  private writes: (() => void)[] = [];
  constructor(
    private readonly kernel: Pick<Kernel, "store" | "uow" | "objects">,
  ) {
    this.batch = beginObjectBatch(kernel.store);
  }
  readonly put: ObjectStore["put"] = (src, expect) =>
    this.batch.put(src, expect);
  async publish(
    produce: (put: ObjectStore["put"]) => Promise<ObjectInfo>,
    retain: (info: ObjectInfo) => void,
    failed: (error: unknown) => void,
  ): Promise<void> {
    const info = await produce(this.put);
    this.write(() => {
      this.kernel.objects.register(info);
      retain(info);
    }, failed);
  }
  write(retain: () => void, failed: (error: unknown) => void): void {
    this.writes.push(() => {
      try {
        this.kernel.uow.write(retain);
      } catch (error) {
        failed(error);
      }
    });
  }
  async flush(): Promise<void> {
    await this.batch.commit();
    if (this.writes.length)
      this.kernel.uow.write(() => {
        for (const write of this.writes) write();
      });
    this.writes = [];
    this.batch = beginObjectBatch(this.kernel.store);
  }
}
