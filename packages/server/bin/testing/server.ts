import { runServer } from "../run-server.ts";
import { FakeProvider } from "../../src/modules/ai/testing/provider.ts";
await runServer(new FakeProvider());
