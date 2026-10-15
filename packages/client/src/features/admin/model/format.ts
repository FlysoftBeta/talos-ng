/** Administrator-facing timestamp in the local zone. */
export function localDate(value: number): string {
  return new Date(value).toLocaleString("zh-CN");
}
/** Administrator-facing timestamp in the product's reference zone. */
export function shanghaiDate(value: number): string {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}
