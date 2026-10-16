import { defineClientModule } from "../../core/data/modules.ts";
import { applySettingSet } from "./model/setting-reducer.ts";

export const settingsModule = defineClientModule({
  id: "settings",
  operationTitles: { "me.setting.set": "更新个人设置" },
  orderKey: (_method, args) =>
    String((args as { key?: unknown } | null)?.key ?? ""),
  rowTypes: ["setting"],
  reducers: { "me.setting.set": applySettingSet },
  repositories: {
    settings: (rows) =>
      rows.filter((row) => row.type === "setting" && !row.deleted),
  },
});
