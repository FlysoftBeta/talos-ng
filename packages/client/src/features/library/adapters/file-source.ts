import { AppError } from "@talos/base";
import type { ImportSource } from "../model/import.ts";

function readSlice(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () =>
      reject(new AppError("E_UNAVAILABLE", "文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
}
/** Presents a selected browser file as sliceable bytes. */
export function fileSource(file: File): ImportSource {
  return {
    name: file.name,
    size: file.size,
    read: (start, end) => readSlice(file.slice(start, end)),
  };
}
