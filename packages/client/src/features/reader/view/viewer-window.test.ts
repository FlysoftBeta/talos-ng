import { describe, expect, it } from "vitest";
import { MemorySpool, PackReader, PackWriter } from "@talos/docpack";
import { utf8Encode } from "@talos/base";
import { ArraySource, Scroller } from "@talos/virtual";
import type { Unit } from "@talos/docpack";
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
    const scroller = new Scroller<Unit>(
      new ArraySource<Unit>(
        {
          key: (unit) => unit.id,
          size: (unit) => estimateUnit(manifest, unit, 900, "fit"),
        },
        manifest.units,
      ),
      { overscan: 600 },
    );
    await scroller.start({ id: "p49", offset: -123 });
    scroller.sense({ viewport: 800 });
    expect(scroller.position()).toEqual({ id: "p49", offset: -123 });
    for (let page = 0; page < 500; page += 7) {
      await scroller.jump({ id: `p${page}` });
      expect(scroller.getSnapshot().items.length).toBeLessThanOrEqual(4);
      expect(scroller.position()?.id).toBe(`p${page}`);
    }
  });
});
