// @vitest-environment node
import { describe, expect, it } from "vitest";
import { build } from "vite";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { annotateZodBigInt, zodTreeShake } from "./zod-treeshake.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
async function bundle(entrySource) {
  const entry = path.join(root, "src/main.tsx");
  const output = await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [
      zodTreeShake(),
      {
        name: "test-entry",
        load(id) {
          if (id === entry) return entrySource;
        },
      },
    ],
    build: {
      write: false,
      target: ["chrome70", "es2018"],
      minify: true,
      lib: { entry, formats: ["iife"], name: "test" },
    },
  });
  const result = (Array.isArray(output) ? output[0] : output).output.find(
    (item) => item.type === "chunk",
  );
  if (!result || result.type !== "chunk")
    throw new Error("Missing test bundle");
  return result.code;
}
describe("Zod browser tree shaking", () => {
  it("fails closed if the pinned declaration shape changes", () => {
    expect(() => annotateZodBigInt("export class Other {};")).toThrow(
      "declaration changed",
    );
  });
  it("removes only unused BigInt implementation while preserving contract validation", async () => {
    const code = await bundle(
      'import { contract } from "@talos/contract"; globalThis.result = [contract.auth.login.args.safeParse({pin:"123456"}).success, contract.auth.login.args.safeParse({pin:"wrong"}).success, contract.auth.login.args.safeParse({pin:"123456",extra:1}).success, contract.me.setting.set.offline];',
    );
    expect(code).not.toMatch(/\bBigInt\s*\(/);
    const context = { result: undefined };
    runInNewContext(code, context);
    expect(context.result).toEqual([true, false, false, "queue"]);
  });
  it("retains native BigInt calls when a schema actually requests them", async () => {
    const code = await bundle(
      'import { z } from "@talos/contract"; globalThis.result = z.bigint().safeParse(1).success;',
    );
    expect(code).toMatch(/\bBigInt\s*\(/);
    const context = { result: undefined };
    runInNewContext(code, context);
    expect(context.result).toBe(false);
  });
});
