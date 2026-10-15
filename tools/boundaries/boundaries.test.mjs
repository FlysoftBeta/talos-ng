import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { boundaries, checkImport } from "../boundaries.mjs";
const options = { owner: "link", declared: { "@talos/base": "workspace:*" } };
describe("package boundaries", () => {
  it("predeclares all thirteen packages and enforces dependencies", () => {
    expect(Object.keys(boundaries)).toHaveLength(13);
    expect(checkImport({ ...options, source: "@talos/base" })).toBeUndefined();
    expect(checkImport({ ...options, source: "@talos/contract" })).toContain(
      "may not import",
    );
    expect(checkImport({ owner: "link", source: "@talos/base" })).toContain(
      "Undeclared",
    );
    expect(
      checkImport({ ...options, source: "@talos/base/src/bytes" }),
    ).toContain("public entry");
    expect(
      checkImport({
        owner: "contract",
        source: "@talos/docpack",
        declared: { "@talos/docpack": "workspace:*" },
      }),
    ).toContain("only import types");
    expect(
      checkImport({
        owner: "contract",
        source: "@talos/docpack",
        typeOnly: true,
        declared: { "@talos/docpack": "workspace:*" },
      }),
    ).toBeUndefined();
    expect(checkImport({ owner: "shell", source: "@talos/base" })).toContain(
      "may not import",
    );
    expect(
      checkImport({ owner: "client", source: "@talos/objectstore" }),
    ).toContain("may not import");
    expect(checkImport({ owner: "server", source: "@talos/store" })).toContain(
      "may not import",
    );
  });
  it("forbids Node builtins, permits test-only Node imports", () => {
    for (const source of ["fs", "node:fs", "fs/promises", "node:sqlite"])
      expect(checkImport({ ...options, source })).toContain("Node built-in");
    expect(
      checkImport({ ...options, source: "node:crypto", test: true }),
    ).toBeUndefined();
  });
  it("checks real ESLint import/export/dynamic/relative ASTs and library restrictions", async () => {
    const eslint = new ESLint({
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
    });
    const snippets = [
      "import '@talos/contract';",
      "export * from '@talos/contract';",
      "export { x } from '@talos/contract';",
      "void import('@talos/contract');",
      "import '../../link/src/index.ts';",
      "import 'node:fs';",
    ];
    for (const source of snippets) {
      const results = await eslint.lintText(source, {
        filePath: "packages/base/src/index.ts",
      });
      expect(
        results[0].messages.some((m) => m.ruleId === "boundaries/imports"),
        source,
      ).toBe(true);
    }
    const results = await eslint.lintText("export default 1; console.log(1);", {
      filePath: "packages/base/src/index.ts",
    });
    expect(results[0].messages.map((m) => m.ruleId)).toEqual(
      expect.arrayContaining(["no-console", "no-restricted-syntax"]),
    );
  });
});

it("blocks Blob/File values, global object access, and type references in storage packages", async () => {
  const eslint = new ESLint({
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    overrideConfig: {
      languageOptions: { parserOptions: { projectService: false } },
      rules: {
        "boundaries/imports": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/await-thenable": "off",
      },
    },
  });
  for (const name of ["store", "shell"]) {
    const [result] = await eslint.lintText(
      'new Blob(); new File([], "x"); new globalThis.Blob(); let x: Blob; let y: File; void x; void y;',
      { filePath: `packages/${name}/src/index.ts` },
    );
    expect(
      result.messages.filter((m) => m.ruleId === "no-restricted-globals"),
    ).toHaveLength(3);
    expect(
      result.messages.filter(
        (m) => m.ruleId === "@typescript-eslint/no-restricted-types",
      ),
    ).toHaveLength(2);
  }
});

it("allows the objectstore conformance entry only in authorized package tests", () => {
  const input = {
    owner: "server",
    source: "@talos/objectstore/testing",
    declared: { "@talos/objectstore": "workspace:*" },
    test: true,
  };
  expect(checkImport(input)).toBeUndefined();
  expect(checkImport({ ...input, test: false })).toContain("public entry");
  expect(checkImport({ ...input, declared: {} })).toContain("Undeclared");
  expect(checkImport({ ...input, owner: "client" })).toContain(
    "may not import",
  );
  expect(
    checkImport({ ...input, source: "@talos/objectstore/src/testing" }),
  ).toContain("public entry");
  expect(checkImport({ ...input, owner: "docpipe" })).toContain(
    "only import types",
  );
});

it("permits public link carrier entry points while keeping the Node carrier out of browser production", () => {
  const declared = { "@talos/link": "workspace:*" };
  expect(
    checkImport({ owner: "server", source: "@talos/link/ws-node", declared }),
  ).toBeUndefined();
  expect(
    checkImport({
      owner: "client",
      source: "@talos/link/ws-browser",
      declared,
    }),
  ).toBeUndefined();
  expect(
    checkImport({ owner: "client", source: "@talos/link/ws-node", declared }),
  ).toContain("Node carrier");
  expect(
    checkImport({
      owner: "client",
      source: "@talos/link/ws-node",
      declared,
      test: true,
    }),
  ).toBeUndefined();
  expect(
    checkImport({
      owner: "client",
      source: "@talos/link/src/client",
      declared,
    }),
  ).toContain("public entry");
});

it("keeps exceptions.json exactly equal to today's violations (no new, no stale)", async () => {
  const { collectAll } = await import("./ratchet.mjs");
  const { diffExceptions, loadExceptions } = await import("./exceptions.mjs");
  const { entries, errors } = await collectAll();
  expect(errors).toEqual([]);
  expect(diffExceptions(entries, loadExceptions())).toEqual({
    added: [],
    stale: [],
  });
}, 120_000);
