import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { parseConfig, loadConfig, dataLayout } from "./config.ts";
it("config defaults and HTTPS validation", () => {
  expect(parseConfig({}).ports).toEqual([8080]);
  expect(() => parseConfig({ ports: [-1] })).toThrow();
  expect(() => parseConfig({ securePorts: [443] })).toThrow();
  expect(() => parseConfig({ ports: [8080, 8080] })).toThrow();
  expect(() =>
    parseConfig({ https: { cert: "a", key: "secret", redirect: true } }),
  ).toThrow();
});
it("loads file plus env overrides relative to the config file and rejects malformed values safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talos-config-"));
  try {
    const file = join(dir, "talos.config.json");
    await writeFile(file, JSON.stringify({ ports: [123], dataDir: "data" }));
    const result = await loadConfig(file, {
      TALOS_PORTS: "[456]",
      TALOS_DEV: "true",
    });
    expect(result.ports).toEqual([456]);
    expect(result.dev).toBe(true);
    expect(result.dataDir).toBe(join(dir, "data"));
    expect(dataLayout(result.dataDir).db).toBe(join(dir, "data", "talos.db"));
    await expect(
      loadConfig(file, { TALOS_PORTS: "secret" }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    await writeFile(file, "secret invalid json");
    await expect(loadConfig(file, {})).rejects.toThrow("无法读取服务器配置");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each([
  ["18573", [18573]],
  ["8080,8443", [8080, 8443]],
  [" 8080, 8443 ", [8080, 8443]],
  ["0", [0]],
  ["[]", []],
])("parses port override %s", async (value, expected) => {
  const config = await loadConfig(join(tmpdir(), "talos-missing-config.json"), {
    TALOS_PORTS: value as string,
  });
  expect(config.ports).toEqual(expected);
});
it.each([
  "",
  "8080,",
  ",8080",
  "8080.5",
  "1e3",
  "-1",
  "65536",
  "8080,8080",
  "null",
  "true",
  '["8080"]',
])("rejects port override %s", async (value) => {
  await expect(
    loadConfig(join(tmpdir(), "talos-missing-config.json"), {
      TALOS_PORTS: value,
    }),
  ).rejects.toMatchObject({ code: "E_INVALID" });
});
it("requires explicit dev mode for the deterministic test seed", async () => {
  expect(() => parseConfig({ testSeed: true })).toThrow();
  const config = await loadConfig(join(tmpdir(), "talos-missing-config.json"), {
    TALOS_DEV: "true",
    TALOS_TEST_SEED: "true",
    TALOS_WORKER_FILE: "sw.js",
    TALOS_SECURE_PORTS: "8443,9443",
    TALOS_HTTPS_CERT: "cert.pem",
    TALOS_HTTPS_KEY: "key.pem",
  });
  expect(config.testSeed).toBe(true);
  expect(config.workerFile).toBe(join(tmpdir(), "sw.js"));
  expect(config.securePorts).toEqual([8443, 9443]);
});
