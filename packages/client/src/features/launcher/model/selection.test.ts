import { describe, expect, it } from "vitest";
import { LauncherSelection } from "./selection.ts";
import type { LauncherItem } from "./selection.ts";

const item = (id: string): LauncherItem => ({
  id,
  group: "recent",
  title: id,
  hint: "",
});

describe("launcher selection", () => {
  it("starts on the first item and wraps in both directions", () => {
    const s = new LauncherSelection();
    s.setItems([item("a"), item("b"), item("c")]);
    expect(s.selectedId).toBe("a");
    s.step(-1);
    expect(s.selectedId).toBe("c");
    s.step(1);
    s.step(1);
    expect(s.selectedId).toBe("b");
  });
  it("keeps the highlight across refreshes while the item exists", () => {
    const s = new LauncherSelection();
    s.setItems([item("a"), item("b")]);
    s.step(1);
    s.setItems([item("z"), item("a"), item("b")]);
    expect(s.selected()?.id).toBe("b");
    s.setItems([item("z"), item("a")]);
    expect(s.selected()?.id).toBe("z");
    s.setItems([]);
    s.step(1);
    expect(s.selected()).toBeUndefined();
  });
});
