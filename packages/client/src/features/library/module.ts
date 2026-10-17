import {
  applyLibraryProgress,
  contract,
  emptyLibraryState,
  libraryStateSchema,
  libraryCollectionSchema,
  libraryRetentionEntitySchema,
} from "@talos/contract";
import type { LibraryRetention } from "@talos/contract";
import { lwwMerge } from "@talos/sync";
import { defineClientModule } from "../../core/data/modules.ts";
import type { ClientModule } from "../../core/data/modules.ts";
import type { StoredRow } from "../../core/data/db.ts";

type Reducer = ClientModule["reducers"][string];
const reduce =
  (kind: "favourite" | "progress"): Reducer =>
  (rows, args, { user }) => {
    const scope = `me:${user}`;
    const method = contract.library[kind].set;
    const parsed = method.args.safeParse(args);
    if (!parsed.success) return rows;
    const input = parsed.data;
    const previous = rows.find(
      (row) =>
        row.scope === scope &&
        row.type === "libraryState" &&
        row.id === input.doc,
    );
    const existing = libraryStateSchema.safeParse(previous?.data);
    let data = existing.success ? existing.data : emptyLibraryState(input.doc);
    if (kind === "progress") {
      const value = contract.library.progress.set.args.parse(args);
      data = applyLibraryProgress(data, value);
    } else if (kind === "favourite") {
      const { value } = contract.library.favourite.set.args.parse(args);
      data = {
        ...data,
        favourite: data.favourite ? lwwMerge(data.favourite, value) : value,
      };
    }
    const row: StoredRow = {
      scope,
      type: "libraryState",
      id: input.doc,
      rev: previous?.rev ?? 0,
      deleted: false,
      data,
    };
    const next = rows
      .filter((row) => row !== previous)
      .map((row) => {
        if (
          kind !== "favourite" ||
          row.type !== "libraryCollection" ||
          row.deleted
        )
          return row;
        const parsed = libraryCollectionSchema.safeParse(row.data);
        if (
          !parsed.success ||
          parsed.data.owner !== user ||
          parsed.data.builtin !== "favourites"
        )
          return row;
        const included = !!data.favourite?.v;
        if (parsed.data.docs.includes(input.doc) === included) return row;
        const docs = included
          ? [...parsed.data.docs, input.doc]
          : parsed.data.docs.filter((id) => id !== input.doc);
        return { ...row, data: { ...parsed.data, docs } };
      });
    const result = [...next, row];
    return kind === "progress"
      ? projectRetention(
          result,
          user,
          input.doc,
          "doc",
          undefined,
          data.lastRead,
        )
      : result;
  };
export const libraryModule = defineClientModule({
  id: "library",
  orderKey: (method: string, args: unknown): string => {
    if (!args || typeof args !== "object") return "";
    const input = args as Record<string, unknown>;
    if (
      method === "library.retention.set" &&
      (input.kind === "doc" || input.kind === "collection") &&
      typeof input.id === "string"
    )
      return `${input.kind}:${input.id}`;
    if (typeof input.doc === "string") return `doc:${input.doc}`;
    if (typeof input.collection === "string")
      return `collection:${input.collection}`;
    return "";
  },
  registers: {
    "library.progress.set": {
      key: (args) => {
        const value = args as { doc?: string; device?: string } | null;
        return value?.doc && value.device
          ? `${value.doc}:${value.device}`
          : undefined;
      },
      // Resume position is last-writer-wins; furthest and seconds are maxima.
      merge: (earlier, later) => {
        const a = contract.library.progress.set.args.parse(earlier),
          b = contract.library.progress.set.args.parse(later);
        return {
          ...b,
          resume: lwwMerge(a.resume, b.resume),
          furthest: Math.max(a.furthest, b.furthest),
          seconds: Math.max(a.seconds, b.seconds),
        };
      },
      debounceMs: () => 3000,
    },
  },
  rowTypes: [
    "libraryDoc",
    "libraryCollection",
    "libraryState",
    "libraryRetention",
  ],
  reducers: {
    "library.favourite.set": reduce("favourite"),
    "library.retention.set": (rows, args, { user }) => {
      const parsed = contract.library.retention.set.args.safeParse(args);
      if (!parsed.success) return rows;
      const input = parsed.data;
      return projectRetention(rows, user, input.id, input.kind, input.value);
    },
    "library.collection.recordRead": (rows, args, { user }) => {
      const parsed =
        contract.library.collection.recordRead.args.safeParse(args);
      if (!parsed.success) return rows;
      const input = parsed.data;
      return projectRetention(
        rows,
        user,
        input.collection,
        "collection",
        undefined,
        input.t.ms,
      );
    },
    "library.progress.set": reduce("progress"),
  },
  repositories: {
    data: (rows) =>
      rows.filter(
        (row) =>
          !row.deleted &&
          [
            "libraryDoc",
            "libraryCollection",
            "libraryState",
            "libraryRetention",
            "grant",
            "communityConversation",
          ].includes(row.type),
      ),
  },
});

function projectRetention(
  rows: readonly StoredRow[],
  user: string,
  id: string,
  kind: "doc" | "collection",
  value?: LibraryRetention["value"],
  used = 0,
): StoredRow[] {
  const scope = `me:${user}`;
  const previous = rows.find(
    (row) =>
      row.scope === scope && row.type === "libraryRetention" && row.id === id,
  );
  const parsed = libraryRetentionEntitySchema.safeParse(previous?.data);
  const data = parsed.success
    ? parsed.data
    : { id, kind, value: null, lastUsed: 0 };
  return [
    ...rows.filter((row) => row !== previous),
    {
      scope,
      type: "libraryRetention",
      id,
      rev: previous?.rev ?? 0,
      deleted: false,
      data: {
        ...data,
        value: value
          ? data.value
            ? lwwMerge(data.value, value)
            : value
          : data.value,
        lastUsed: Math.max(data.lastUsed, used),
      },
    },
  ];
}
