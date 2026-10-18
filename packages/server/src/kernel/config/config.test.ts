import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { parseStartMessage, readInstallLayout } from "@talos/launcher";
import { parseConfig, loadSettings, serverConfig } from "./config.ts";

const placement = {
  dataDir: join(tmpdir(), "talos-data"),
  logsDir: join(tmpdir(), "talos-logs"),
  tmpDir: join(tmpdir(), "talos-tmp"),
  assetsDir: join(tmpdir(), "talos-assets"),
};

it("settings defaults and HTTPS validation", () => {
  expect(parseConfig({ ...placement }).ports).toEqual([8080]);
  expect(() => parseConfig({ ...placement, ports: [-1] })).toThrow();
  expect(() => parseConfig({ ...placement, securePorts: [443] })).toThrow();
  expect(() => parseConfig({ ...placement, ports: [8080, 8080] })).toThrow();
  expect(() =>
    parseConfig({
      ...placement,
      https: { cert: "a", key: "secret", redirect: true },
    }),
  ).toThrow();
});

it("lays out an install from the config directory, resolving every path against the working directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "talos-config-"));
  try {
    const config = join(root, "config");
    const layout = await readInstallLayout("config", root);
    // A missing config.json means defaults.
    expect(layout).toEqual({
      configDir: config,
      configFile: join(config, "config.json"),
      modelFile: join(config, "model.json"),
      dataDir: join(root, "data"),
      logsDir: join(root, "logs"),
      tmpDir: join(root, "tmp"),
      versionsDir: join(root, "versions"),
    });
    await expect(loadSettings(layout, root)).resolves.toMatchObject({
      ports: [8080],
    });
    await mkdir(config);
    await writeFile(
      layout.configFile,
      JSON.stringify({
        ports: [123],
        securePorts: [8443],
        dataDir: "./store",
        tmpDir: "/var/tmp/talos",
        https: { cert: "certs/cert.pem", key: "certs/key.pem", ca: "ca.pem" },
      }),
    );
    const moved = await readInstallLayout(config, root);
    expect(moved).toMatchObject({
      dataDir: join(root, "store"),
      logsDir: join(root, "logs"),
      tmpDir: "/var/tmp/talos",
      versionsDir: join(root, "versions"),
    });
    const settings = await loadSettings(moved, root);
    expect(settings.ports).toEqual([123]);
    expect(settings.https).toMatchObject({
      cert: join(root, "certs/cert.pem"),
      key: join(root, "certs/key.pem"),
      ca: join(root, "ca.pem"),
    });
    const full = await serverConfig(moved, { assetsDir: placement.assetsDir });
    expect(full).toMatchObject({
      dataDir: join(root, "store"),
      tmpDir: "/var/tmp/talos",
      modelFile: join(config, "model.json"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects wiring, removed and unknown keys in config.json by name", async () => {
  const root = await mkdtemp(join(tmpdir(), "talos-config-"));
  try {
    const layout = await readInstallLayout("config", root);
    await mkdir(layout.configDir);
    for (const [key, name] of [
      [{ dev: true }, "dev"],
      [{ aiModelsFile: "ai.json" }, "aiModelsFile"],
      [{ dbReaders: 2 }, "dbReaders"],
    ] as const) {
      await writeFile(layout.configFile, JSON.stringify(key));
      await expect(loadSettings(layout)).rejects.toThrow(name);
    }
    await writeFile(layout.configFile, JSON.stringify({ dataDir: "" }));
    await expect(readInstallLayout("config", root)).rejects.toThrow("dataDir");
    await writeFile(layout.configFile, "secret invalid json");
    await expect(readInstallLayout("config", root)).rejects.toThrow(
      "不是有效的 JSON",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("validates the parent's start message and the dev-only test seed", () => {
  const config = {
    configDir: join(tmpdir(), "config"),
    assetsDir: placement.assetsDir,
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
      config: { ...config, configDir: "relative" },
    }),
  ).toThrow();
  // Placement is the operator's (config.json), never the parent's.
  expect(() =>
    parseStartMessage({
      type: "start",
      config: { ...config, dataDir: placement.dataDir },
    }),
  ).toThrow();
  expect(() => parseConfig({ ...placement, testSeed: true })).toThrow();
  expect(
    parseConfig({ ...placement, dev: true, testSeed: true }).testSeed,
  ).toBe(true);
});
