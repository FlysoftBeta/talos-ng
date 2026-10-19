import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { diffExceptions, serialiseExceptions } from "./exceptions.mjs";
import { globToRegExp, matchesAny } from "./glob.mjs";
import { evaluateLayers } from "./layers.mjs";
import { locate } from "./plugin.mjs";
import { relativeInside, resolveRelative } from "./resolve.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Real config and real plugin; type-aware rules are irrelevant for virtual files.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: {
    languageOptions: { parserOptions: { projectService: false } },
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/await-thenable": "off",
    },
  },
});
async function lint(code, filePath, options = {}) {
  const instance = options.exceptions
    ? new ESLint({
        cwd: root,
        overrideConfig: [
          {
            languageOptions: { parserOptions: { projectService: false } },
            rules: {
              "@typescript-eslint/no-floating-promises": "off",
              "@typescript-eslint/await-thenable": "off",
              "boundaries/imports": ["error", options],
            },
          },
        ],
      })
    : eslint;
  const [result] = await instance.lintText(code, { filePath });
  return result.messages
    .filter((m) => m.ruleId === "boundaries/imports")
    .map((m) => m.message);
}
const denied = async (code, file, rule) => {
  const messages = await lint(code, file);
  expect(
    messages.some((m) => m.includes(`[${rule} -> `)),
    `${rule}: ${messages}`,
  ).toBe(true);
};
const clean = async (code, file) => expect(await lint(code, file)).toEqual([]);

