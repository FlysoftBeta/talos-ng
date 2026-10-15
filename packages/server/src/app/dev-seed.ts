import type { IdentityService } from "../modules/identity/index.ts";
import type { Uow } from "../kernel/persistence/uow.ts";
export function seedIdentity(
  identity: IdentityService,
  uow: Uow,
  testSeed = false,
): void {
  if (testSeed && identity.repo.countUsers() === 0) {
    // All-or-nothing, and never reset credentials in an existing database.
    uow.write(() => {
      identity.createUser({
        pin: "123456",
        name: "根管理员",
        handle: "root",
        roles: ["root"],
      });
      identity.createUser({ pin: "654321", name: "测试用户", handle: "demo" });
    });
  } else identity.bootstrap();
}
