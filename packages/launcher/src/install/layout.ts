import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { AppError } from "@talos/base";

/**
 * The install layout, shared by the launcher and the server. The working
 * directory is the install root and every relative path resolves against it.
 * The config directory (the first argument, default `config`) holds the
 * operator files `config.json` and `model.json`; it and `versions/` are fixed,
 * the other directories may be moved in `config.json`.
 */
export const installPathsObject = z.object({
  /** Business data only: database, object storage, backups. */
  dataDir: z.string().min(1).default("data"),
  /** Operator logs: launcher and server. */
  logsDir: z.string().min(1).default("logs"),
  /** Operator scratch: downloaded updates, versions being unpacked, server temp files. */
  tmpDir: z.string().min(1).default("tmp"),
});

export interface InstallLayout {
  configDir: string;
  /** Operator settings; may not exist (defaults). */
  configFile: string;
  /** AI provider and models; may not exist (no AI). */
  modelFile: string;
  dataDir: string;
  logsDir: string;
  tmpDir: string;
  /** One directory per installed version plus the launcher's state. */
  versionsDir: string;
}

/** The config directory named by a process's first argument. */
export function configDirectory(
  argument?: string,
  cwd: string = process.cwd(),
): string {
  return resolve(cwd, argument ?? "config");
}

/** Reads an operator JSON object file; a missing file is an empty object. */
export async function readOperatorFile(
  file: string,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw AppError.wrap("E_INVALID", `无法读取 ${file}`, error);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw AppError.wrap("E_INVALID", `${file} 不是有效的 JSON`, error);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("E_INVALID", `${file} 必须是 JSON 对象`);
  return value as Record<string, unknown>;
}

/** Resolves the layout from `config.json`'s path settings (other keys are the server's). */
export async function readInstallLayout(
  configDir: string,
  cwd: string = process.cwd(),
): Promise<InstallLayout> {
  const root = resolve(cwd);
  const config = resolve(root, configDir);
  const configFile = join(config, "config.json");
  const parsed = installPathsObject.safeParse(
    await readOperatorFile(configFile),
  );
  if (!parsed.success)
    throw AppError.wrap(
      "E_INVALID",
      `${configFile} 路径配置无效`,
      parsed.error,
    );
  return {
    configDir: config,
    configFile,
    modelFile: join(config, "model.json"),
    dataDir: resolve(root, parsed.data.dataDir),
    logsDir: resolve(root, parsed.data.logsDir),
    tmpDir: resolve(root, parsed.data.tmpDir),
    versionsDir: join(root, "versions"),
  };
}
