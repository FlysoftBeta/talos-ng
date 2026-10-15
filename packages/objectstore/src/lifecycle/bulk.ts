import type { ObjectBatch, ObjectStore } from "../ports.ts";

/** Memory/custom backends can keep their existing per-object durability. */
export function beginObjectBatch(store: ObjectStore): ObjectBatch {
  return (
    store.beginBulk?.() ?? {
      put: (src, expect) => store.put(src, expect),
      commit: async () => {},
    }
  );
}
