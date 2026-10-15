import { AppError } from "@talos/base";
import type { contract, ResultOf } from "@talos/contract";
import { digest } from "@talos/launcher";
import type { OpsDependencies } from "../options.ts";
import type { OfficeRow } from "../repo.ts";
import type { OpsRepo } from "../repo.ts";
import type { OfficeCapture } from "./adapter.ts";
export interface OfficeSessionsContext {
  office: OfficeCapture;
  repo: Pick<OpsRepo, "office" | "addOffice" | "clearOffice">;
  id: () => string;
  deps: Pick<OpsDependencies, "ledger" | "store" | "now" | "uow" | "tickets">;
}
export class OfficeSessions {
  private capturing = false;
  private capturedOpen = new Set<string>();
  constructor(private readonly context: OfficeSessionsContext) {}
  listOffice(): ResultOf<typeof contract.ops.office.list> {
    return {
      available: this.context.office.available,
      files: this.context.repo.office(),
    };
  }
  async refreshOffice(
    force = false,
  ): Promise<ResultOf<typeof contract.ops.office.list>> {
    if (this.capturing) throw new AppError("E_BUSY", "正在捕获文档");
    this.capturing = true;
    try {
      const next = new Set<string>();
      for (const file of await this.context.office.capture()) {
        const key = JSON.stringify([
          file.application,
          file.name.toLowerCase(),
          digest(file.bytes),
        ]);
        next.add(key);
        if (!force && this.capturedOpen.has(key)) continue;
        const id = this.context.id();
        await this.context.deps.ledger.publish(
          () => this.context.deps.store.put(file.bytes),
          (info) => {
            if (
              this.context.repo
                .office()
                .some(
                  (row) => row.objectId === info.id && row.name === file.name,
                )
            )
              return;
            const row: OfficeRow = {
              id,
              name: file.name,
              application: file.application,
              kind: file.kind,
              objectId: info.id,
              size: info.size,
              created: this.context.deps.now(),
            };
            this.context.repo.addOffice(row);
            this.context.deps.ledger.addRef(info.id, "ops-office", id);
          },
        );
      }
      this.capturedOpen = next;
      return this.listOffice();
    } finally {
      this.capturing = false;
    }
  }
  clearOffice(): void {
    if (!this.context.office.available)
      throw new AppError("E_UNAVAILABLE", "文档捕获仅支持 Windows");
    if (this.capturing) throw new AppError("E_BUSY", "正在捕获文档");
    this.context.deps.uow.write(() => {
      for (const row of this.context.repo.office())
        this.context.deps.ledger.removeRef(row.objectId, "ops-office", row.id);
      this.context.repo.clearOffice();
    });
  }
  officeDownload(
    user: string,
    id: string,
  ): ResultOf<typeof contract.ops.office.download> {
    const row = this.context.repo.office().find((row) => row.id === id);
    if (!row) throw new AppError("E_NOT_FOUND", "文档不存在");
    return this.context.deps.tickets.issue({
      user,
      objectId: row.objectId,
      filename: row.name,
      mime: "application/octet-stream",
    });
  }
}
