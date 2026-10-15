export const dateTimeText = (stamp: number): string =>
  new Date(stamp).toLocaleString("zh-CN");
export const dateText = (stamp: number): string =>
  new Date(stamp).toLocaleDateString("zh-CN");
export const mebibytes = (bytes: number): string =>
  `${(bytes / 1048576).toFixed(1)} MiB`;
export const kibibytes = (bytes: number): string =>
  `${(bytes / 1024).toFixed(0)} KiB`;
