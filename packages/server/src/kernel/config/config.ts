import { isAbsolute, resolve, join } from "node:path";
import { z } from "zod";
import { AppError } from "@talos/base";
import {
  installPathsObject,
  readOperatorFile,
  serverWiringObject,
} from "@talos/launcher";
import type { InstallLayout } from "@talos/launcher";

/**
 * Two sources, never mixed: operator settings from the config directory's
 * `config.json` (below; its path keys belong to the install layout in
 * `@talos/launcher`) and process wiring from the parent process
 * (`@talos/launcher` server-start). Nothing is read from environment variables.
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
    ...installPathsObject.shape,
  })
  .strict();
const absolute = z.string().refine(isAbsolute, "必须是绝对路径");
/** Where this process keeps its files, resolved from the install layout. */
const placementObject = z.object({
  dataDir: absolute,
  logsDir: absolute,
  tmpDir: absolute,
  /** AI provider and models (`model.json`); a missing file means no AI. */
  modelFile: absolute.optional(),
});
const wiringObject = serverWiringObject.omit({ configDir: true });

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
  .omit({ dataDir: true, logsDir: true, tmpDir: true })
  .merge(placementObject)
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
    throw AppError.wrap("E_INVALID", "服务器配置无效", parsed.error);
  return parsed.data;
}

/**
 * Reads the operator settings of `layout.configFile`. A missing file means
 * defaults; relative certificate paths resolve against the working directory
 * like every other install path.
 */
export async function loadSettings(
  layout: Pick<InstallLayout, "configFile">,
  cwd: string = process.cwd(),
): Promise<Settings> {
  const parsed = settingsSchema.safeParse(
    await readOperatorFile(layout.configFile),
  );
  if (!parsed.success)
    throw AppError.wrap("E_INVALID", `${layout.configFile} 无效`, parsed.error);
  const settings = parsed.data;
  if (settings.https)
    for (const key of ["cert", "key", "ca"] as const) {
      const path = settings.https[key];
      if (path) settings.https[key] = resolve(cwd, path);
    }
  return settings;
}

/** The server's full configuration: settings, the resolved layout and the parent's wiring. */
export async function serverConfig(
  layout: InstallLayout,
  wiring: z.input<typeof wiringObject>,
): Promise<ServerConfig> {
  // The layout's resolved directories replace the settings' relative path keys.
  return parseConfig({
    ...(await loadSettings(layout)),
    ...wiring,
    dataDir: layout.dataDir,
    logsDir: layout.logsDir,
    tmpDir: layout.tmpDir,
    modelFile: layout.modelFile,
  });
}

/** The data directory holds business data only: database, object storage, backups. */
export function dataLayout(dataDir: string): {
  root: string;
  db: string;
  lock: string;
  backups: string;
} {
  const root = resolve(dataDir);
  return {
    root,
    db: join(root, "talos.db"),
    lock: join(root, "server.lock"),
    backups: join(root, "backups"),
  };
}
