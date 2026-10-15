import { readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { z } from "zod";
import { AppError } from "@talos/base";
const port = z.number().int().min(0).max(65535);
export const configSchema = z
  .object({
    ports: z.array(port).default([8080]),
    securePorts: z.array(port).default([]),
    bindHost: z.string().min(1).default("0.0.0.0"),
    dataDir: z.string().min(1).default("./.data"),
    assetsDir: z.string().min(1).default("./packages/client/dist"),
    workerFile: z.string().min(1).default("./packages/shell/dist/sw.js"),
    testSeed: z.boolean().default(false),
    build: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
      .default("dev"),
    dev: z.boolean().default(false),
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
    binaries: z.record(z.string()).default({}),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.testSeed && !config.dev)
      ctx.addIssue({ code: "custom", message: "测试账户仅限开发模式" });
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
export async function loadConfig(
  file = resolve("talos.config.json"),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ServerConfig> {
  let input: Record<string, unknown> = {};
  try {
    const text = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    input = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new AppError("E_INVALID", "无法读取服务器配置");
  }
  const names: Record<string, string> = {
    PORTS: "ports",
    SECURE_PORTS: "securePorts",
    BIND_HOST: "bindHost",
    DATA_DIR: "dataDir",
    ASSETS_DIR: "assetsDir",
    BUILD: "build",
    WORKER_FILE: "workerFile",
    TEST_SEED: "testSeed",
    DEV: "dev",
    AI_MODELS_FILE: "aiModelsFile",
    BINARIES: "binaries",
  };
  for (const [key, name] of Object.entries(names)) {
    const value = env[`TALOS_${key}`];
    if (value === undefined) continue;
    try {
      if (key === "PORTS" || key === "SECURE_PORTS") {
        const trimmed = value.trim();
        if (trimmed.startsWith("["))
          input[name] = JSON.parse(trimmed) as unknown;
        else {
          const parts = trimmed.split(",").map((part) => part.trim());
          if (parts.some((part) => !/^\d+$/.test(part))) throw new Error();
          input[name] = parts.map(Number);
        }
      } else
        input[name] = ["DEV", "TEST_SEED", "BINARIES"].includes(key)
          ? (JSON.parse(value) as unknown)
          : value;
    } catch {
      throw new AppError("E_INVALID", `环境变量 TALOS_${key} 无效`);
    }
  }
  const https = {
    ...(typeof input.https === "object" && input.https ? input.https : {}),
  } as Record<string, unknown>;
  for (const key of ["CERT", "KEY", "CA", "DOMAIN", "REDIRECT"]) {
    const value = env[`TALOS_HTTPS_${key}`];
    if (value === undefined) continue;
    if (key === "REDIRECT") {
      if (value !== "true" && value !== "false")
        throw new AppError("E_INVALID", "HTTPS 重定向配置无效");
      https.redirect = value === "true";
    } else https[key.toLowerCase()] = value;
  }
  if (Object.keys(https).length) input.https = https;
  const config = parseConfig(input);
  const base = dirname(resolve(file));
  config.dataDir = resolve(base, config.dataDir);
  config.assetsDir = resolve(base, config.assetsDir);
  config.workerFile = resolve(base, config.workerFile);
  if (config.https)
    for (const key of ["cert", "key", "ca"] as const) {
      const path = config.https[key];
      if (path) config.https[key] = resolve(base, path);
    }
  if (config.aiModelsFile)
    config.aiModelsFile = resolve(base, config.aiModelsFile);
  for (const key of Object.keys(config.binaries))
    config.binaries[key] = resolve(base, config.binaries[key]!);
  return config;
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
