import { materializeProjections } from "./target/projections.ts";
import { tables } from "./legacy/readers.ts";
import { sourceRows } from "./legacy/readers.ts";
import { inspect } from "./legacy/inspect.ts";
import { anomalies } from "./legacy/inspect.ts";
import { importAttachments } from "./target/attachments.ts";
import { importSharing } from "./target/sharing.ts";
import { report } from "./report.ts";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  Db,
  Uow,
  IdentityService,
  createKernel,
} from "@talos/server/migration";
import { createFsObjectStore } from "@talos/objectstore";
import { AppError } from "@talos/base";

import { exists, openSource } from "./legacy/db.ts";
import { args } from "./cli.ts";
import { value } from "./values.ts";
import {
  mapped,
  mapId,
  issue,
  sourceId,
  setup,
  sourceHash,
  sourceFingerprint,
} from "./journal.ts";
import { verifyRows } from "./verify.ts";
import { materializeArticles, finishCollections } from "./target/library.ts";
import { materializeImages, materializeStickers } from "./target/chat.ts";
import { materializeMedia } from "./target/media.ts";
import { retainWorkspaces, importWorkspaceFiles } from "./target/ai.ts";
import { importSettings } from "./target/identity.ts";
import { importRow } from "./entities/index.ts";

export async function main(argv: string[]): Promise<void> {
  const { command, options } = args(argv);
  const source = openSource(options.source);
  try {
    if (command === "inspect") {
      process.stdout.write(
        JSON.stringify(
          {
            schema: source.schema(),
            counts: inspect(source),
            anomalies: anomalies(source, options),
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }
    if (
      command === "run" &&
      existsSync(options.target) &&
      (await readdir(options.target)).length &&
      !options.resume
    )
      throw new AppError(
        "E_CONFLICT",
        "Target is not empty; --resume requires this migration journal",
      );
    if (command === "run") await mkdir(options.target, { recursive: true });
    const targetPath = join(options.target, "talos.db");
    if (command !== "run" && !existsSync(targetPath))
      throw new AppError("E_NOT_FOUND", "Migration target not found");
    const target = new Db(targetPath);
    try {
      if (command === "run") {
        if (options.resume && !exists(target, "migration_meta"))
          throw new AppError("E_CONFLICT", "No migration journal in target");
        const secret = source.get<{ value: string }>(
          "SELECT value FROM config WHERE key='pin_secret'",
        )?.value;
        if (!secret)
          throw new AppError(
            "E_INVALID",
            "Legacy PIN secret missing; PIN hashes cannot be verified",
          );
        const uow = new Uow(target, { committed: () => {} });
        new IdentityService({ db: target, uow });
        setup(target);
        if (
          options.resume &&
          target.get<{ value: string }>(
            "SELECT value FROM migration_meta WHERE key='format'",
          )?.value !== "2"
        )
          throw new AppError(
            "E_CONFLICT",
            "Part-1/unknown migration journal: rerun into a fresh directory for completed media mappings",
          );
        target.run("INSERT OR IGNORE INTO migration_meta VALUES('format','2')");
        const fingerprint = await sourceFingerprint(options.source, secret);
        const old = target.get<{ value: string }>(
          "SELECT value FROM migration_meta WHERE key='source'",
        )?.value;
        if (old && old !== fingerprint)
          throw new AppError("E_CONFLICT", "Resume source differs");
        target.run(
          "INSERT OR IGNORE INTO migration_meta VALUES('source',?)",
          fingerprint,
        );
        target.run("UPDATE secrets SET value=? WHERE name='pin_hmac'", secret);
        if (exists(source, "user_admin_roles"))
          for (let offset = 0; ; offset += 500) {
            const rows = sourceRows(source, "user_admin_roles", offset);
            if (!rows.length) break;
            target.tx(() => {
              for (const row of rows)
                target.run(
                  "INSERT OR IGNORE INTO migration_roles VALUES(?,?)",
                  value(row, "user_id"),
                  value(row, "role"),
                );
            });
          }
        let batches = 0;
        const importTable = (
          table: string,
          kernel?: ReturnType<typeof createKernel>,
        ): void => {
          if (!exists(source, table)) return;
          for (let offset = 0; ; offset += 500) {
            const rows = sourceRows(source, table, offset);
            if (!rows.length) break;
            const batch = () => {
              for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!,
                  id = sourceId(row);
                if (mapped(target, table, id)) continue;
                const hash = sourceHash(row);
                try {
                  const newId = target.tx(() =>
                    importRow(target, table, row, id, kernel, source),
                  );
                  target.run(
                    "INSERT INTO migration_map VALUES(?,?,?,?)",
                    table,
                    id,
                    newId,
                    hash,
                  );
                } catch (error) {
                  issue(
                    target,
                    table,
                    id,
                    error instanceof Error ? error.message : String(error),
                  );
                  target.run(
                    "INSERT INTO migration_map VALUES(?,?,?,?)",
                    table,
                    id,
                    id,
                    hash,
                  );
                }
              }
            };
            if (kernel) kernel.uow.write(batch);
            else target.tx(batch);
            batches++;
            if (
              process.env.TALOS_MIGRATE_STOP_AFTER_BATCH &&
              batches === Number(process.env.TALOS_MIGRATE_STOP_AFTER_BATCH)
            )
              throw new AppError(
                "E_CANCELLED",
                "Injected stop after committed batch",
              );
          }
        };
        for (const table of ["users", "user_pins"]) importTable(table);
        const kernel = createKernel({
          db: target,
          store: createFsObjectStore({ root: options.target }),
          build: "migration",
          backgroundTasks: false,
          printRootPin: () => {},
        });
        for (const table of tables)
          if (table !== "users" && table !== "user_pins")
            importTable(table, kernel);
        target.tx(() => {
          for (const p of target.all<{ child: string; parent: string }>(
            "SELECT * FROM migration_parents",
          ))
            target.run(
              "UPDATE community_conversations SET parent=? WHERE id=?",
              mapId(target, "groups", p.parent),
              p.child,
            );
        });
        finishCollections(target, kernel, source);
        importSharing(source, target, kernel);
        importSettings(source, target, kernel);
        await materializeArticles(source, target, kernel, options);
        await materializeImages(source, target, kernel, options);
        await materializeStickers(target, kernel);
        await materializeMedia(source, target, kernel, options);
        await retainWorkspaces(target, kernel, options);
        await importWorkspaceFiles(target, options, kernel);
        importAttachments(source, target);
        materializeProjections(target, kernel);
        await kernel.close();
        target.run(
          "UPDATE jobs SET run_after=0 WHERE kind='library.convert' AND state='queued'",
        );
      }
      const counts = inspect(source);
      const migrated = Object.fromEntries(
        Object.keys(counts).map((t) => [
          t,
          target.get<{ n: number }>(
            "SELECT count(*) n FROM migration_map WHERE entity=?",
            t,
          )!.n,
        ]),
      );
      const issueCount = target.get<{ n: number }>(
        "SELECT count(*) n FROM migration_issues",
      )!.n;
      const issues = target.all<{
        entity: string;
        legacy_id: string;
        reason: string;
      }>("SELECT * FROM migration_issues ORDER BY entity,legacy_id LIMIT 500");
      const failedJobs = target.all<{ id: string; error: string }>(
        "SELECT id,error FROM jobs WHERE kind='library.convert' AND state='failed' ORDER BY id LIMIT 500",
      );
      const failedJobCount = target.get<{ n: number }>(
        "SELECT count(*) n FROM jobs WHERE kind='library.convert' AND state='failed'",
      )!.n;
      if (command === "verify") {
        await verifyRows(
          source,
          target,
          counts,
          migrated,
          issueCount,
          failedJobCount,
          options,
        );
      } else if (command === "report" || command === "run") {
        await report(
          command,
          options,
          counts,
          migrated,
          issueCount,
          issues,
          failedJobCount,
          failedJobs,
          source.schema(),
        );
      }
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
}
