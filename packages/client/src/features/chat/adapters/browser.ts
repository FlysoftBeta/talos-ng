import { AppError } from "@talos/base";
import type { ImageSource } from "../model/ports.ts";
export function imageSource(file: File): ImageSource {
  return {
    size: file.size,
    read: () =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          reader.result instanceof ArrayBuffer
            ? resolve(new Uint8Array(reader.result))
            : reject(new AppError("E_INVALID", "无法读取图片"));
        reader.onerror = () =>
          reject(new AppError("E_UNAVAILABLE", "无法读取图片"));
        reader.readAsArrayBuffer(file);
      }),
  };
}
export const imageUrls = {
  create(bytes: Uint8Array, mime: string): string {
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  },
  release(url: string): void {
    URL.revokeObjectURL(url);
  },
};
export function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}
