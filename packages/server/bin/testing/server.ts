import { isSyncReplica, runSyncReplica } from "../../src/app/sync-replica.ts";
import { runServer } from "../run-server.ts";
import { FakeProvider } from "../../src/modules/ai/testing/provider.ts";
if (isSyncReplica()) runSyncReplica();
else await runServer(new FakeProvider(), import.meta.url);
