import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { retry } from "../filesystem/retry-busy.ts";
import { RotatingLog } from "../logging/rotating-log.ts";
import { acquireLock } from "../process/lock.ts";
import { atomicFile } from "./atomic-file.ts";
import { ReleaseFiles } from "./release-files.ts";
it("uses pointer files, refuses a second instance, rotates bounded logs", async () => {
  const root = await mkdtemp(join(tmpdir(), "talos-launcher-"));
  try {
    const unlock = await acquireLock(root);
    await expect(acquireLock(root)).rejects.toMatchObject({ code: "E_BUSY" });
    await unlock();
    await atomicFile(join(root, "current"), "A\n");
    const files = new ReleaseFiles(root);
    expect(await files.read()).toEqual({ current: "A" });
    await files.save({ current: "B" });
    expect(await readFile(join(root, "current"), "utf8")).toBe("B\n");
    const log = new RotatingLog(join(root, "log"), 3);
    await log.write("1234");
    await log.write("next");
    expect(await readFile(join(root, "log.1"), "utf8")).toBe("1234");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("retries Windows busy errors using injectable waits, never retries unrelated errors", async () => {
  let n = 0;
  const waits: number[] = [];
  expect(
    await retry(
      async () => {
        if (n++ < 3) throw Object.assign(new Error(), { code: "EPERM" });
        return 42;
      },
      async (ms) => {
        waits.push(ms);
      },
    ),
  ).toBe(42);
  expect(waits).toEqual([10, 20, 40]);
  await expect(
    retry(
      async () => {
        throw Object.assign(new Error(), { code: "EINVAL" });
      },
      async () => {
        throw new Error("Unexpected wait");
      },
    ),
  ).rejects.toMatchObject({ code: "EINVAL" });
});

it("redacts a first-boot PIN across arbitrary pipe chunks without corrupting CJK", async () => {
  const { ChildLogOutput } = await import("../logging/child-log-output.ts");
  const output: string[] = [];
  const sink = new ChildLogOutput((line) => output.push(line));
  const bytes = Buffer.from("首次启动 PIN: 123456\n中文日志\n");
  for (const byte of bytes) sink.push(Uint8Array.of(byte));
  sink.end();
  expect(output.join("")).toBe("首次启动 PIN: [redacted]\n中文日志\n");
});
