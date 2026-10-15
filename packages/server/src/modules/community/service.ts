import { createUlid } from "@talos/base";
import { migrate } from "../../kernel/persistence/db.ts";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { CommunityAdminDirectory } from "./admin-queries.ts";
import { DirectMessages } from "./direct-messages/service.ts";
import { Groups } from "./groups/service.ts";
import { Membership } from "./membership/service.ts";
import type { CommunityOptions } from "./options.ts";
import { CommunityRepo } from "./repo.ts";
import { communityMigrations } from "./schema.ts";
import { registerCommunitySync } from "./sync.ts";
export type { CommunityOptions } from "./options.ts";
export class CommunityService {
  readonly repo: CommunityRepo;
  readonly adminDirectory: CommunityAdminDirectory;
  private readonly now: () => number;
  private readonly id: () => string;
  constructor(readonly options: CommunityOptions) {
    const service = () => this;
    const groups = new Groups({
      get repo() {
        return service().repo;
      },
      get options() {
        return service().options;
      },
      get id() {
        return service().id;
      },
      get now() {
        return service().now;
      },
      addMember: (...args) => this.addMember(...args),
      members: (...args) => this.members(...args),
      changedMembership: (...args) => this.changedMembership(...args),
    });
    this.conversation = groups.conversation.bind(groups);
    this.conversations = groups.conversations.bind(groups);
    this.groups = groups.groups.bind(groups);
    this.canAccess = groups.canAccess.bind(groups);
    this.canPost = groups.canPost.bind(groups);
    this.requireAccess = groups.requireAccess.bind(groups);
    this.create = groups.create.bind(groups);
    this.adminUpdate = groups.adminUpdate.bind(groups);
    this.adminDelete = groups.adminDelete.bind(groups);
    this.find = groups.find.bind(groups);
    this.children = groups.children.bind(groups);
    const membership = new Membership({
      get options() {
        return service().options;
      },
      get repo() {
        return service().repo;
      },
      conversation: (...args) => this.conversation(...args),
      requireAccess: (...args) => this.requireAccess(...args),
      canAccess: (...args) => this.canAccess(...args),
      get now() {
        return service().now;
      },
    });
    this.initializeUser = membership.initializeUser.bind(membership);
    this.member = membership.member.bind(membership);
    this.members = membership.members.bind(membership);
    this.visibleMembers = membership.visibleMembers.bind(membership);
    this.adminMember = membership.adminMember.bind(membership);
    this.join = membership.join.bind(membership);
    this.leave = membership.leave.bind(membership);
    this.hide = membership.hide.bind(membership);
    this.publicMember = membership.publicMember.bind(membership);
    this.addMember = membership.addMember.bind(membership);
    this.changedMembership = membership.changedMembership.bind(membership);
    const direct_messages = new DirectMessages({
      requireAccess: (...args) => this.requireAccess(...args),
      canAccess: (...args) => this.canAccess(...args),
      visibleMembers: (...args) => this.visibleMembers(...args),
      get repo() {
        return service().repo;
      },
      get id() {
        return service().id;
      },
      get options() {
        return service().options;
      },
      get now() {
        return service().now;
      },
      addMember: (...args) => this.addMember(...args),
      conversation: (...args) => this.conversation(...args),
    });
    this.openDm = direct_messages.openDm.bind(direct_messages);

    this.now = options.now ?? Date.now;
    this.id = options.id ?? createUlid({ clock: this.now });
    migrate(options.db, "community", communityMigrations, this.now);
    this.repo = new CommunityRepo(options.db);
    this.adminDirectory = new CommunityAdminDirectory(options.db);
    for (const type of ["wild", "announcement"] as const)
      if (!this.repo.all().some((row) => row.type === type)) {
        options.uow.write((ctx) =>
          this.repo.put({
            id: this.id(),
            kind: "group",
            type,
            name: type === "wild" ? "广场" : "公告",
            handle: type,
            parent: null,
            owner: null,
            discoverable: 0,
            members_hidden: 0,
            admin_only: type === "announcement" ? 1 : 0,
            no_leave: 1,
            password_hash: null,
            pair_key: null,
            created: this.now(),
            rev: ctx.rev,
            deleted: 0,
          }),
        );
      }
    for (const user of options.users()) this.initializeUser(user.id);
  }
  readonly initializeUser: Membership["initializeUser"];
  readonly conversation: Groups["conversation"];
  readonly conversations: Groups["conversations"];
  readonly groups: Groups["groups"];
  readonly canAccess: Groups["canAccess"];
  readonly canPost: Groups["canPost"];
  readonly requireAccess: Groups["requireAccess"];
  readonly member: Membership["member"];
  readonly members: Membership["members"];
  readonly visibleMembers: Membership["visibleMembers"];
  readonly create: Groups["create"];
  readonly adminUpdate: Groups["adminUpdate"];
  readonly adminDelete: Groups["adminDelete"];
  readonly adminMember: Membership["adminMember"];
  readonly find: Groups["find"];
  readonly children: Groups["children"];
  readonly join: Membership["join"];
  readonly leave: Membership["leave"];
  readonly hide: Membership["hide"];
  readonly openDm: DirectMessages["openDm"];
  registerSync(hub: SyncHub): void {
    registerCommunitySync(
      {
        records: this.repo,
        user: (id) => this.options.user(id),
        canAccess: this.canAccess,
        conversations: this.conversations,
        publicMember: this.publicMember,
      },
      hub,
    );
  }
  readonly publicMember: Membership["publicMember"];
  readonly addMember: Membership["addMember"];
  readonly changedMembership: Membership["changedMembership"];
}
