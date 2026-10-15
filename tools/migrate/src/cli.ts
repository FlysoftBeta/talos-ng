import { resolve, join } from "node:path";
import { AppError } from "@talos/base";

import type { Options } from "./types.ts";

export function args(argv: string[]): { command: string; options: Options } {
  const command = argv.shift() ?? "";
  const values = new Map<string, string>();
  let resume = false;
  while (argv.length) {
    const key = argv.shift()!;
    if (key === "--resume") {
      resume = true;
      continue;
    }
    if (!["--source", "--blobs", "--target"].includes(key) || !argv.length)
      throw new AppError("E_INVALID", `Unknown or incomplete argument: ${key}`);
    values.set(key, argv.shift()!);
  }
  if (
    !["inspect", "run", "verify", "report"].includes(command) ||
    !values.get("--source") ||
    (command !== "inspect" && !values.get("--target"))
  )
    throw new AppError(
      "E_INVALID",
      "Usage: migrate <inspect|run|verify|report> --source data.db --blobs storage/objects --target data-dir [--resume]",
    );
  return {
    command,
    options: {
      source: resolve(values.get("--source")!),
      blobs: resolve(
        values.get("--blobs") ??
          join(resolve(values.get("--source")!), "..", "storage", "objects"),
      ),
      target: resolve(values.get("--target") ?? "."),
      resume,
    },
  };
}
