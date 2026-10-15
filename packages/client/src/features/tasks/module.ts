import { defineClientModule } from "../../core/data/modules.ts";
export const tasksModule = defineClientModule({
  id: "tasks",
  rowTypes: ["job"],
  reducers: {},
  repositories: {
    jobs: (rows) => rows.filter((row) => row.type === "job" && !row.deleted),
  },
});
