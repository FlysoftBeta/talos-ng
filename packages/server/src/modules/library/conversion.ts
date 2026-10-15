import { AppError } from "@talos/base";
import { mkdtemp, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createConverterRegistry,
  createTextConverter,
  createPdfConverter,
  resolvePdfRender,
  PdfRenderRunner,
  removeTemp,
} from "@talos/docpipe";
import type { ConverterRegistry } from "@talos/docpipe";
import type { ObjectStore, Stage } from "@talos/objectstore";
import type { JobContext } from "../../kernel/jobs/jobs.ts";
/** Lazy native resolution keeps text-only installations independent of PDF prerequisites. */
export function defaultConverters(): ConverterRegistry {
  return createConverterRegistry([
    {
      id: "pdf",
      detect: (head, name, mime) =>
        Buffer.from(head.subarray(0, 5)).toString("ascii") === "%PDF-" ||
        /\.pdf$/i.test(name) ||
        mime === "application/pdf",
      async convert(input, sink, ctx) {
        return createPdfConverter(
          new PdfRenderRunner({
            location: await resolvePdfRender({
              vendorDir: await vendorDirectory(),
            }),
          }),
        ).convert(input, sink, ctx);
      },
    },
    createTextConverter(),
  ]);
}
export async function convertObject(
  store: ObjectStore,
  registry: ConverterRegistry,
  source: string,
  name: string,
  ctx: JobContext,
): Promise<Stage> {
  const dir = await mkdtemp(path.join(tmpdir(), "talos-library-"));
  const stage = await store.stage(ctx.id);
  let output: Awaited<ReturnType<ObjectStore["stage"]>> | undefined;
  let prepared = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  ctx.signal.addEventListener("abort", abort);
  if (ctx.signal.aborted) abort();
  try {
    // Restart discards any incomplete output; immutable source remains retained by the document.
    await stage.abort();
    output = await store.stage(ctx.id);
    const input = path.join(dir, "source");
    await writeFile(input, store.read(source));
    await registry.convert(
      { path: input, name },
      {
        objectSink: {
          write: async (bytes) => {
            await output!.append(bytes, output!.size);
          },
        },
      },
      {
        signal: controller.signal,
        tmpDir: dir,
        progress: (done, total) =>
          ctx.progress(total ? done / total : 0, "正在转换文档"),
        log: () => {},
      },
    );
    if (ctx.signal.aborted) {
      await output.abort();
      throw new AppError("E_CANCELLED", "文档转换已取消");
    }
    prepared = true;
    return output;
  } finally {
    ctx.signal.removeEventListener("abort", abort);
    if (!prepared) await output?.abort();
    await removeTemp(dir);
  }
}

async function vendorDirectory(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "vendor/pdfrender"),
    path.resolve(process.cwd(), "../../vendor/pdfrender"),
    path.join(
      path.dirname(process.argv[1] ?? process.cwd()),
      "vendor/pdfrender",
    ),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* Try the packaged location next. */
    }
  }
  return candidates[0]!;
}
