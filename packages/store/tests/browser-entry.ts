import "../src/store.test.ts";
import { run } from "./browser-runner.ts";
import { openDb, FileStore, createFileStores } from "../src/index.ts";
const host = window as unknown as {
  storeResults?: ReturnType<typeof run>;
  storeApi: unknown;
};
host.storeApi = { openDb, FileStore, createFileStores };
if (location.search !== "?peer") host.storeResults = run();