describe("layer rules", () => {
  it("server: kernel never imports modules or app; app may", async () => {
    const kernel = "packages/server/src/kernel/zz-new.ts";
    await denied(
      'import { x } from "../modules/chat/index.ts";',
      kernel,
      "server-kernel-independent",
    );
    await denied(
      'import type { x } from "../app/create.ts";',
      kernel,
      "server-kernel-independent",
    );
    await clean('import { x } from "./db.ts";', kernel);
    await clean(
      'import { x } from "../modules/chat/index.ts";',
      "packages/server/src/app/zz-new.ts",
    );
  });
  it("server: peers only through ports.ts or index.ts, type imports included", async () => {
    const file = "packages/server/src/modules/chat/zz-new.ts";
    await clean('import type { P } from "../identity/ports.ts";', file);
    await clean('import { i } from "../identity/index.js";', file);
    await clean('import { own } from "./repo.ts";', file);
    await denied(
      'import { r } from "../identity/repo.ts";',
      file,
      "peer-entry",
    );
    await denied(
      'import type { r } from "../identity/repo.ts";',
      file,
      "peer-entry",
    );
  });
  it("client: core is framework-free and independent of app layers", async () => {
    const file = "packages/client/src/core/zz-new.ts";
    await denied(
      'import { useState } from "react";',
      file,
      "client-core-independent",
    );
    await denied(
      'import { s } from "../ui/index.ts";',
      file,
      "client-core-independent",
    );
    await denied(
      'import type { f } from "../features/chat/index.ts";',
      file,
      "client-core-independent",
    );
    await denied(
      'import { p } from "../platform/dom.ts";',
      file,
      "client-core-independent",
    );
    await clean('import { s } from "./runtime.ts";', file);
  });
  it("client: ui is presentational", async () => {
    const file = "packages/client/src/ui/zz-new.tsx";
    await denied(
      'import { c } from "../core/context.tsx";',
      file,
      "client-ui-independent",
    );
    await denied(
      'import { c } from "../features/chat/index.ts";',
      file,
      "client-ui-independent",
    );
    await clean(
      'import React from "react"; import { t } from "./theme.ts";',
      file,
    );
  });
  it("client: models have no React, MUI, CSS, tsx or ui", async () => {
    for (const file of [
      "packages/client/src/features/chat/model/zz-new.ts",
      "packages/client/src/features/chat/model.ts",
    ]) {
      const base = file.endsWith("model.ts") ? "../../" : "../../../";
      await denied(
        'import { useState } from "react";',
        file,
        "client-model-pure",
      );
      await denied(
        'import { B } from "@mui/material/Button";',
        file,
        "client-model-pure",
      );
      await denied('import "./x.css";', file, "client-model-pure");
      await denied(
        `import { b } from "${base}ui/index.ts";`,
        file,
        "client-model-pure",
      );
      // Resolved through the file system: ./context.js is context.tsx.
      await denied(
        `import { c } from "${base}platform/react/context.js";`,
        file,
        "client-model-pure",
      );
      await clean('import { other } from "./state.ts";', file);
    }
  });
  it("client: views take core as types only", async () => {
    const file = "packages/client/src/features/chat/view/zz-new.tsx";
    await denied(
      'import { run } from "../../../core/runtime.ts";',
      file,
      "client-view-no-runtime",
    );
    await clean(
      'import type { Runtime } from "../../../core/runtime.ts";',
      file,
    );
    await clean(
      'import { type Runtime } from "../../../core/runtime.ts";',
      file,
    );
    await clean(
      'import { x } from "../../../core/runtime.ts";',
      "packages/client/src/features/chat/view/zz.test.tsx",
    );
  });
  it("client: views take @talos/contract as types only", async () => {
    const file = "packages/client/src/features/chat/view/zz-new.tsx";
    await denied(
      'import { contract } from "@talos/contract";',
      file,
      "client-view-no-contract-values",
    );
    await clean('import type { Row } from "@talos/contract";', file);
  });
  it("client: features meet through index.ts, models also through model.ts", async () => {
    const file = "packages/client/src/features/settings/model/zz-new.ts";
    await clean('import { x } from "../../auth/model.ts";', file);
    await clean('import { x } from "../../auth/index.ts";', file);
    await denied(
      'import { x } from "../../auth/model/credentials.ts";',
      file,
      "peer-entry",
    );
  });
  it("client: only src/dev imports src/dev", async () => {
    await denied(
      'import "./dev/gallery.ts";',
      "packages/client/src/main.tsx",
      "client-dev-isolated",
    );
    await clean('import "./gallery.ts";', "packages/client/src/dev/index.ts");
  });
  it("product code never imports tools or test support; tests may", async () => {
    await denied(
      'import "../../../tools/e2e/harness/static-server.mjs";',
      "packages/base/src/zz-new.ts",
      "product-no-tools",
    );
    await denied(
      'import "./testing.ts";',
      "packages/base/src/zz-new.ts",
      "product-no-test-support",
    );
    await denied(
      'import "./test-fixtures.ts";',
      "packages/docpipe/src/zz-new.ts",
      "product-no-test-support",
    );
    await clean('import "./testing.ts";', "packages/base/src/zz-new.test.ts");
    await clean('import "./testing.ts";', "packages/base/src/testing.ts");
  });
  it("evaluates allow carve-outs, type-only permission and exact exceptions", async () => {
    const rule = {
      id: "r",
      from: "src/a/**",
      forbid: ["src/b/**"],
      allow: ["src/b/open/**"],
      typeOnlyAllowed: true,
      reason: "x",
    };
    const ctx = {
      file: "src/a/f.ts",
      test: false,
      typeOnly: false,
      specifier: "../b/f",
      targetInPackage: "src/b/f.ts",
      targetInRepo: "packages/p/src/b/f.ts",
      target: "packages/p/src/b/f.ts",
    };
    expect(evaluateLayers([rule], ctx)).toHaveLength(1);
    expect(evaluateLayers([rule], { ...ctx, typeOnly: true })).toEqual([]);
    expect(
      evaluateLayers([rule], { ...ctx, targetInPackage: "src/b/open/f.ts" }),
    ).toEqual([]);
    expect(evaluateLayers([rule], { ...ctx, file: "src/c/f.ts" })).toEqual([]);
    const code = 'import { x } from "../modules/chat/index.ts";';
    const file = "packages/server/src/kernel/zz-new.ts";
    const entry = {
      rule: "server-kernel-independent",
      file,
      target: "packages/server/src/modules/chat/index.ts",
    };
    expect(await lint(code, file, { exceptions: [entry] })).toEqual([]);
    expect(
      await lint(code, file, { exceptions: [{ ...entry, target: "other" }] }),
    ).toHaveLength(1);
  });
  it("covers re-exports, literal dynamic imports and import types", async () => {
    const file = "packages/server/src/kernel/zz-new.ts";
    for (const code of [
      'export * from "../modules/chat/index.ts";',
      'export { a } from "../modules/chat/index.ts";',
      'export type { a } from "../modules/chat/index.ts";',
      'void import("../modules/chat/index.ts");',
      'export type T = import("../modules/chat/index.ts").A;',
    ])
      await denied(code, file, "server-kernel-independent");
  });
});

