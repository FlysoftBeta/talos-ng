import {
  ai,
  aiDraftSchema,
  aiConversationSchema,
  aiMessageSchema,
} from "@talos/contract";
import { lwwMerge } from "@talos/sync";
import { defineClientModule } from "../../core/data/modules.ts";
export const aiModule = defineClientModule({
  id: "ai",
  rowTypes: ["aiConversation", "aiMessage", "aiDraft", "aiCredit"],
  windowed: {
    aiMessage: {
      seqOf: (row: { data: unknown }) => aiMessageSchema.parse(row.data).seq,
    },
  },
  reducers: {
    "ai.text.put": (rows) => rows,
    "ai.draft.set": (rows, args, { user }) => {
      const a = ai.draft.set.args.parse(args),
        prior = rows.find(
          (r) =>
            r.scope === `me:${user}` && r.type === "aiDraft" && r.id === a.id,
        ),
        old = aiDraftSchema.safeParse(prior?.data);
      if (old.success && lwwMerge(old.data.value, a.value) === old.data.value)
        return rows;
      return [
        ...rows.filter((r) => r !== prior),
        {
          scope: `me:${user}`,
          type: "aiDraft",
          id: a.id,
          rev: prior?.rev ?? 0,
          deleted: false,
          data: {
            ...a,
            value: old.success ? lwwMerge(old.data.value, a.value) : a.value,
          },
        },
      ];
    },
    "ai.conversation.read": (rows, args) => {
      const a = ai.conversation.read.args.parse(args);
      return rows.map((r) => {
        if (r.type !== "aiConversation" || r.id !== a.id) return r;
        const c = aiConversationSchema.parse(r.data);
        return {
          ...r,
          data: {
            ...c,
            readSeq: Math.max(c.readSeq, Math.min(a.seq, c.lastSeq)),
          },
        };
      });
    },
  },
  repositories: {
    rows: (rows) => rows.filter((r) => r.type.startsWith("ai") && !r.deleted),
  },
});
