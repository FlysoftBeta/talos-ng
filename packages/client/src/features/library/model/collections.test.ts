import { describe, expect, it, vi } from "vitest";
import { CollectionEditor, moveDocument } from "./collections.ts";
import type { CollectionCommandPort } from "./collections.ts";

const make = (command: () => Promise<unknown>) => {
  const port = {
    command: vi.fn(command),
    sync: vi.fn(async () => {}),
    dispatch: vi.fn(),
  } as unknown as CollectionCommandPort;
  return { port, editor: new CollectionEditor(port, "c1") };
};
describe("booklist editing", () => {
  it("moves a document by one place and ignores the edges", () => {
    expect(moveDocument(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveDocument(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveDocument(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
  it("stores the list, syncs, and rejects overlapping edits", async () => {
    let release: (value: unknown) => void = () => {};
    const { port, editor } = make(
      () => new Promise((resolve) => (release = resolve)),
    );
    const first = editor.save(["a"]);
    expect(await editor.save(["b"])).toBe(false);
    release({});
    expect(await first).toBe(true);
    expect(port.sync).toHaveBeenCalledTimes(1);
    expect(editor.getState()).toEqual({ busy: false, error: "" });
  });
  it("surfaces a failed save and a failed delete as the error state", async () => {
    const { port, editor } = make(async () => {
      throw new Error("没有权限");
    });
    expect(await editor.save(["a"])).toBe(false);
    expect(editor.getState().error).toBe("没有权限");
    expect(await editor.remove()).toBe(false);
    expect(port.dispatch).not.toHaveBeenCalled();
  });
  it("leaves the page after deleting", async () => {
    const { port, editor } = make(async () => ({}));
    expect(await editor.remove()).toBe(true);
    expect(port.dispatch).toHaveBeenCalledWith({ type: "back" });
  });
});
