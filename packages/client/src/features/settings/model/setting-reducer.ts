import { contract } from "@talos/contract";
import type { JsonValue } from "@talos/contract";
import { lwwMerge } from "@talos/sync";
import type { Lww } from "@talos/sync";
import type { StoredRow } from "../../../core/data/db.ts";

/** Optimistic `me.setting.set`: last-writer-wins merge into the user's own setting row. */
export function applySettingSet(
  rows: readonly StoredRow[],
  args: unknown,
  { user }: { user: string },
): readonly StoredRow[] {
  const parsed = contract.me.setting.set.args.safeParse(args);
  if (!parsed.success) return rows;
  const input = parsed.data;
  const scope = `me:${user}`;
  const previous = rows.find(
    (row) =>
      row.scope === scope && row.type === "setting" && row.id === input.key,
  );
  const data = previous?.data as { value: Lww<JsonValue> } | undefined;
  const value = data ? lwwMerge(data.value, input.value) : input.value;
  return [
    ...rows.filter((row) => row !== previous),
    {
      scope,
      type: "setting",
      id: input.key,
      rev: previous?.rev ?? 0,
      deleted: false,
      data: { id: input.key, key: input.key, value },
    },
  ];
}
