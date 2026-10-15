import { describe, expect, it } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../kernel/persistence/db.ts";
import { createKernel } from "./create-application.ts";

describe("scheduled lifecycle cleanup", () => {
  it("expires abandoned text and downloads while preserving resumed staging", async () => {
    let now = 1000;
    const db = new Db();
    const kernel = createKernel({
      db,
      store: createMemoryObjectStore(),
      build: "test",
      clock: {
        now: () => now,
        setTimeout: () => 0,
        clearTimeout: () => {},
      },
      printRootPin: () => {},
    });
    try {
      const user = kernel.identity.repo.activeUserIds()[0]!;
      const upload = await kernel.uploads.begin(user, {
        kind: "document",
        size: 10,
      });
      const ticket = kernel.tickets.issue({
        user,
        objectId: "a".repeat(64),
        filename: "test.txt",
        mime: "text/plain",
      });
      db.run("INSERT INTO chat_texts VALUES('old',?,10,'',?)", user, now);
      db.run("INSERT INTO ai_texts VALUES('old',?,10,'',?)", user, now);
      db.run(
        "INSERT INTO admin_downloads VALUES('object',?,?)",
        user,
        now + 300000,
      );
      db.run("INSERT INTO chat_texts VALUES('held',?,10,'',?)", user, now);
      db.run("INSERT INTO ai_texts VALUES('held',?,10,'',?)", user, now);
      db.run(
        "INSERT INTO chat_states VALUES(?,'conversation',?,0,0)",
        user,
        JSON.stringify({ draftTextId: "held" }),
      );
      db.run(
        "INSERT INTO ai_rows VALUES(?,'aiDraft','conversation',?,0,0)",
        user,
        JSON.stringify({ textId: "held" }),
      );
      now += 86400000;
      db.run("INSERT INTO chat_texts VALUES('resumed',?,10,'',?)", user, now);
      db.run("INSERT INTO ai_texts VALUES('resumed',?,10,'',?)", user, now);
      await Promise.all([kernel.maintain(), kernel.maintain()]);
      expect(db.all("SELECT id FROM chat_texts")).toEqual([
        { id: "held" },
        { id: "resumed" },
      ]);
      expect(db.all("SELECT id FROM ai_texts")).toEqual([
        { id: "held" },
        { id: "resumed" },
      ]);
      expect(db.all("SELECT * FROM admin_downloads")).toEqual([]);
      expect(
        db.get("SELECT id FROM uploads WHERE id=?", upload.id),
      ).toBeUndefined();
      await expect(kernel.tickets.resolve(ticket.ticket)).rejects.toMatchObject(
        { code: "E_NOT_FOUND" },
      );
      await kernel.maintain();
      expect(db.all("SELECT id FROM chat_texts")).toHaveLength(2);
    } finally {
      await kernel.close();
      db.close();
    }
  });
});
