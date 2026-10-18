import { build } from "vite";
import { verifyRelease } from "./release.mjs";
import { zodTreeShake } from "./zod-treeshake.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const git = (args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
export function buildId() {
  const id =
    process.env.TALOS_BUILD_ID ||
    `${git(["rev-parse", "--short", "HEAD"])}${git(["status", "--porcelain"]) ? "-dirty" : ""}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))
    throw new Error("TALOS_BUILD_ID must be a safe path segment");
  return id;
}
const id = buildId();
const dist = path.join(root, "dist");
const outDir = path.join(dist, "app", id);
await rm(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await mkdir(outDir, { recursive: true });
const outputs = {};
for (const name of ["polyfills", "main", "gallery", "ai-renderer"]) {
  const result = await build({
    configFile: false,
    root,
    publicDir: false,
    plugins: [
      zodTreeShake(),
      {
        name: "ai-woff2-only",
        enforce: "pre",
        transform(source, file) {
          if (file.endsWith("katex.min.css"))
            return source.replace(
              /,url\([^)]*\.(?:woff|ttf)\) format\("[^"]*"\)/g,
              "",
            );
        },
      },
    ],
    define: {
      __BUILD_ID__: JSON.stringify(id),
      __PRODUCTION__: "true",
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    build: {
      target: ["chrome70", "es2018"],
      cssTarget: "chrome70",
      outDir,
      emptyOutDir: false,
      assetsInlineLimit: 0,
      minify: true,
      // Hidden: no sourceMappingURL, and the maps are moved out of the served tree below; the server restores incident stacks with them.
      sourcemap: "hidden",
      lib: {
        entry: path.join(
          root,
          name === "ai-renderer"
            ? "src/features/ai/adapters/renderer-entry.ts"
            : name === "gallery"
              ? "src/dev/gallery.tsx"
              : `src/${name}.${name === "polyfills" ? "ts" : "tsx"}`,
        ),
        formats: ["iife"],
        name: `Talos_${name.replace(/-/g, "_")}`,
      },
      rolldownOptions: {
        onwarn(warning, warn) {
          if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
        },
        output: {
          entryFileNames: `${name}-[hash].js`,
          assetFileNames: `${name}-[name]-[hash][extname]`,
          codeSplitting: false,
        },
      },
    },
  });
  outputs[name] = (Array.isArray(result) ? result[0] : result).output
    .map((asset) => asset.fileName)
    .filter((file) => !file.endsWith(".map"));
}
// Maps stay private: dist/source-maps/<build>/ is not part of the app manifest or the served assets.
const mapDir = path.join(dist, "source-maps", id);
await mkdir(mapDir, { recursive: true });
for (const file of await readdir(outDir))
  if (file.endsWith(".map"))
    await rename(path.join(outDir, file), path.join(mapDir, file));
function html(name) {
  const styles = outputs[name]
    .filter((file) => file.endsWith(".css"))
    .map((file) => `<link rel="stylesheet" href="/app/${id}/${file}">`)
    .join("");
  const scripts = [...outputs.polyfills, ...outputs[name]]
    .filter((file) => file.endsWith(".js"))
    .map((file) => `<script defer src="/app/${id}/${file}"></script>`)
    .join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#1c2733"><title>Talos II${name === "gallery" ? " · 设计系统" : ""}</title><link rel="icon" href="data:,"><meta name="talos-build" content="${id}">${name === "main" ? `<meta name="talos-ai-renderer" content='${JSON.stringify(outputs["ai-renderer"].filter((file) => /\.(js|css)$/.test(file)).map((file) => `/app/${id}/${file}`))}'>` : ""}${styles}${scripts}</head><body><div id="root"></div></body></html>`;
}
await writeFile(path.join(dist, "index.html"), html("main"));
await writeFile(path.join(outDir, "index.html"), html("main"));
await writeFile(path.join(dist, "gallery.html"), html("gallery"));
const files = [
  ...outputs.polyfills,
  ...outputs.main,
  ...outputs["ai-renderer"],
  "index.html",
];
const mime = (file) =>
  file.endsWith(".js")
    ? "text/javascript; charset=utf-8"
    : file.endsWith(".css")
      ? "text/css; charset=utf-8"
      : file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "application/octet-stream";
const assets = await Promise.all(
  files.map(async (file) => {
    const bytes = await readFile(path.join(outDir, file));
    return {
      path: `/app/${id}/${file}`,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mime: mime(file),
    };
  }),
);
await writeFile(
  path.join(dist, "app/manifest.json"),
  JSON.stringify({ build: id, assets }, null, 2),
);
// Explicit, reviewed per-file API exceptions; syntax and CSS are never exempted.
const reasons = {
  flat: "core-js es.array.flat and es.array.flat-map execute before MUI/app code.",
  globalThis:
    "core-js es.global-this executes in the synchronous polyfills script before the app; its own implementation feature-detects globalThis.",
  queueMicrotask:
    "core-js web.queue-microtask executes before React; core-js and React also feature-detect the native scheduler.",
  "Object.fromEntries":
    "core-js es.object.from-entries executes before the application.",
  "Promise.allSettled":
    "core-js es.promise.all-settled executes before the application.",
};
const allow = [];
for (const files of Object.values(outputs))
  for (const file of files.filter((file) => file.endsWith(".js"))) {
    const source = await readFile(path.join(outDir, file), "utf8");
    for (const [rule, justification] of Object.entries(reasons))
      if (source.includes(rule))
        allow.push({ file: `app/${id}/${file}`, rule, justification });
  }
await writeFile(
  path.join(dist, "compat-allowlist.json"),
  JSON.stringify(allow, null, 2),
);

await verifyRelease(dist);
