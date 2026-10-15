import { AppError } from "@talos/base";
import { CHAT_IMAGE_LIMIT, contract } from "@talos/contract";
import { onlineCall } from "./commands.ts";
import type { MediaPort, ImageSource } from "./ports.ts";
export async function uploadImage(
  runtime: MediaPort,
  conversation: string,
  file: ImageSource,
  progress: (value: number) => void,
  replyTo?: string,
): Promise<void> {
  if (file.size > CHAT_IMAGE_LIMIT)
    throw new AppError("E_TOO_LARGE", "图片不能超过 12 MiB");
  const bytes = await file.read();
  const upload = await onlineCall(runtime, contract.upload.begin, {
    kind: "image",
    size: bytes.length,
  });
  try {
    for (let offset = upload.offset; offset < bytes.length;) {
      const chunk = bytes.subarray(offset, offset + 256 * 1024);
      await runtime.command(
        contract.upload.append,
        { id: upload.id, offset },
        { body: chunk },
      );
      offset += chunk.length;
      progress(offset / bytes.length);
    }
    await onlineCall(runtime, contract.upload.commit, { id: upload.id });
    await onlineCall(runtime, contract.chat.post.image, {
      id: runtime.operation().op,
      conversation,
      upload: upload.id,
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (cause) {
    if (runtime.can(contract.upload.abort).ok)
      await onlineCall(runtime, contract.upload.abort, { id: upload.id }).catch(
        () => undefined,
      );
    throw cause;
  }
}
