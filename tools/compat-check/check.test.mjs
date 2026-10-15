import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkDirectory, checkSource, validateAllowlist } from "./check.mjs";
const here = fileURLToPath(new URL(".", import.meta.url));
describe("Chrome 70 compatibility gate", () => {
  it.each([
    'const message = "BigInt must be positive";',
    "const message = `BigInt must be ${value}`;",
    "// BigInt is unsupported\nconst value = 1;",
    "/* BigInt is unsupported */ const value = 1;",
  ])("ignores BigInt diagnostic text: %s", (source) => {
    expect(checkSource(source, "a.js")).toEqual([]);
  });
  it.each([
    "BigInt(1)",
    "window.BigInt(1)",
    'window["BigInt"](1)',
    "window[`BigInt`](1)",
    "`value: ${BigInt(1)}`",
    'const message = `BigInt description ${window["BigInt"](1)}`',
  ])("still rejects executable BigInt references: %s", (source) => {
    expect(
      checkSource(source, "a.js").filter(
        (finding) => finding.rule === "BigInt",
      ),
    ).toHaveLength(1);
  });
  it("accepts ES2018 JS and compatible CSS, recursively", () => {
    expect(checkDirectory(`${here}/fixtures/good`)).toEqual({
      files: 2,
      findings: [],
    });
  });
  it("rejects every maintained API and CSS rule in fixtures", () => {
    const result = checkDirectory(`${here}/fixtures/bad`);
    expect(new Set(result.findings.map((f) => f.rule))).toEqual(
      new Set([
        "syntax",
        "globalThis",
        "queueMicrotask",
        "Promise.allSettled",
        "Object.fromEntries",
        "matchAll",
        "replaceAll",
        "at",
        "structuredClone",
        "BigInt",
        "import.meta",
        "inset",
        "aspect-ratio",
        "clamp",
        "min/max",
        "is/where",
        "backdrop-filter",
      ]),
    );
  });
  it.each([
    "a?.b",
    "a ?? b",
    "await f()",
    "import.meta.url",
    "1n",
    "class A { field = 1 }",
  ])("rejects modern syntax: %s", (source) => {
    expect(checkSource(source, "a.js").some((f) => f.rule === "syntax")).toBe(
      true,
    );
  });
  it("allows justified, file-specific API polyfills, never syntax/CSS exemptions", () => {
    const allow = validateAllowlist([
      {
        file: "a.js",
        rule: "globalThis",
        justification: "Loaded polyfill before application.",
      },
    ]);
    expect(checkSource("globalThis.x", "a.js", allow)).toEqual([]);
    expect(checkSource("globalThis.x", "b.js", allow)).toHaveLength(1);
    for (const rule of ["syntax", "inset", "unknown"])
      expect(() =>
        validateAllowlist([{ file: "a.js", rule, justification: "test" }]),
      ).toThrow();
    expect(() =>
      validateAllowlist([
        { file: "a.js", rule: "globalThis", justification: " " },
      ]),
    ).toThrow();
    expect(() => validateAllowlist([...allow, ...allow])).toThrow();
    expect(() => validateAllowlist({})).toThrow();
  });
  it.each(["display:flex; gap:8px", "row-gap:4px", "column-gap:4px"])(
    "rejects unsupported spacing: %s",
    (css) => {
      expect(checkSource(css, "a.css").some((f) => f.rule === "gap")).toBe(
        true,
      );
    },
  );
  it("loads a generated per-build allowlist and rejects malformed auto-discovered configuration", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "talos-compat-"));
    try {
      writeFileSync(
        path.join(directory, "app.js"),
        "queueMicrotask(function() {});",
      );
      const allowPath = path.join(directory, "compat-allowlist.json");
      writeFileSync(
        allowPath,
        JSON.stringify([
          {
            file: "app.js",
            rule: "queueMicrotask",
            justification: "Explicit core-js subset runs first.",
          },
        ]),
      );
      expect(
        spawnSync(process.execPath, [path.join(here, "cli.mjs"), directory])
          .status,
      ).toBe(0);
      writeFileSync(allowPath, "{}");
      expect(
        spawnSync(process.execPath, [path.join(here, "cli.mjs"), directory])
          .status,
      ).toBe(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("reports lines and correct CLI exit codes", () => {
    expect(checkSource("\n\nqueueMicrotask(f)", "a.js")[0]?.line).toBe(3);
    /** @type {Array<[string[], number]>} */
    const cases = [
      [["fixtures/good"], 0],
      [["fixtures/bad"], 1],
      [[], 2],
      [["missing"], 2],
      [["fixtures/good", "--unknown"], 2],
    ];
    for (const [args, status] of cases) {
      const result = spawnSync(process.execPath, ["cli.mjs", ...args], {
        cwd: here,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(status);
    }
  });
});

it.each([
  ["[].flat()", "flat"],
  ["[].flatMap(f)", "flat"],
  ["new ResizeObserver(f)", "ResizeObserver"],
  ["new IntersectionObserver(f)", "IntersectionObserver"],
])("rejects unsupported runtime API %s", (source, rule) => {
  expect(checkSource(source, "a.js").some((f) => f.rule === rule)).toBe(true);
});
it("checks shell inline scripts and styles", () => {
  expect(
    checkSource("<script>window.x = a?.b</script>", "index.html")[0].rule,
  ).toBe("syntax");
  expect(
    checkSource(
      "<style>a:focus-visible { color: red }</style>",
      "index.html",
    )[0].rule,
  ).toBe("focus-visible");
  expect(
    checkSource(
      'if (typeof ResizeObserver !== "undefined") new ResizeObserver(f)',
      "a.js",
    ),
  ).toEqual([]);
});

it("recursively checks lazy chunks, font CSS, worker and top-level inline shell", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "talos-assets-"));
  try {
    mkdirSync(path.join(directory, "app", "build"), { recursive: true });
    for (const [name, source] of [
      ["app/build/ai-renderer.js", "a?.b"],
      ["app/build/fonts.css", "a { width: clamp(1px, 2vw, 3px) }"],
      ["sw.js", "Promise.allSettled([])"],
      ["index.html", "<script>globalThis.x = 1</script>"],
    ])
      writeFileSync(path.join(directory, name), source);
    const result = checkDirectory(directory);
    expect(result.files).toBe(4);
    expect(result.findings.map((f) => f.rule).sort()).toEqual(
      ["syntax", "clamp", "Promise.allSettled", "globalThis"].sort(),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
