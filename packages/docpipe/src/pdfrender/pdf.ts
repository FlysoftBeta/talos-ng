import { guardConverter } from "../conversion/errors.ts";
import path from "node:path";
import type { Converter } from "../conversion/ports.ts";
import { checkAbort } from "../conversion/ports.ts";
import type { PdfRenderRunner } from "./runner.ts";
import { FileAccess } from "../file-spool/files.ts";
import { PdfRenderArchive } from "./archive.ts";
import { writePack } from "../conversion/write-pack.ts";
export function createPdfConverter(runner: PdfRenderRunner): Converter {
  return guardConverter({
    id: "pdf",
    detect: (head, name, mime) =>
      Buffer.from(head.subarray(0, 5)).toString("ascii") === "%PDF-" ||
      /\.pdf$/i.test(name) ||
      mime?.split(";")[0]?.trim().toLowerCase() === "application/pdf",
    convert: async (input, sink, ctx) =>
      runner.run(input.path, ctx.tmpDir, ctx.signal, async (archivePath) => {
        const source = await FileAccess.open(archivePath);
        try {
          const archive = await PdfRenderArchive.open(source);
          const manifest = archive.manifest;
          const title = path.parse(input.name).name;
          const { bytes } = await writePack(
            sink,
            ctx,
            {
              kind: "paged",
              title,
              meta: {
                sourceMime: manifest.document.sourceMime,
                sourcePages: manifest.document.sourcePages,
              },
            },
            async (writer) => {
              for (let i = 0; i < manifest.resources.length; i++) {
                checkAbort(ctx.signal);
                const r = manifest.resources[i]!;
                await writer.addResource(
                  await archive.readDecoded(r.contentId),
                  r.mime,
                );
                ctx.progress(i + 1, manifest.resources.length);
              }
              for (const p of manifest.document.items)
                writer.addUnit({
                  id: p.id,
                  entry: p.document,
                  deps: p.dependencies,
                  w: Math.ceil(p.width),
                  h: Math.ceil(p.height),
                });
              writer.setShared(manifest.document.shared);
            },
          );
          return {
            kind: "paged",
            units: manifest.document.items.length,
            title,
            bytes,
            warnings: [],
          };
        } finally {
          await source.close();
        }
      }),
  });
}
