import { join } from "node:path";
import { AppError } from "@talos/base";

export function legacyBlobPath(root: string, blobId: string): string {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      blobId,
    )
  )
    throw new AppError("E_INVALID", "Invalid legacy blob ID");
  const compact = blobId.replaceAll("-", "").toLowerCase();
  return join(
    root,
    compact.slice(0, 2),
    compact.slice(2, 4),
    blobId.toLowerCase(),
  );
}
