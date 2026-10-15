import {
  applyLibraryProgress,
  contract,
  emptyLibraryState,
  libraryStateSchema,
} from "@talos/contract";
import { lwwMerge } from "@talos/sync";
import { defineClientModule } from "../../core/data/modules.ts";
import type { ClientModule } from "../../core/data/modules.ts";
import type { StoredRow } from "../../core/data/db.ts";

type Reducer = ClientModule["reducers"][string];
const reduce =
  (kind: "favourite" | "retention" | "progress"): Reducer =>
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
    } else {
      const { value } = contract.library.retention.set.args.parse(args);
      data = {
        ...data,
        retention: data.retention ? lwwMerge(data.retention, value) : value,
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
    return [...rows.filter((row) => row !== previous), row];
  };
export const libraryModule = defineClientModule({
  id: "library",
  rowTypes: ["libraryDoc", "libraryCollection", "libraryState"],
  reducers: {
    "library.favourite.set": reduce("favourite"),
    "library.retention.set": reduce("retention"),
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
            "grant",
            "communityConversation",
          ].includes(row.type),
      ),
  },
});
