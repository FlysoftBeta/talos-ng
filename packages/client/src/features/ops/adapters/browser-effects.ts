import type { DownloadPort } from "../model/port.ts";

/** Starts a download from a server-issued ticket URL. */
export const browserDownloads: DownloadPort = {
  download(url) {
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  },
};

/** Reads a chosen file in slices through FileReader (Chrome 70); nothing is persisted. */
export function fileSource(file: File) {
  return {
    size: file.size,
    slice: (start: number, end: number): Promise<Uint8Array> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("无法读取文件"));
        reader.onload = () =>
          resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.readAsArrayBuffer(file.slice(start, end));
      }),
  };
}
