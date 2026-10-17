import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { parseStartMessage } from "@talos/launcher";
import { parseConfig, loadSettings, dataLayout } from "./config.ts";

const wiring = {
  dataDir: join(tmpdir(), "talos-data"),
  assetsDir: join(tmpdir(), "talos-assets"),
};

it("settings defaults and HTTPS validation", () => {
  expect(parseConfig({ ...wiring }).ports).toEqual([8080]);
  expect(() => parseConfig({ ...wiring, ports: [-1] })).toThrow();
  expect(() => parseConfig({ ...wiring, securePorts: [443] })).toThrow();
  expect(() => parseConfig({ ...wiring, ports: [8080, 8080] })).toThrow();
  expect(() =>
    parseConfig({
      ...wiring,
      https: { cert: "a", key: "secret", redirect: true },
    }),
  ).toThrow();
});

it("loads operator settings relative to the file and rejects malformed or unknown keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talos-config-"));
  try {
    const file = join(dir, "talos.config.json");
    await expect(loadSettings(file)).resolves.toMatchObject({ ports: [8080] });
    await writeFile(
      file,
      JSON.stringify({
        ports: [123],
        securePorts: [8443],
        aiModelsFile: "ai.json",
        https: { cert: "cert.pem", key: "key.pem", ca: "ca.pem" },
      }),
    );
    const settings = await loadSettings(file);
    expect(settings.ports).toEqual([123]);
    expect(settings.aiModelsFile).toBe(join(dir, "ai.json"));
    expect(settings.https).toMatchObject({
      cert: join(dir, "cert.pem"),
      key: join(dir, "key.pem"),
      ca: join(dir, "ca.pem"),
    });
    expect(dataLayout(wiring.dataDir).db).toBe(
      join(wiring.dataDir, "talos.db"),
    );
    // Process wiring is not operator configuration.
    for (const key of [{ dev: true }, { dataDir: "data" }, { dbReaders: 2 }]) {
      await writeFile(file, JSON.stringify(key));
      await expect(loadSettings(file)).rejects.toMatchObject({
        code: "E_INVALID",
      });
    }
    await writeFile(file, "secret invalid json");
    await expect(loadSettings(file)).rejects.toThrow("无法读取服务器配置");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("validates the parent's start message and the dev-only test seed", () => {
  const config = {
    ...wiring,
    settingsFile: join(tmpdir(), "talos.config.json"),
  };
  const parsed = parseStartMessage({ type: "start", config });
  expect(parsed).toMatchObject({
    dev: false,
    testSeed: false,
    printRootPin: true,
  });
  expect(() => parseStartMessage({ type: "stop", config })).toThrow();
  expect(() =>
    parseStartMessage({ type: "start", config: { ...config, testSeed: true } }),
  ).toThrow("启动消息无效");
  expect(() =>
    parseStartMessage({
      type: "start",
      config: { ...config, dataDir: "relative" },
    }),
  ).toThrow();
  expect(() =>
    parseStartMessage({ type: "start", config: { ...config, extra: 1 } }),
  ).toThrow();
  expect(() => parseConfig({ ...wiring, testSeed: true })).toThrow();
  expect(parseConfig({ ...wiring, dev: true, testSeed: true }).testSeed).toBe(
    true,
  );
});
