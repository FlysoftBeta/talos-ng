import { defineClientModule } from "../../core/data/modules.ts";
export const authModule = defineClientModule({
  id: "auth",
  rowTypes: ["profile", "grant"],
  reducers: {},
  repositories: {
    profile: (rows) =>
      rows.filter((row) => row.type === "profile" && !row.deleted),
  },
});
