import { closeSync, openSync, writeSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Unzip, UnzipInflate } from "fflate";
export interface TreeEntry {
  id: string;
  path: string;
  mime: string;
  size: number;
  sha256: string;
}
export interface ExtractedTreeFile extends TreeEntry {
  temporary: string;
}
export function validTreePath(path: string): boolean {
  return (
    !!path &&
    path.length <= 1024 &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    !/[\u0000-\u001f]/.test(path) &&
    path.split("/").length <= 16 &&
    path
      .split("/")
      .every((segment) => !!segment && segment !== "." && segment !== "..")
  );
}
export async function extractTreeZip(
  archive: string,
  temporary: string,
): Promise<ExtractedTreeFile[]> {
  let failure: Error | undefined;
  let entries: Map<string, TreeEntry> | undefined;
  const extracted: ExtractedTreeFile[] = [];
  const unzip = new Unzip((file) => {
    if (failure) return;
    if (file.name === "manifest.json") {
      const chunks: Uint8Array[] = [];
      let length = 0;
      file.ondata = (error, data, final) => {
        if (error) {
          failure = error;
          return;
        }
        length += data.length;
        if (length > 2 * 1024 * 1024) {
          failure = new Error("workspace manifest too large");
          return;
        }
        chunks.push(data);
        if (final) {
          try {
            const manifest = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(chunks),
              ),
            ) as { format: string; version: number; entries: TreeEntry[] };
            if (
              manifest.format !== "classapp-object-tree" ||
              manifest.version !== 1 ||
              !Array.isArray(manifest.entries) ||
              manifest.entries.length > 256
            )
              throw new Error("invalid workspace manifest");
            let bytes = 0;
            entries = new Map();
            for (const entry of manifest.entries) {
              if (
                !/^[a-f0-9-]{36}$/i.test(entry.id) ||
                !validTreePath(entry.path) ||
                !entry.mime ||
                !Number.isSafeInteger(entry.size) ||
                entry.size < 0 ||
                !/^[a-f0-9]{64}$/.test(entry.sha256) ||
                entries.has(entry.id)
              )
                throw new Error("invalid workspace entry");
              entries.set(entry.id, entry);
              bytes += entry.size;
            }
            if (bytes > 10 * 1024 * 1024)
              throw new Error("workspace exceeds target 10 MiB limit");
          } catch (error) {
            failure = error instanceof Error ? error : new Error(String(error));
          }
        }
      };
      file.start();
      return;
    }
    if (file.name.endsWith("/")) {
      file.ondata = () => {};
      file.start();
      return;
    }
    const entry = file.name.startsWith("objects/")
      ? entries?.get(file.name.slice(8))
      : undefined;
    if (!entry) {
      failure = new Error("unexpected workspace ZIP entry");
      return;
    }
    const destination = join(temporary, entry.id);
    let handle: number;
    try {
      handle = openSync(destination, "wx");
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      return;
    }
    const hash = createHash("sha256");
    let size = 0;
    let closed = false;
    const close = () => {
      if (!closed) {
        closeSync(handle);
        closed = true;
      }
    };
    file.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        close();
        return;
      }
      if (failure) {
        close();
        return;
      }
      try {
        size += data.length;
        if (size > entry.size)
          throw new Error("workspace file exceeds declared size");
        hash.update(data);
        let offset = 0;
        while (offset < data.length)
          offset += writeSync(handle, data, offset, data.length - offset);
        if (final) {
          close();
          if (size !== entry.size || hash.digest("hex") !== entry.sha256)
            throw new Error("workspace file hash/size mismatch");
          extracted.push({ ...entry, temporary: destination });
        }
      } catch (cause) {
        close();
        failure = cause instanceof Error ? cause : new Error(String(cause));
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of createReadStream(archive, {
    highWaterMark: 64 * 1024,
  })) {
    if (failure) break;
    unzip.push(chunk as Uint8Array, false);
  }
  if (!failure) unzip.push(new Uint8Array(), true);
  if (failure) throw failure;
  if (!entries || extracted.length !== entries.size)
    throw new Error("workspace ZIP missing files");
  return extracted;
}
