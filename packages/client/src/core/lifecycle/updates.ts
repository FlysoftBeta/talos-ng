import { AppError } from "@talos/base";
import type { SyncEngine } from "../data/sync-engine.ts";
import type { ClientSnapshot } from "./snapshot.ts";
import type { RuntimeConfiguration as RuntimeOptions } from "./configuration.ts";
import type { StatusViewModel } from "../status/model.ts";
import { toUpdateStatus } from "../status/update-status.ts";
import type { BootHandle } from "./boot.ts";
import type { RuntimeEnvironment } from "./environment.ts";

export interface UpdateControllerPorts {
  boot?: BootHandle;
  snapshot: ClientSnapshot;
  options: Pick<RuntimeOptions, "production">;
  environment: Pick<
    RuntimeEnvironment,
    "boot" | "exposeInstaller" | "manifest" | "reload"
  >;
  build: string;
  status(patch: Partial<StatusViewModel>): void;
  report: (error: unknown) => void;
  updateChecking?: Promise<void>;
  engine?: SyncEngine;
}

export class UpdateController {
  constructor(private readonly ports: UpdateControllerPorts) {}
  stableGate(): void {
    if (
      this.ports.boot ||
      this.ports.snapshot.gate === "boot" ||
      !this.ports.options.production
    )
      return;
    this.ports.boot = this.ports.environment.boot(this.ports.build, (state) => {
      this.ports.status({
        update: toUpdateStatus(state, this.ports.build, () => {
          void this.applyUpdate().catch(this.ports.report);
        }),
      });
    });
    this.ports.environment.exposeInstaller(this.ports.boot.installer);
    void this.ports.boot.start().catch((error: unknown) => {
      this.ports.status({
        update: {
          state: "none",
          message:
            error instanceof AppError ? error.message : "暂时无法检查更新",
        },
      });
    });
  }
  async checkUpdate(): Promise<void> {
    if (!this.ports.boot) return;
    if (this.ports.updateChecking) return this.ports.updateChecking;
    this.ports.updateChecking = (async () => {
      await this.ports.boot!.start();
      await this.ports.boot!.installer.install(
        await this.ports.environment.manifest(),
      );
    })();
    try {
      await this.ports.updateChecking;
    } finally {
      this.ports.updateChecking = undefined;
    }
  }
  /** The server refused this build: stage its release in the background and offer it. */
  rejected(): void {
    this.ports.status({
      versionRejected: {
        updateNow: () => {
          void this.updateNow().catch(this.ports.report);
        },
      },
    });
    void this.checkUpdate().catch(this.ports.report);
  }
  /** Finishes (or joins) staging the server's release, then activates it. */
  async updateNow(): Promise<void> {
    // Nothing is staged without a ServiceWorker; a reload fetches the server's build.
    if (this.ports.boot?.offline === false) {
      this.ports.environment.reload();
      return;
    }
    await this.checkUpdate();
    await this.applyUpdate();
  }
  async applyUpdate(): Promise<void> {
    if (!this.ports.boot) return;
    this.ports.engine?.sideState(true, true);
    await this.ports.boot.installer.apply();
    this.ports.environment.reload();
  }
}
