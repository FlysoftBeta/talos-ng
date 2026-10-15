const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function chatDay(value: number): string {
  const parts = formatter.formatToParts(new Date(value));
  const find = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${find("year")}-${find("month")}-${find("day")}`;
}
export function dateLabel(value: number, now: number): string {
  const date = chatDay(value);
  const parts = date.split("-");
  return date === chatDay(now)
    ? "今天"
    : date === chatDay(now - 86400000)
      ? "昨天"
      : `${Number(parts[1])}月${Number(parts[2])}日`;
}
const listDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
const listTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function chatListTime(value: number, now: number): string {
  const parts = (stamp: number): string[] =>
    listDate
      .formatToParts(new Date(stamp))
      .filter(
        (part) =>
          part.type === "year" || part.type === "month" || part.type === "day",
      )
      .map((part) => part.value);
  const date = parts(value).join("/");
  if (date === parts(now).join("/")) return listTime.format(new Date(value));
  if (date === parts(now - 86_400_000).join("/")) return "昨天";
  const [month, day] = parts(value);
  return `${month}/${day}`;
}
