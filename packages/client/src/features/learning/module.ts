import {
  applyLearningAnswer,
  contract,
  emptyLearningProgress,
  learningProgressSchema,
} from "@talos/contract";
import { defineClientModule } from "../../core/data/modules.ts";
export const learningModule = defineClientModule({
  id: "learning",
  scopeLabels: { learn: { title: "学习资料" } },
  rowTypes: ["learningCorpus", "learningProgress"],
  reducers: {
    "learning.answer.record": (rows, args, { user }) => {
      const parsed = contract.learning.answer.record.args.safeParse(args);
      if (!parsed.success) return rows;
      const input = parsed.data,
        scope = `me:${user}`;
      const previous = rows.find(
        (r) =>
          r.scope === scope &&
          r.type === "learningProgress" &&
          r.id === input.word,
      );
      const value = learningProgressSchema.safeParse(previous?.data);
      const data = applyLearningAnswer(
        value.success ? value.data : emptyLearningProgress(input.word),
        input,
      );
      return [
        ...rows.filter((r) => r !== previous),
        {
          scope,
          type: "learningProgress",
          id: input.word,
          rev: previous?.rev ?? 0,
          deleted: false,
          data,
        },
      ];
    },
  },
  repositories: {
    data: (rows) =>
      rows.filter(
        (r) =>
          !r.deleted &&
          (r.type === "learningCorpus" || r.type === "learningProgress"),
      ),
  },
});
