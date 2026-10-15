import { AppError } from "@talos/base";
import type { AiImageFiles } from "../model/commands.ts";

/** Browser file reading and object URLs for picked chat images. */
export const browserImageFiles: AiImageFiles<File> = {
  read: (file) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(new AppError("E_INVALID", "无法读取图片"));
      reader.readAsArrayBuffer(file);
    }),
  preview: (file) => URL.createObjectURL(file),
  revoke: (url) => URL.revokeObjectURL(url),
};
