import { createUlid } from "@talos/base";
import type { User } from "@talos/contract";
import { createMemoryObjectStore } from "@talos/objectstore";
import { ObjectLedger } from "../../kernel/objects/objects.ts";
import { UploadService } from "../../kernel/objects/uploads.ts";
import { Db, migrate } from "../../kernel/persistence/db.ts";
import { Uow } from "../../kernel/persistence/uow.ts";
import { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { LinkHost } from "../../kernel/transport/link-host.ts";
import { AuthorityService } from "../authority/index.ts";
import { CommunityService } from "../community/index.ts";
import {
  DirectoryRepo,
  ProvisioningRepo,
  identityMigrations,
} from "../identity/index.ts";
import { registerChatApi } from "./api.ts";
import { ChatService } from "./service.ts";
export function setupChat() {
  let time = 1000;
  const now = () => time;
  const id = createUlid({ clock: now });
  const db = new Db();
  const incidents: unknown[] = [];
  const hub = new SyncHub({
    revision: () => uow.revision,
    windowResetThreshold: 400,
    reportError: (e) => incidents.push(e),
  });
  const uow = new Uow(db, { committed: (changes) => hub.committed(changes) });
  migrate(db, "identity", identityMigrations, now);
  const identity = new DirectoryRepo(db);
  const users: User[] = [
    {
      id: id(),
      handle: "alice",
      name: "甲",
      roles: ["root"],
      features: ["offline", "post_images"],
      credentialVersion: 0,
    },
    {
      id: id(),
      handle: "bob",
      name: "乙",
      roles: [],
      features: ["offline", "post_images"],
      credentialVersion: 0,
    },
    {
      id: id(),
      handle: "outsider",
      name: "丙",
      roles: [],
      features: [],
      credentialVersion: 0,
    },
  ];
  for (const user of users)
    uow.write((ctx) =>
      new ProvisioningRepo(db).createUser(user, user.id, now(), ctx.rev),
    );
  let chat: ChatService | undefined = undefined;
  const community = new CommunityService({
    db,
    uow,
    now,
    id,
    user: (key) =>
      identity.active(key)
        ? identity.publicUser(identity.user(key)!)
        : undefined,
    users: () => users,
    onMembershipChanged: (...args) => chat?.membershipChanged(...args),
  });
  community.registerSync(hub);
  const store = createMemoryObjectStore();
  const objects = new ObjectLedger({ db, uow, store, clock: now });
  const uploads = new UploadService({
    db,
    uow,
    store,
    ledger: objects,
    clock: now,
    id,
  });
  chat = new ChatService({
    db,
    uow,
    community,
    identity,
    objects,
    store,
    uploads,
    now,
  });
  chat.registerSync(hub);
  const authority = new AuthorityService({ db, uow, now, identity });
  const host = new LinkHost({
    db,
    uow,
    build: "test",
    authenticate: (connection) => ({
      user: connection.ctx.get("test-user") as string,
    }),
    reportIncident: (error) => {
      incidents.push(error);
      return "incident";
    },
  });
  registerChatApi(host, chat, authority);
  const conversation = community
    .conversations(users[0]!.id)
    .find((conv) => conv.type === "wild")!.id;
  return {
    db,
    hub,
    uow,
    identity,
    users,
    community,
    store,
    objects,
    uploads,
    chat,
    authority,
    host,
    conversation,
    id,
    incidents,
    setTime: (value: number) => {
      time = value;
    },
    close: () => {
      host.close();
      hub.clear();
      db.close();
    },
  };
}
