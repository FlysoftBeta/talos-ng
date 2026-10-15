import { expect, it } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../kernel/persistence/db.ts";
import { createKernel } from "./create-application.ts";
it("test bootstrap seeds root and ordinary accounts only once and survives restart", async () => {
  const db = new Db();
  const options = {
    db,
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  };
  let kernel = createKernel(options);
  try {
    const device = kernel.identity.registerDevice();
    const root = kernel.identity.login(device, "123456");
    const ordinary = kernel.identity.login(device, "654321");
    expect(root.user.roles).toContain("root");
    expect(ordinary.user.roles).toEqual([]);
    expect(ordinary.user.handle).toBe("demo");
    await kernel.close();
    kernel = createKernel(options);
    expect(kernel.identity.repo.countUsers()).toBe(2);
    expect(kernel.identity.resume(device, ordinary.token).user.id).toBe(
      ordinary.user.id,
    );
  } finally {
    await kernel.close();
    db.close();
  }
});
it("the kernel refuses test seeding outside development before database writes", () => {
  const db = new Db();
  try {
    expect(() =>
      createKernel({
        db,
        store: createMemoryObjectStore(),
        build: "test",
        testSeed: true,
      }),
    ).toThrow("测试账户仅限开发模式");
    expect(db.all("SELECT name FROM sqlite_master WHERE type='table'")).toEqual(
      [],
    );
  } finally {
    db.close();
  }
});
