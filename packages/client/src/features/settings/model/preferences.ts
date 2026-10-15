import type { RuntimeSettingsPort } from "../../../core/runtime-port.ts";

export type SettingMarkState = "pending" | "failed";
export interface PreferenceRow {
  key: string;
  label: string;
  /** The selected option's value (always a string; see `preferenceValue`). */
  value: string;
  options: readonly { value: string; label: string }[];
  mark: { state: SettingMarkState; label: string } | undefined;
}
export type PreferenceReader = Pick<
  RuntimeSettingsPort,
  "setting" | "settingMark"
>;

const markLabel: Record<SettingMarkState, string> = {
  pending: "待同步",
  failed: "同步失败",
};

/** Stored value ⇄ option value for each preference. */
const definitions = [
  {
    key: "theme",
    label: "主题",
    read: (r: PreferenceReader) => String(r.setting("theme", "system")),
    options: [
      { value: "light", label: "浅色" },
      { value: "dark", label: "深色" },
      { value: "system", label: "跟随系统" },
    ],
    write: (value: string): string | number | boolean => value,
  },
  {
    key: "textSize",
    label: "文字大小",
    read: (r: PreferenceReader) => String(r.setting("textSize", "normal")),
    options: [
      { value: "normal", label: "标准" },
      { value: "large", label: "大字" },
    ],
    write: (value: string): string | number | boolean => value,
  },
  {
    key: "idleLockMinutes",
    label: "自动锁定",
    read: (r: PreferenceReader) => String(r.setting("idleLockMinutes", 5)),
    options: [
      { value: "1", label: "1 分钟" },
      { value: "5", label: "5 分钟" },
      { value: "15", label: "15 分钟" },
      { value: "0", label: "关闭" },
    ],
    write: (value: string): string | number | boolean => Number(value),
  },
  {
    key: "doNotDisturb",
    label: "请勿打扰",
    read: (r: PreferenceReader) =>
      r.setting("doNotDisturb", false) ? "on" : "off",
    options: [
      { value: "on", label: "开启" },
      { value: "off", label: "关闭" },
    ],
    write: (value: string): string | number | boolean => value === "on",
  },
] as const;

export function preferenceRows(reader: PreferenceReader): PreferenceRow[] {
  return definitions.map((d) => {
    const state = reader.settingMark(d.key);
    return {
      key: d.key,
      label: d.label,
      value: d.read(reader),
      options: d.options,
      mark: state && { state, label: markLabel[state] },
    };
  });
}

/** The value written to the synchronized setting for a chosen option. */
export function preferenceValue(
  key: string,
  option: string,
): string | number | boolean {
  const definition = definitions.find((d) => d.key === key);
  if (!definition) throw new Error(`unknown preference ${key}`);
  return definition.write(option);
}
