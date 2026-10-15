import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createPdfRenderResolver, type PdfRenderProbe } from "./resolve.ts";
const vendorDir = path.resolve("vendor/pdfrender");
it("uses explicit override before the environment and probes only that path", async () => {
  const paths: string[] = [];
  const probe: PdfRenderProbe = async (executable) => {
    paths.push(executable);
    return { ok: true, detail: "ready" };
  };
  const result = await createPdfRenderResolver().diagnose({
    vendorDir,
    platform: "linux",
    override: "/explicit/render",
    env: { TALOS_PDFRENDER: "/env/render" },
    probe,
  });
  expect(paths).toEqual(["/explicit/render"]);
  expect(result.selected.flavor).toBe("override");
  expect(result.selected.executable).toBe("/explicit/render");
});
it("uses the environment override", async () => {
  const result = await createPdfRenderResolver().resolve({
    vendorDir,
    platform: "linux",
    env: { TALOS_PDFRENDER: "/env/render" },
    probe: async () => ({ ok: true, detail: "ready" }),
  });
  expect(result.executable).toBe("/env/render");
});
it("selects Fedora directly without probing Debian", async () => {
  const result = await createPdfRenderResolver().diagnose({
    vendorDir,
    platform: "linux",
    env: {},
    osRelease: "ID=fedora",
    probe: async (file) => ({
      ok: file.includes("redhat"),
      detail: file.includes("debian") ? "missing libjpeg.so.8" : "ready",
    }),
  });
  expect(result.selected.flavor).toBe("linux-redhat");
  expect(result.flavors.map((item) => [item.flavor, item.detail])).toEqual([
    ["linux-redhat", "ready"],
  ]);
});
it("reports the selected target, binary and actionable missing-library error", async () => {
  await expect(
    createPdfRenderResolver().resolve({
      vendorDir,
      platform: "linux",
      env: {},
      osRelease: "ID=fedora",
      probe: async () => ({ ok: false, detail: "missing libfoo.so.1" }),
    }),
  ).rejects.toMatchObject({
    code: "E_UNAVAILABLE",
    message: expect.stringContaining("missing libfoo.so.1. Install"),
  });
});
it("caches a probe for repeated and concurrent resolution", async () => {
  let calls = 0;
  const resolver = createPdfRenderResolver();
  const options = {
    vendorDir,
    platform: "linux" as const,
    env: {},
    probe: async () => {
      calls++;
      return { ok: true, detail: "ready" };
    },
  };
  await Promise.all([resolver.resolve(options), resolver.diagnose(options)]);
  await resolver.resolve(options);
  expect(calls).toBe(1);
});
it("uses the Windows executable directory", async () => {
  const result = await createPdfRenderResolver().resolve({
    vendorDir,
    platform: "win32",
    env: {},
    probe: async () => ({ ok: true, detail: "ready" }),
  });
  expect(result.flavor).toBe("win32-x64");
  expect(result.executable).toBe(
    path.join(vendorDir, "windows", "pdfrender.exe"),
  );
});

it("uses the packaged target over the host distro and never falls back", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "renderer-target-"));
  try {
    await writeFile(path.join(dir, "target"), "linux-debian-x64\n");
    const paths: string[] = [];
    await expect(
      createPdfRenderResolver().resolve({
        vendorDir: dir,
        platform: "linux",
        env: {},
        osRelease: "ID=fedora",
        probe: async (file) => {
          paths.push(file);
          return { ok: false, detail: "missing libjpeg.so.8" };
        },
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ target: "linux-debian-x64" }),
    });
    expect(paths).toEqual([path.join(dir, "linux-debian", "pdfrender")]);
    await writeFile(path.join(dir, "target"), "linux-x64");
    await expect(
      createPdfRenderResolver().resolve({
        vendorDir: dir,
        platform: "linux",
        env: {},
      }),
    ).rejects.toThrow("Invalid pdfrender target");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
