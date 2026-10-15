import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { PackWriter } from "@talos/docpack";
import type { Manifest, PackSink, PackWriterOptions } from "@talos/docpack";
import { FileSpool, removeTemp } from "../file-spool/files.ts";
import { checkAbort } from "./ports.ts";
import type { ConvertCtx } from "./ports.ts";
export async function writePack(
  sink: PackSink,
  ctx: ConvertCtx,
  options: PackWriterOptions,
  fill: (writer: PackWriter) => Promise<void>,
): Promise<{ manifest: Manifest; bytes: number }> {
  checkAbort(ctx.signal);
  await mkdir(ctx.tmpDir, { recursive: true });
  const dir = await mkdtemp(path.join(ctx.tmpDir, "tdp-spool-"));
  let spool: FileSpool | undefined;
  try {
    spool = await FileSpool.create(path.join(dir, "resources"));
    let bytes = 0;
    const writer = new PackWriter(
      {
        write: async (chunk) => {
          checkAbort(ctx.signal);
          await sink.write(chunk);
          bytes += chunk.length;
        },
      },
      spool,
      options,
    );
    await fill(writer);
    checkAbort(ctx.signal);
    const manifest = await writer.finish();
    return { manifest, bytes };
  } finally {
    try {
      await spool?.close();
    } finally {
      await removeTemp(dir);
    }
  }
}
