import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { AppError } from "@talos/base";
import { PackReader } from "@talos/docpack";
import { createConverterRegistry } from "./conversion/registry.ts";
import { createTextConverter } from "./text/text.ts";
import { createPdfConverter } from "./pdfrender/pdf.ts";
import { diagnosePdfRender, resolvePdfRender } from "./pdfrender/resolve.ts";
import { PdfRenderRunner } from "./pdfrender/runner.ts";
import { FileAccess } from "./file-spool/files.ts";
async function main(): Promise<void> {
  const [command, input, output, ...rest] = process.argv.slice(2);
  if (
    (command !== "doctor" && !input) ||
    rest.length ||
    (command === "convert"
      ? !output
      : command === "doctor"
        ? input !== undefined || output !== undefined
        : command !== "inspect" || output !== undefined)
  )
    throw new AppError(
      "E_INVALID",
      "用法: docpipe convert <in> <out.tdp> | docpipe inspect <pack> | docpipe doctor",
    );
  if (command === "doctor") {
    const vendorDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../vendor/pdfrender",
    );
    try {
      const diagnosis = await diagnosePdfRender({ vendorDir });
      const manifest = JSON.parse(
        await (
          await import("node:fs/promises")
        ).readFile(path.join(vendorDir, "manifest.json"), "utf8"),
      ) as { run: { headSha: string } };
      process.stdout.write(
        JSON.stringify(
          {
            target: diagnosis.selected.target,
            chosen: diagnosis.selected.flavor,
            executable: diagnosis.selected.executable,
            version: `build ${manifest.run.headSha}`,
            flavors: diagnosis.flavors,
          },
          null,
          2,
        ) + "\n",
      );
    } catch (error) {
      if (error instanceof AppError && error.data)
        process.stdout.write(
          JSON.stringify(
            { chosen: null, version: null, ...error.data },
            null,
            2,
          ) + "\n",
        );
      throw error;
    }
    return;
  }
  if (command === "inspect") {
    const file = await FileAccess.open(input!);
    try {
      const reader = await PackReader.open(file);
      process.stdout.write(JSON.stringify(reader.manifest, null, 2) + "\n");
    } finally {
      await file.close();
    }
    return;
  }
  const vendorDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../vendor/pdfrender",
  );
  const runner = new PdfRenderRunner({
    location: await resolvePdfRender({ vendorDir }),
  });
  const registry = createConverterRegistry([
    createPdfConverter(runner),
    createTextConverter(),
  ]);
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const summary = await registry.convert(
      { path: input!, name: path.basename(input!) },
      { filePath: output! },
      {
        signal: controller.signal,
        tmpDir: tmpdir(),
        progress: () => {},
        log: (message, data) =>
          process.stderr.write(JSON.stringify({ message, data }) + "\n"),
      },
    );
    process.stdout.write(JSON.stringify(summary) + "\n");
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
void main().catch((error: unknown) => {
  const e =
    error instanceof AppError
      ? error
      : new AppError("E_INTERNAL", "文档处理失败", { cause: String(error) });
  process.stderr.write(JSON.stringify(e.toJSON()) + "\n");
  process.exitCode = 1;
});
