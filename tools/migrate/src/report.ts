import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Options } from "./types.ts";
export async function report(
  command: string,
  options: Options,
  counts: Record<string, number>,
  migrated: Record<string, number>,
  issueCount: number,
  issues: { entity: string; legacy_id: string; reason: string }[],
  failedJobCount: number,
  failedJobs: { id: string; error: string }[],
  schema: { version: string | null; compatibilityViews: string[] },
): Promise<void> {
  const lines = [
    "# Migration report",
    "",
    `Source schema: ${schema.version ?? "unversioned"}.`,
    `Read-only compatibility views: ${schema.compatibilityViews.join(", ") || "none"}. View counts describe the adapted entities, not additional source rows.`,
    "",
    "Journaled counts include rows with recorded errors; review every issue before cutover.",
    "",
    "| Legacy table | Rows | Journaled |",
    "|---|---:|---:|",
    ...Object.keys(counts).map(
      (t) => `| ${t} | ${counts[t]} | ${migrated[t]} |`,
    ),
    "",
    "## Losses and failures",
    "",
    `Recorded row issues: ${issueCount}. Showing the first ${issues.length}.`,
    ...issues.map((i) => `- ${i.entity}/${i.legacy_id}: ${i.reason}`),
    `Failed document conversions: ${failedJobCount}. Showing the first ${failedJobs.length}.`,
    ...failedJobs.map((job) => `- library.convert/${job.id}: ${job.error}`),
    "",
    "## Deliberate exclusions and lossy mappings",
    "",
    "- Audit logs and incidents are operational diagnostics; they were not migrated. Keep the legacy backup for history.",
    "- Old conversation_read_marks are obsolete snapshots; convs_user supplies current read state. users.is_ghost and Android/SQLite metadata are not target account state. Old eviction/quota bookkeeping and unpublished upload paths are excluded.",
    "- Pre-v27 bookmarks, article group links and media-list owners are adapted through read-only views. Queue owner bindings become personal user_queues state, not collection grants.",
    "- Media tracks, playlists, queue and favourites use real media tables. Audio hashes/sizes are verified; covers are preserved in the ledger because target tracks have no cover field.",
    "- AI workspace ZIPs and each valid file are retained in the objects ledger; files enter ai_files and message image paths are remapped. Active reservations settle to zero with a release note; top-up balances stay exact.",
    "- Legacy read offset maps to unit 0; page-aware positions are unavailable. Legacy text-only posts retain their full body but only a 1,000-character preview syncs.",
    "- F-055/F-092 grants retain read/write/own and delegation. Mixed shareable-read/non-shareable-write becomes non-delegable write. Ownerless collections receive an explicit fallback owner. F-144 bearer tokens are discarded: current readable collection access replaces possession recovery.",
    "- Downloaded network novels are ordinary text articles, migrated as library documents; provider/download checkpoints are not resumed.",
    "- Image thumbnails are regenerated as JPEG; legacy thumbnail bytes are not reused.",
    "- Legacy text/PDF source files are queued for docpipe conversion. Check job failures after server boot.",
  ];
  const report = lines.join("\n") + "\n";
  if (command === "report") process.stdout.write(report);
  else {
    await writeFile(join(options.target, "migration-report.md"), report);
    process.stdout.write(
      `Wrote ${join(options.target, "migration-report.md")}\n`,
    );
  }
}
