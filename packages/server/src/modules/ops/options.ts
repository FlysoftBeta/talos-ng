import type { contract, ResultOf } from "@talos/contract";
import type { ObjectStore } from "@talos/objectstore";
import type { Clock } from "../../kernel/config/clock.ts";
import type { Jobs } from "../../kernel/jobs/jobs.ts";
import type { ObjectLedger } from "../../kernel/objects/objects.ts";
import type { TicketService } from "../../kernel/objects/tickets.ts";
import type { UploadService } from "../../kernel/objects/uploads.ts";
import type { Db } from "../../kernel/persistence/db.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import type { IdentityBackupOwner } from "../identity/ports.ts";
import type { HostTools } from "./host/adapter.ts";
import type { OfficeCapture } from "./office/adapter.ts";
import type { FetchBytes, UpdateBridge } from "./updates/service.ts";
export interface OpsOptions {
  dataDir?: string;
  /** Staged updates and the rollback backup; kernels without a layout (tests) use `<dataDir>/.tmp`. */
  tmpDir?: string;
  bridge?: UpdateBridge;
  hostTools?: HostTools;
  officeCapture?: OfficeCapture;
  fetch?: FetchBytes;
  httpsStatus?: () => ResultOf<typeof contract.ops.https.status>;
}
export interface OpsDependencies {
  identity: IdentityBackupOwner;
  db: Db;
  uow: Uow;
  store: ObjectStore;
  ledger: ObjectLedger;
  tickets: TicketService;
  uploads: UploadService;
  jobs: Jobs;
  now: () => number;
  clock: Clock;
  report(error: unknown): void;
  build: string;
}
