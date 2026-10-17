import { readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { z } from "zod";
import { AppError } from "@talos/base";
import { serverWiringObject } from "@talos/launcher";

/**
 * Two sources, never mixed: operator settings from `talos.config.json`
 * (below) and process wiring from the parent process (`@talos/launcher`
 * server-start). Nothing is read from environment variables.
 */
const port = z.number().int().min(0).max(65535);
const settingsObject = z
  .object({
    ports: z.array(port).default([8080]),
    securePorts: z.array(port).default([]),
    bindHost: z.string().min(1).default("0.0.0.0"),
    https: z
      .object({
        cert: z.string(),
        key: z.string(),
        ca: z.string().optional(),
        domain: z
          .string()
          .regex(/^[A-Za-z0-9.-]+$/)
          .optional(),
        redirect: z.boolean().default(false),
      })
      .optional(),
    aiModelsFile: z.string().optional(),
  })
  .strict();
const wiringObject = serverWiringObject.omit({ settingsFile: true });

function checkSettings(
  config: z.infer<typeof settingsObject>,
  ctx: z.RefinementCtx,
): void {
  if (config.securePorts.length && !config.https)
    ctx.addIssue({ code: "custom", message: "HTTPS 需要证书" });
  if (
    config.https?.redirect &&
    (!config.securePorts.length || !config.https.domain)
  )
    ctx.addIssue({ code: "custom", message: "重定向需要 HTTPS 端口和域名" });
  for (const ports of [config.ports, config.securePorts])
    if (
      new Set(ports.filter((p) => p !== 0)).size !==
      ports.filter((p) => p !== 0).length
    )
      ctx.addIssue({ code: "custom", message: "端口重复" });
  if (config.ports.some((p) => p !== 0 && config.securePorts.includes(p)))
    ctx.addIssue({ code: "custom", message: "HTTP 和 HTTPS 端口冲突" });
}
export const settingsSchema = settingsObject.superRefine(checkSettings);
export type Settings = z.infer<typeof settingsSchema>;

/** Settings plus wiring: everything `startServer` needs. */
export const configSchema = settingsObject
  .merge(wiringObject)
  .superRefine((config, ctx) => {
    checkSettings(config, ctx);
    if (config.testSeed && !config.dev)
      ctx.addIssue({ code: "custom", message: "测试账户仅限开发模式" });
  });
export type ServerConfig = z.infer<typeof configSchema>;

export function parseConfig(value: unknown): ServerConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError("E_INVALID", "服务器配置无效", {
      fields: parsed.error.issues.map((i) => i.path.join(".")),
    });
  return parsed.data;
}

/**
 * Reads the operator settings. A missing file means defaults; relative paths
 * resolve beside the file.
 */
export async function loadSettings(file: string): Promise<Settings> {
  let input: unknown = {};
  try {
    input = JSON.parse(await readFile(file, "utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new AppError("E_INVALID", "无法读取服务器配置");
  }
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("E_INVALID", "服务器配置无效", {
      fields: parsed.error.issues.map((i) => i.path.join(".")),
    });
  const settings = parsed.data;
  const base = dirname(resolve(file));
  if (settings.https)
    for (const key of ["cert", "key", "ca"] as const) {
      const path = settings.https[key];
      if (path) settings.https[key] = resolve(base, path);
    }
  if (settings.aiModelsFile)
    settings.aiModelsFile = resolve(base, settings.aiModelsFile);
  return settings;
}
export function dataLayout(dataDir: string): {
  root: string;
  db: string;
  objects: string;
  backups: string;
  logs: string;
} {
  const root = resolve(dataDir);
  return {
    root,
    db: join(root, "talos.db"),
    objects: root,
    backups: join(root, "backups"),
    logs: join(root, "logs"),
  };
}
