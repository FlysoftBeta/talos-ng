import { isAbsolute } from "node:path";
import { z } from "zod";
import { AppError } from "@talos/base";

/**
 * Process wiring: what the parent process knows about how the server is
 * hosted (where its config and release files are, whether it is a
 * development run, who supervises it). It travels as the first IPC message
 * and is never operator configuration; operators edit the config directory
 * (`install/layout.ts`), whose `config.json` also places data, logs and tmp.
 */
const absolute = z.string().refine(isAbsolute, "必须是绝对路径");

export const serverWiringObject = z
  .object({
    /** Config directory; with the server's working directory it fixes the layout. */
    configDir: absolute,
    /** Client release directory served over HTTP. */
    assetsDir: absolute,
    /** Service-worker file served at `/sw.js`; none serves no worker. */
    workerFile: absolute.optional(),
    /** Development switches; the deterministic seed requires dev. */
    dev: z.boolean().default(false),
    testSeed: z.boolean().default(false),
    /** Print the first-start root PIN to stdout. */
    printRootPin: z.boolean().default(true),
    /**
     * yt-dlp executable and its plugin directory. A release finds both next
     * to `server.js`; a checkout has to be told by its dev parent.
     */
    ytDlp: absolute.optional(),
    pluginDir: absolute.optional(),
    /** Present when the launcher supervises this process (updates, rollback). */
    launcher: z
      .object({
        /** The installed package target (`target` file), which updates must match. */
        target: z.string().min(1),
        updatePending: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const serverWiringSchema = serverWiringObject.superRefine(
  (wiring, ctx) => {
    if (wiring.testSeed && !wiring.dev)
      ctx.addIssue({ code: "custom", message: "测试账户仅限开发模式" });
  },
);
export type ServerWiring = z.infer<typeof serverWiringSchema>;

export const startMessageSchema = z
  .object({ type: z.literal("start"), config: serverWiringSchema })
  .strict();

/** Validates a received start message and returns its wiring. */
export function parseStartMessage(message: unknown): ServerWiring {
  const parsed = startMessageSchema.safeParse(message);
  if (!parsed.success)
    throw AppError.wrap("E_INVALID", "服务器启动消息无效", parsed.error);
  return parsed.data.config;
}

/** Parent side: validates the wiring and sends the one start message. */
export function sendStart(
  child: { send(message: unknown): boolean },
  wiring: z.input<typeof serverWiringSchema>,
): void {
  child.send({
    type: "start",
    config: parseStartMessage({ type: "start", config: wiring }),
  });
}
