import { expect, it } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../kernel/persistence/db.ts";
import { createKernel } from "./create-application.ts";
import { Jobs } from "../kernel/jobs/jobs.ts";
import { identityPurge } from "../modules/identity/purge.ts";
import { UserPurgeRegistry } from "./user-purge.ts";

it("rolls back early cleanup after a late purge failure (legacy partial-commit regression)", async () => {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    backgroundTasks: false,
  });
  const user = kernel.identity.createUser({ pin: "654321", name: "Purge" }).id;
  db.run("INSERT INTO me_settings VALUES(?, 'test', 'true', 0, 0)", user);
  const jobs = new Jobs({
    db,
    uow: kernel.uow,
    clock: Date.now,
    id: () => "purge-test",
  });
  const registry = new UserPurgeRegistry({
    uow: kernel.uow,
    identity: identityPurge(db, kernel.identity.repo, () => {}),
    quiesce: (user) => jobs.cancelOwner(user),
  });
  registry.register({
    owner: "early",
    purgeUser: () =>
      kernel.uow.write(() => {
        db.run("DELETE FROM me_settings WHERE user_id=?", user);
      }),
  });
  registry.register({
    owner: "late",
    purgeUser: () => {
      throw new Error("late failure");
    },
  });
  registry.registerJob(jobs);
  const job = jobs.enqueue("administrator", "admin.user.purge", { user });
  jobs.start();
  await expect.poll(() => jobs.get(job.id)?.state).toBe("failed");
  expect(
    db.get("SELECT 1 FROM me_settings WHERE user_id=?", user),
  ).toBeDefined();
  expect(kernel.identity.repo.user(user)).toBeDefined();
  jobs.close();
  await kernel.close();
});
