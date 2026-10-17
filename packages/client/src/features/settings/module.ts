import { lwwMerge } from "@talos/sync";
import type { Lww } from "@talos/sync";
import { defineClientModule } from "../../core/data/modules.ts";
import { applySettingSet } from "./model/setting-reducer.ts";

export const settingsModule = defineClientModule({
  id: "settings",
  scopeLabels: { "me:": { title: "个人数据" } },
  operationTitles: { "me.setting.set": "更新个人设置" },
  orderKey: (_method, args) =>
    String((args as { key?: unknown } | null)?.key ?? ""),
  registers: {
    "me.setting.set": {
      key: (args) => {
        const key = (args as { key?: unknown } | null)?.key;
        return typeof key === "string" ? key : undefined;
      },
      merge: (earlier, later) => {
        const a = earlier as { value: Lww<unknown> };
        const b = later as { value: Lww<unknown> };
        return lwwMerge(a.value, b.value) === a.value ? earlier : later;
      },
    },
  },
  rowTypes: ["setting"],
  reducers: { "me.setting.set": applySettingSet },
  repositories: {
    settings: (rows) =>
      rows.filter((row) => row.type === "setting" && !row.deleted),
  },
});
