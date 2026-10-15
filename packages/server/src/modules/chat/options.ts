import type { ObjectStore } from "@talos/objectstore";
import type { ObjectLedger } from "../../kernel/objects/objects.ts";
import type { UploadService } from "../../kernel/objects/uploads.ts";
import type { Db } from "../../kernel/persistence/db.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import type { CommunityRead } from "../community/ports.ts";
import type { IdentityAuthors } from "../identity/ports.ts";
export interface ChatOptions {
  db: Db;
  uow: Uow;
  community: CommunityRead;
  identity: IdentityAuthors;
  objects: ObjectLedger;
  store: ObjectStore;
  uploads: UploadService;
  now?: () => number;
}
export interface BodyChunk {
  data: { size: number; offset: number; eof: boolean };
  body: Uint8Array;
}
