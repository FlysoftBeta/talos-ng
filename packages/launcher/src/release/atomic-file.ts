import { mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { retry } from "../filesystem/retry-busy.ts";

export async function atomicFile(
  path: string,
  text: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + ".tmp";
  const file = await open(temp, "w");
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  await retry(() => rename(temp, path));
}
