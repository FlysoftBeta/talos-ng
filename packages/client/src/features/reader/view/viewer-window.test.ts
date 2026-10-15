import { describe, expect, it } from "vitest";
import { MemorySpool, PackReader, PackWriter } from "@talos/docpack";
import { utf8Encode } from "@talos/base";
import { VirtualListCore } from "../../../ui/virtual/index.ts";
import { estimateUnit } from "../model/resources.ts";
describe("bounded reader window", () => {
  it("mounts a bounded window across a real 500-unit TDP manifest", async () => {
    const sink = new MemorySpool(),
      spool = new MemorySpool(),
      writer = new PackWriter(sink, spool, { kind: "paged" });
    const rid = await writer.addResource(
      utf8Encode("<html><body>第 1 页</body></html>"),
      "text/html",
    );
    for (let i = 0; i < 500; i++)
      writer.addUnit({ id: `p${i}`, entry: rid, deps: [], w: 600, h: 800 });
    await writer.finish();
    const manifest = (await PackReader.open(sink)).clientManifest();
    const core = new VirtualListCore({ overscan: 600 });
    core.setItems(manifest.units.map((unit) => unit.id));
    core.setViewport(0, 800);
    manifest.units.forEach((unit, i) =>
      core.measure(i, estimateUnit(manifest, unit, 900, "fit")),
    );
    for (let page = 0; page < 500; page++) {
      core.scrollToIndex(page, "start");
      const range = core.range();
      expect(range.end - range.start).toBeLessThanOrEqual(4);
    }
    core.setViewport(core.offsetOf(49) + 123, 800);
    expect(core.range(0).start).toBe(49);
    expect(core.offset - core.offsetOf(49)).toBe(123);
  });
});
