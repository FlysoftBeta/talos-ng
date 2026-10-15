// Narrow entry for the offline legacy importer (tools/migrate). Production server
// and client code never import this file; the boundary rules enforce it.
export { createKernel } from "./app/create-application.ts";
export type { Kernel } from "./app/create-application.ts";
export { Db } from "./kernel/persistence/db.ts";
export { Uow } from "./kernel/persistence/uow.ts";
export { ObjectLedger } from "./kernel/objects/objects.ts";
export { IdentityService } from "./modules/identity/index.ts";
