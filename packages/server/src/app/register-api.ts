import { registerNetbooksApi } from "../modules/netbooks/index.ts";
import { registerAiApi } from "../modules/ai/index.ts";
import { registerLibraryApi } from "../modules/library/index.ts";
import { registerMediaApi } from "../modules/media/index.ts";
import { registerAdminApi } from "../modules/admin/index.ts";
import { registerOpsApi } from "../modules/ops/index.ts";
import { registerIdentityApi } from "../modules/identity/index.ts";
import { registerAuthorityApi } from "../modules/authority/index.ts";
import { registerCommunityApi } from "../modules/community/index.ts";
import { registerChatApi } from "../modules/chat/index.ts";
import { registerMeApi } from "../modules/me/index.ts";
import { registerTasksApi } from "../modules/tasks/index.ts";
import { contract, CONTRACT_VERSION } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import type { Kernel } from "./create-application.ts";
import type { LibraryAccess } from "../modules/library/index.ts";
import type { SyncRequest, SyncSnapshot } from "../kernel/sync/sync-hub.ts";
export function registerApi(
  application: Pick<
    Kernel,
    | "host"
    | "identity"
    | "authority"
    | "me"
    | "community"
    | "chat"
    | "ai"
    | "library"
    | "media"
    | "netbooks"
    | "tasks"
    | "ops"
    | "admin"
    | "audit"
    | "syncHub"
    | "uow"
    | "uploads"
    | "tickets"
  >,
  libraryAccess: LibraryAccess,
  build: string,
  now: () => number,
  syncReplicas?: (user: string, request: SyncRequest) => Promise<SyncSnapshot>,
): void {
  const {
    host,
    identity,
    authority,
    me,
    community,
    chat: chatService,
    ai,
    library,
    media,
    netbooks,
    tasks,
    ops,
    admin,
    audit,
    syncHub,
    uow,
    uploads,
    tickets,
  } = application;
  registerIdentityApi(host, identity, authority);
  registerAuthorityApi(host, authority);
  registerMeApi(host, me);
  registerCommunityApi(host, community);
  registerChatApi(host, chatService, authority, audit);
  registerAiApi(host, ai, authority, audit);
  registerLibraryApi(host, library, libraryAccess, tickets, syncHub);
  registerMediaApi(
    host,
    media,
    authority,
    community,
    tickets,
    syncHub,
    admin.policy,
  );
  registerNetbooksApi(host, netbooks);
  registerTasksApi(host, tasks);
  registerOpsApi(host, ops, authority, audit);
  registerAdminApi(host, admin, authority);
  host.register(contract.sys.info, () => ({
    version: CONTRACT_VERSION,
    build: build,
    now: now(),
  }));
  host.register(contract.sys.time, () => ({ now: now() }));
  host.register(contract.sync.pull, async (ctx, args) => {
    library.ensureBuiltins(ctx.user!);
    community.initializeUser(ctx.user!);
    chatService.ensureStates(ctx.user!);
    // A pull must not open an empty unit of work: every commit bumps the
    // revision and fans out to every subscription.
    if (!ai.billing.projected(ctx.user!))
      uow.write((write) => ai.billing.project(ctx.user!, write));
    // These writers committed above, so a replica snapshot already holds them.
    // The link host validates the result against the contract once.
    return (
      syncReplicas
        ? await syncHub.pullFrom(syncReplicas, ctx.user!, args, ctx.connection)
        : syncHub.pull(ctx.user!, args, ctx.connection)
    ) as ResultOf<typeof contract.sync.pull>;
  });
  host.register(contract.upload.begin, (ctx, args) =>
    uploads.begin(ctx.user!, args),
  );
  host.register(contract.upload.append, (ctx, args, body) =>
    uploads.append(ctx.user!, args, body),
  );
  host.register(contract.upload.commit, (ctx, args) =>
    uploads.commit(ctx.user!, args),
  );
  host.register(contract.upload.abort, (ctx, args) =>
    uploads.abort(ctx.user!, args),
  );
  host.register(contract.upload.ticket, (ctx, args) => {
    const object = uploads.getCommitted(ctx.user!, args.id);
    return tickets.issue({
      objectId: object.id,
      user: ctx.user!,
      filename: args.filename,
      mime: args.mime,
    });
  });
}