describe("coverage of tools, bin and build scripts", () => {
  it("applies tool dependency maps and test-only permissions", async () => {
    const messages = (code, file) => lint(code, file);
    expect(
      await messages('import "@talos/server";', "tools/e2e/zz-new.mjs"),
    ).toEqual([expect.stringContaining("may not import")]);
    expect(
      await messages('import "@talos/launcher";', "tools/package/zz-new.mjs"),
    ).toEqual([]);
    expect(
      await messages('import "@talos/server";', "tools/typecheck.mjs"),
    ).toEqual([expect.stringContaining("may not import")]);
  });
  it("allows only named relative edges out of a tool", async () => {
    const file = "tools/e2e/zz-new.mjs";
    expect(
      await lint(
        'import "../../packages/server/src/kernel/config/config.ts";',
        file,
      ),
    ).toEqual([]);
    expect(
      await lint(
        'import "../../packages/server/src/kernel/sync/sync-hub.ts";',
        file,
      ),
    ).toEqual([expect.stringContaining("named policy edge")]);
    expect(await lint('import "../../../outside.mjs";', file)).toEqual([
      expect.stringContaining("leave the repository"),
    ]);
    expect(
      await lint(
        'import "../../link/src/index.ts";',
        "packages/base/src/zz-new.ts",
      ),
    ).toEqual([expect.stringContaining("Cross-package")]);
  });
  it("treats build scripts as Node tooling but keeps src environments", async () => {
    await clean('import "node:fs";', "packages/client/scripts/zz-new.mjs");
    expect(
      await lint('import "node:fs";', "packages/client/src/zz-new.ts"),
    ).toEqual([expect.stringContaining("Node built-in")]);
  });
});

describe("resolution", () => {
  it("resolves .js to .ts/.tsx, extensionless and directory entries on disk", () => {
    const dir = mkdtempSync(
      path.join(process.env.TMPDIR ?? tmpdir(), "talos-resolve-"),
    ).replaceAll("\\", "/");
    try {
      mkdirSync(`${dir}/pkg/dir`, { recursive: true });
      for (const name of ["a.ts", "b.tsx", "dir/index.tsx", "c.mjs"])
        writeFileSync(`${dir}/pkg/${name}`, "");
      const from = `${dir}/pkg/main.ts`;
      expect(resolveRelative(from, "./a.js")).toBe(`${dir}/pkg/a.ts`);
      expect(resolveRelative(from, "./b.js")).toBe(`${dir}/pkg/b.tsx`);
      expect(resolveRelative(from, "./b")).toBe(`${dir}/pkg/b.tsx`);
      expect(resolveRelative(from, "./dir")).toBe(`${dir}/pkg/dir/index.tsx`);
      expect(resolveRelative(from, "./dir/")).toBe(`${dir}/pkg/dir/index.tsx`);
      expect(resolveRelative(from, "./c.mjs")).toBe(`${dir}/pkg/c.mjs`);
      expect(resolveRelative(from, "./missing.js")).toBe(
        `${dir}/pkg/missing.ts`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("normalises Windows separators and rejects path escape", () => {
    const info = locate("C:\\repo\\packages\\client\\src\\core\\a.ts");
    expect(info).toMatchObject({
      kind: "package",
      owner: "client",
      local: "src/core/a.ts",
    });
    const resolved = resolveRelative(
      "C:/repo/packages/client/src/core/a.ts",
      "../ui/b.js",
      () => false,
    );
    expect(resolved).toBe("C:/repo/packages/client/src/ui/b.ts");
    expect(relativeInside("C:/repo/packages/client/", resolved)).toBe(
      "src/ui/b.ts",
    );
    expect(
      relativeInside(
        "C:/repo/packages/client/",
        resolveRelative(
          "C:/repo/packages/client/src/a.ts",
          "../../server/src/x.ts",
          () => false,
        ),
      ),
    ).toBeUndefined();
  });
  it("matches globs", () => {
    expect(
      globToRegExp("src/features/*/model/**").test(
        "src/features/chat/model/a/b.ts",
      ),
    ).toBe(true);
    expect(
      globToRegExp("src/features/*/model/**").test(
        "src/features/chat/x/model/a.ts",
      ),
    ).toBe(false);
    expect(matchesAny("**/*.css", "./a/b.css")).toBe(true);
    expect(matchesAny("src/{a,b}/**", "src/b/c.ts")).toBe(true);
  });
});

describe("ratchet", () => {
  const entry = (target) => ({ rule: "r", file: "f.ts", target });
  it("reports new and stale entries and keeps files diff-friendly", () => {
    expect(
      diffExceptions([entry("a"), entry("b")], [entry("b"), entry("c")]),
    ).toEqual({ added: [entry("a")], stale: [entry("c")] });
    expect(diffExceptions([entry("a")], [entry("a")])).toEqual({
      added: [],
      stale: [],
    });
    expect(
      serialiseExceptions([entry("b"), entry("a")]).split("\n"),
    ).toHaveLength(7);
  });
});
