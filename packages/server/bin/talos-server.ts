import { isSyncReplica, runSyncReplica } from "../src/app/sync-replica.ts";
import { runServer } from "./run-server.ts";
// The bundle is also the replica workers' entry (see app/sync-replica.ts).
if (isSyncReplica()) runSyncReplica();
else await runServer(undefined, import.meta.url);
