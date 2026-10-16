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
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permissions can reject even when the secure-context API is present.
    }
  }
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand("copy"))
      throw new Error("Clipboard copy was rejected");
  } catch {
    throw new AppError("E_UNAVAILABLE", "无法复制，请选中文字后手动复制");
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus();
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
