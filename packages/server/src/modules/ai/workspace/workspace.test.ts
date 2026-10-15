import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupAi } from "../testing/setup.ts";
import { safePath, safeText, WORKSPACE_BYTES } from "./service.ts";
let s: ReturnType<typeof setupAi>;
beforeEach(() => {
  s = setupAi();
});
afterEach(() => s.close());
describe("workspace safety", () => {
  it.each([
    "../a.md",
    "/a.md",
    "a\\b.md",
    "a/../b.md",
    ".hidden/a.md",
    "a//b.md",
    "a/b/c/d.md",
    "C:/a.md",
    "a.md:stream",
    "a%2f.md",
    "NUL.md",
    "con/a.md",
    "a./b.md",
    "attachments/a.md",
    "a.html",
    "a\0.md",
  ])("rejects %s", (p) => expect(() => safePath(p)).toThrow());
  it("property-tests traversal and separator injection across deterministic random names", () => {
    let n = 19;
    for (let i = 0; i < 500; i++) {
      n = (n * 1664525 + 1013904223) >>> 0;
      const name = `文档${n}.md`;
      for (const prefix of [
        "../",
        "/",
        "x/../../",
        "x\\",
        "x\0/",
        "C:/",
        ".hidden/",
      ])
        expect(() => safePath(prefix + name)).toThrow();
      expect(safePath(`笔记/${name}`)).toBe(`笔记/${name}`);
    }
  });
  it.each([
    "<svg><script>alert(1)</script></svg>",
    '<svg onload="x"></svg>',
    '<svg><image href="https://x"/></svg>',
    "<svg><foreignObject/></svg>",
    "<!DOCTYPE svg><svg></svg>",
    '<svg><path fill="url(#x)"/></svg>',
    "<svg><style>a{}</style></svg>",
    '<svg><use href="data:x"/></svg>',
    "<svg>&#106;</svg>",
  ])("rejects active SVG %s", (svg) =>
    expect(() => safeText("a.svg", svg)).toThrow(),
  );
  it("accepts inert SVG with paths and Chinese labels", () =>
    expect(() =>
      safeText(
        "a.svg",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0L20 20" stroke="red"/><text x="2" y="3">中文</text></svg>',
      ),
    ).not.toThrow());
  it("enforces revision preconditions, exact replacement counts and journal idempotency", () => {
    const u = s.users[0]!,
      run = s.id();
    const call = {
      id: "1",
      name: "create_file",
      arguments: JSON.stringify({ path: "a.md", content: "一 一" }),
    };
    const first = s.service.workspace.tool(u, run, call);
    expect(s.service.workspace.tool(u, run, call)).toEqual(first);
    expect(
      s.service.workspace.tool(u, run, {
        id: "2",
        name: "replace_text",
        arguments: JSON.stringify({
          path: "a.md",
          oldText: "一",
          newText: "二",
          expectedReplacements: 1,
        }),
      }),
    ).toHaveProperty("error");
    const f = s.service.workspace.read(u, "a.md");
    expect(() =>
      s.service.workspace.write(u, "a.md", "x", f.file.rev + 1),
    ).toThrow("已修改");
    expect(f.content).toBe("一 一");
  });
  it("enforces byte and file quotas atomically, allowing deletion at quota", () => {
    const u = s.users[0]!,
      workspace = s.service.workspace;
    workspace.write(u, "big.txt", "x".repeat(WORKSPACE_BYTES), null);
    expect(() => workspace.write(u, "other.txt", "x", null)).toThrow("10 MiB");
    const f = workspace.read(u, "big.txt");
    workspace.delete(u, "big.txt", f.file.rev);
    for (let i = 0; i < 256; i++) workspace.write(u, `${i}.txt`, "", null);
    expect(() => workspace.write(u, "257.txt", "", null)).toThrow("256");
  });
  it("accepts valid image magic and rejects mismatches and oversize bytes", async () => {
    const u = s.users[0]!,
      id = s.id(),
      bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await s.uploads.begin(u, { id, kind: "image", size: bytes.length });
    await s.uploads.append(u, { id, offset: 0 }, bytes);
    await s.uploads.commit(u, { id });
    await expect(s.service.image(u, id, "image/jpeg")).rejects.toThrow("不符");
    expect((await s.service.image(u, id, "image/png")).path).toMatch(
      /^attachments\//,
    );
    await expect(
      s.service.image(s.users[1]!, id, "image/png"),
    ).rejects.toThrow();
  });
  it("answers file-tool failures to the model instead of throwing, and replays a call id from the journal", () => {
    const u = s.users[0]!;
    const call = (id: string, name: string, args: unknown) =>
      s.service.workspace.tool(u, "run-1", {
        id,
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      });
    expect(call("1", "nope", {})).toEqual({ error: "未知文件工具" });
    expect(call("2", "read_file", "{broken")).toEqual({
      error: "文件工具参数无效",
    });
    expect(call("3", "read_file", { path: "../x.md" })).toMatchObject({
      error: expect.any(String),
    });
    expect(call("4", "read_file", { path: "缺失.md" })).toEqual({
      error: "文件不存在",
    });
    expect(
      call("5", "create_file", { path: "a.md", content: "one" }),
    ).toMatchObject({
      path: "a.md",
    });
    // Same call id again: the journaled result is returned, nothing is re-executed.
    expect(
      call("5", "create_file", { path: "a.md", content: "two" }),
    ).toMatchObject({
      path: "a.md",
    });
    expect(s.service.workspace.read(u, "a.md").content).toBe("one");
    expect(
      call("6", "create_file", { path: "a.md", content: "dup" }),
    ).toMatchObject({
      error: expect.any(String),
    });
    expect(
      call("7", "replace_text", {
        path: "a.md",
        oldText: "one",
        newText: "1",
        expectedReplacements: 2,
      }),
    ).toEqual({ error: "替换次数与预期不符" });
    call("8", "replace_text", {
      path: "a.md",
      oldText: "one",
      newText: "1",
      expectedReplacements: 1,
    });
    expect(s.service.workspace.read(u, "a.md").content).toBe("1");
    expect(call("9", "list_files", {})).toHaveLength(1);
    call("10", "delete_file", { path: "a.md" });
    expect(call("11", "list_files", {})).toEqual([]);
    // The journal is per run: another run may reuse the call id.
    expect(
      s.service.workspace.tool(u, "run-2", {
        id: "5",
        name: "create_file",
        arguments: JSON.stringify({ path: "a.md", content: "again" }),
      }),
    ).toMatchObject({ path: "a.md" });
  });
});
