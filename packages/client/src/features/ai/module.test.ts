import { describe, it, expect } from "vitest";
import { aiModule } from "./module.ts";
import type { StoredRow } from "../../core/data/db.ts";
const op = "00000000000000000000000001",
  context = { user: "u", op };
describe("AI local reducers", () => {
  it("keeps offline draft text and does not replace newer draft provenance", () => {
    const write = aiModule.reducers["ai.draft.set"];
    let rows: readonly StoredRow[] = [];
    rows = write(
      rows,
      {
        id: "conversation",
        textId: op,
        value: { v: "中文草稿", t: { ms: 10, counter: 0 }, op },
      },
      context,
    );
    expect(rows[0]?.scope).toBe("me:u");
    expect(
      write(
        rows,
        {
          id: "conversation",
          value: { v: "old", t: { ms: 1, counter: 0 }, op },
        },
        context,
      ),
    ).toBe(rows);
  });
  it("merges read cursor monotonically and bounds it to the latest message", () => {
    const id = op,
      rows: StoredRow[] = [
        {
          scope: "me:u",
          type: "aiConversation",
          id,
          rev: 1,
          deleted: false,
          data: {
            id,
            title: "测试",
            tags: [],
            lastSeq: 8,
            readSeq: 5,
            running: null,
            updated: 1,
          },
        },
      ];
    expect(
      (
        aiModule.reducers["ai.conversation.read"](rows, { id, seq: 2 })[0]
          ?.data as { readSeq: number }
      ).readSeq,
    ).toBe(5);
    expect(
      (
        aiModule.reducers["ai.conversation.read"](rows, { id, seq: 100 })[0]
          ?.data as { readSeq: number }
      ).readSeq,
    ).toBe(8);
  });
});
