import { expect, it } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../kernel/persistence/db.ts";
import { createKernel } from "./create-application.ts";

it("rechecks owner download expiry, user binding and current role for live tickets", async () => {
  let now = 1_000_000;
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
    backgroundTasks: false,
    clock: { now: () => now, setTimeout: () => 0, clearTimeout: () => {} },
  });
  try {
    const root = kernel.admin.listUsers({ query: "root" }).items[0]!.id;
    const other = kernel.admin.createUser(root, {
      handle: "download_reader",
      pin: "471007",
    }).user.id;
    kernel.authority.setAccess(other, { roles: ["root"] });
    for (const table of ["admin_downloads", "ops_downloads"] as const) {
      const objectId = (table === "admin_downloads" ? "a" : "b").repeat(64);
      if (table === "admin_downloads")
        db.run(
          "INSERT INTO admin_downloads VALUES(?,?,?)",
          objectId,
          root,
          now + 100,
        );
      else
        db.run(
          "INSERT INTO ops_downloads VALUES(?,?,?,?)",
          objectId,
          root,
          now + 100,
          "backup",
        );
      const issue = (user: string) =>
        kernel.tickets.issue({
          user,
          objectId,
          filename: "download.zip",
          mime: "application/zip",
        }).ticket;
      const ticket = issue(root);
      expect((await kernel.tickets.resolve(ticket)).objectId).toBe(objectId);
      await expect(kernel.tickets.resolve(issue(other))).rejects.toMatchObject({
        code: "E_DENIED",
      });
      now += 99;
      await expect(kernel.tickets.resolve(ticket)).resolves.toHaveProperty(
        "objectId",
        objectId,
      );
      now++;
      // Ticket TTL is still live; the owner's shorter authorization has expired.
      await expect(kernel.tickets.resolve(ticket)).rejects.toMatchObject({
        code: "E_DENIED",
      });
    }
    const download = kernel.admin.incidentDownload(other);
    await expect(
      kernel.tickets.resolve(download.ticket),
    ).resolves.toHaveProperty("user", other);
    kernel.authority.setAccess(other, { roles: [] });
    await expect(kernel.tickets.resolve(download.ticket)).rejects.toMatchObject(
      { code: "E_DENIED" },
    );

    const data = new TextEncoder().encode("owned upload");
    const upload = await kernel.uploads.begin(other, {
      kind: "document",
      size: data.length,
    });
    await kernel.uploads.append(other, { id: upload.id, offset: 0 }, data);
    const result = await kernel.uploads.commit(other, { id: upload.id });
    const ticket = kernel.tickets.issue({
      user: other,
      objectId: result.object.id,
      filename: "owned.txt",
      mime: "text/plain",
    });
    await expect(kernel.tickets.resolve(ticket.ticket)).resolves.toHaveProperty(
      "user",
      other,
    );
    const foreign = kernel.tickets.issue({
      user: root,
      objectId: result.object.id,
      filename: "owned.txt",
      mime: "text/plain",
    });
    await expect(kernel.tickets.resolve(foreign.ticket)).rejects.toMatchObject({
      code: "E_DENIED",
    });
    kernel.identity.adminSetStatus(other, { banned: true });
    await expect(kernel.tickets.resolve(ticket.ticket)).rejects.toMatchObject({
      code: "E_DENIED",
    });
  } finally {
    await kernel.close();
    db.close();
  }
});
