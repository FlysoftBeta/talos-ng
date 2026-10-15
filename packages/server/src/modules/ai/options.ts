import type { ObjectStore } from "@talos/objectstore";
import type { Jobs } from "../../kernel/jobs/jobs.ts";
import type { UploadService } from "../../kernel/objects/uploads.ts";
import type { Db } from "../../kernel/persistence/db.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import type { ModelProvider } from "./providers/responses.ts";
export interface AiOptions {
  assertOwnerWritable?(user: string): void;
  db: Db;
  uow: Uow;
  jobs: Jobs;
  uploads: UploadService;
  store: ObjectStore;
  now: () => number;
  provider?: ModelProvider;
  id?: () => string;
  allowed?: (user: string) => boolean;
}
