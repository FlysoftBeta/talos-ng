import { describe, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsObjectStore, createMemoryObjectStore } from "../index.ts";
import { objectStoreConformanceTests } from "./conformance.ts";

for (const kind of ["memory", "filesystem"] as const)
  describe(kind, () => {
    for (const test of objectStoreConformanceTests(async () => {
      let now = 1_700_000_000_000;
      const root =
        kind === "filesystem"
          ? await mkdtemp(join(tmpdir(), "talos-objects-"))
          : undefined;
      const store = root
        ? createFsObjectStore({ root, clock: () => now })
        : createMemoryObjectStore({ clock: () => now });
      return {
        store,
        advanceTime(ms) {
          now += ms;
        },
        async dispose() {
          if (root) await rm(root, { recursive: true, force: true });
        },
      };
    }))
      it(test.name, test.run);
  });
