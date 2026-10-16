import { OpsObjectAccess } from "../modules/ops/index.ts";
import { AdminDownloadAccess } from "../modules/admin/index.ts";
import { ExpensiveCallLimiter } from "../kernel/transport/rate-limit.ts";
import { applicationLifecycle } from "./lifecycle.ts";
import { registerApi } from "./register-api.ts";
import { objectAccess } from "./object-access.ts";
import { seedIdentity } from "./dev-seed.ts";
import type { CancellationSignal } from "@talos/base";
import {
  NetbooksService,
  FakeNetbooksProvider,
  TomatoProvider,
} from "../modules/netbooks/index.ts";
import type { NetbooksProvider } from "../modules/netbooks/index.ts";
import { AiService, configuredProvider } from "../modules/ai/index.ts";
import type { ModelProvider } from "../modules/ai/index.ts";
import { LibraryService, LibraryAccess } from "../modules/library/index.ts";
import {
  MediaService,
  YtDlpProvider,
  testMediaProvider,
} from "../modules/media/index.ts";
import type { MediaProvider } from "../modules/media/index.ts";
import { AdminService } from "../modules/admin/index.ts";
import { composeUserPurge } from "./compose-user-purge.ts";
import type { UserPurgeRegistry } from "./user-purge.ts";
import { OpsService } from "../modules/ops/index.ts";
import type { OpsOptions } from "../modules/ops/index.ts";
import { AppError, createUlid } from "@talos/base";
import type { ObjectStore } from "@talos/objectstore";
import { IdentityService, sessionState } from "../modules/identity/index.ts";
import { AuthorityService } from "../modules/authority/index.ts";
import { CommunityService } from "../modules/community/index.ts";
import { ChatService } from "../modules/chat/index.ts";
import { MeService } from "../modules/me/index.ts";
import { createTasks } from "../modules/tasks/index.ts";
import { LearningService } from "../modules/learning/index.ts";
import type { Db } from "../kernel/persistence/db.ts";
import { Uow } from "../kernel/persistence/uow.ts";
import { SyncHub } from "../kernel/sync/sync-hub.ts";
import { Jobs } from "../kernel/jobs/jobs.ts";
import { LinkHost } from "../kernel/transport/link-host.ts";
import { Incidents } from "../kernel/diagnostics/incidents.ts";
import { Audit } from "../kernel/diagnostics/audit.ts";
import { ObjectLedger } from "../kernel/objects/objects.ts";
import { UploadService } from "../kernel/objects/uploads.ts";
import { TicketService } from "../kernel/objects/tickets.ts";
import { systemClock } from "../kernel/config/clock.ts";
import type { Clock } from "../kernel/config/clock.ts";
export interface KernelOptions {
  db: Db;
  store: ObjectStore;
  ops?: OpsOptions;
  aiProvider?: ModelProvider;
  build: string;
  serverLogs?: () => string;
  dev?: boolean;
  testSeed?: boolean;
  /** Offline import may enqueue jobs without executing background work. */
  backgroundTasks?: boolean;
  clock?: Clock;
  printRootPin?: (pin: string) => void;
  netbooksProvider?: NetbooksProvider;
  netbooksWait?: (ms: number, signal: CancellationSignal) => Promise<void>;
  mediaProvider?: MediaProvider;
  mediaBinaryPath?: string;
}
export interface Kernel {
  purge: UserPurgeRegistry;
  ai: AiService;
  ops: OpsService;
  admin: AdminService;
  db: Db;
  store: ObjectStore;
  uow: Uow;
  syncHub: SyncHub;
  identity: IdentityService;
  authority: AuthorityService;
  me: MeService;
  learning: LearningService;
  library: LibraryService;
  netbooks: NetbooksService;
  media: MediaService;
  community: CommunityService;
  chat: ChatService;
  jobs: Jobs;
  tasks: ReturnType<typeof createTasks>;
  objects: ObjectLedger;
  uploads: UploadService;
  tickets: TicketService;
  host: LinkHost;
  audit: Audit;
  incidents: Incidents;
  maintain(): Promise<void>;
  close(): Promise<void>;
}
export function createKernel(options: KernelOptions): Kernel {
  if (options.testSeed && !options.dev)
    throw new AppError("E_INVALID", "测试账户仅限开发模式");
  const { db, store } = options;
  const clock = options.clock ?? systemClock;
  const now = () => clock.now();
  const incidents = new Incidents(db, now, 1000, options.build);
  const report = (error: unknown) => {
    incidents.report(error);
  };
  const audit = new Audit(db, now);
  const syncHub = new SyncHub({
    revision: () => uow.revision,
    reportError: report,
  });
  let aiService: AiService | undefined = undefined;
  const uow = new Uow(
    db,
    {
      committed: (set) => {
        // Revalidate every bound session before fan-out, including revocation on
        // another connection. No stale authentication can retain a subscription.
        if (host)
          for (const connection of host.link.connections.values())
            identity.authenticate(connection);
        aiService?.jobsChanged(
          set.changes
            .filter((change) => change.type === "job")
            .map((change) => change.id),
        );
        syncHub.committed(set);
      },
    },
    report,
  );
  let host: LinkHost | undefined = undefined;
  let community: CommunityService | undefined = undefined;
  let chat: ChatService | undefined = undefined;
  const authority: AuthorityService = new AuthorityService({
    identity: {
      baseActor: (id) => identity.repo.baseActor(id),
      activeUserIds: () => identity.repo.activeUserIds(),
      userIdsAfter: (cursor, limit) =>
        identity.repo.userIdsAfter(cursor, limit),
    },
    db,
    uow,
    now,
    groups: (user) => community?.groups(user) ?? [],
  });
  const identity = new IdentityService({
    db,
    uow,
    now,
    printRootPin: options.printRootPin,
    projectAccess: (user) => authority.repo.project(user),
    accessRevision: (user) => authority.repo.revision(user),
    onBindingChanged: (connection) => syncHub.unsubscribe(connection.id),
    onSessionsChanged: () => {
      if (host)
        for (const conn of host.link.connections.values()) {
          const before = sessionState(conn)?.user;
          const after = identity.authenticate(conn).user;
          if (before && !after) tickets.revokeUser(before);
        }
    },
  });
  const communityService = new CommunityService({
    db,
    uow,
    now,
    user: (id) => authority.repo.actor(id),
    users: () => authority.repo.users().map((id) => authority.repo.actor(id)!),
    onMembershipChanged: (user, conversation, joined, ctx) => {
      chat?.membershipChanged(user, conversation, joined, ctx);
      authority.membershipChanged(user, conversation, ctx);
    },
  });
  community = communityService;
  communityService.registerSync(syncHub);
  const me = new MeService({ db, uow, identity: identity.repo, now });
  const learning = new LearningService({ db, uow, now });
  me.registerSync(syncHub);
  authority.registerSync(syncHub);
  const assertOwnerWritable = (user: string) =>
    identity.repo.assertWritable(user);
  const jobs = new Jobs({
    assertOwnerWritable,
    db,
    uow,
    clock: now,
    id: createUlid({ clock: now }),
    timers: clock,
    reportError: report,
  });
  const tasks = createTasks({ jobs, syncHub, dev: options.dev, timers: clock });
  const objects = new ObjectLedger({ db, uow, store, clock: now });
  const uploads = new UploadService({
    assertOwnerWritable,
    db,
    uow,
    ledger: objects,
    store,
    clock: now,
  });
  const ai = new AiService({
    assertOwnerWritable,
    db,
    uow,
    jobs,
    uploads,
    store,
    now,
    provider: options.aiProvider ?? configuredProvider(process.env),
    allowed: (user) => authority.can(user, "feature.use", { feature: "ai" }),
  });
  aiService = ai;
  ai.registerSync(syncHub);
  const clearSourceJobs = (records: { job: string; user_id: string }[]) => {
    for (const record of records) {
      if (!jobs.get(record.job)?.deleted && jobs.get(record.job)) {
        jobs.cancel(record.user_id, record.job);
        jobs.clear(record.user_id, record.job);
      }
    }
  };
  const library = new LibraryService({
    db,
    uow,
    store,
    objects,
    uploads,
    jobs,
    now,
    onDeleteDocument: (id) => clearSourceJobs(netbooks.removeDocument(id)),
    onDeleteCollection: (id, tx) => {
      authority.revokeResource(`coll:${id}`, tx);
      clearSourceJobs(netbooks.removeCollection(id));
    },
  });
  const libraryAccess = new LibraryAccess(library, authority, communityService);
  const netbooks = new NetbooksService({
    db,
    uow,
    jobs,
    library,
    access: libraryAccess,
    now,
    wait: options.netbooksWait,
    provider:
      options.netbooksProvider ??
      (options.testSeed && options.dev
        ? new FakeNetbooksProvider()
        : new TomatoProvider()),
  });
  const media = new MediaService({
    assertOwnerWritable,
    db,
    uow,
    jobs,
    objects,
    store,
    now,
    provider:
      options.mediaProvider ??
      (options.testSeed
        ? testMediaProvider()
        : new YtDlpProvider(options.mediaBinaryPath ?? "")),
  });
  const chatService = new ChatService({
    db,
    uow,
    now,
    community: communityService,
    identity: identity.repo,
    objects,
    store,
    uploads,
  });
  chat = chatService;
  chatService.registerSync(syncHub);
  const tickets = new TicketService({
    clock: now,
    access: objectAccess(
      { identity, uploads, authority, media, community: communityService },
      libraryAccess,
      now,
      new OpsObjectAccess(db),
      new AdminDownloadAccess(db),
    ),
  });
  const ops = new OpsService(
    {
      db,
      uow,
      store,
      ledger: objects,
      tickets,
      uploads,
      jobs,
      now,
      build: options.build,
      identity: identity.repo,
      clock,
      report,
    },
    options.ops,
  );
  const admin = new AdminService({
    serverLogs: options.serverLogs,
    db,
    uow,
    identity,
    authority,
    chat: chatService,
    community,
    audit,
    incidents,
    jobs,
    tickets,
    onBanPending: (user, until) => {
      const connections = host
        ? [...host.link.connections.values()].filter(
            (conn) => sessionState(conn)?.user === user,
          )
        : [];
      return () => {
        for (const conn of connections)
          conn.emit("identity.session.revoked", {
            reason: "banned",
            retryAt: until ?? undefined,
          });
      };
    },
    now,
  });
  const purge = composeUserPurge(
    {
      db,
      uow,
      identity,
      authority,
      chat: chatService,
      library,
      media,
      objects,
      uploads,
      jobs,
      tickets,
    },
    async (user) => {
      await host?.drainUser(user);
    },
  );
  purge.registerJob(jobs);
  const limiter = new ExpensiveCallLimiter(now);
  host = new LinkHost({
    rateLimit: (context, method) =>
      limiter.check(
        context.user ?? context.device ?? context.connection.id,
        method,
      ),
    db,
    uow,
    build: options.build,
    clock,
    authenticate: (connection) => identity.authenticate(connection),
    reportIncident: (error, ctx) => incidents.report(error, ctx),
    replay: (ctx, method, result) => {
      if (
        (method === "auth.login" ||
          method === "auth.resume" ||
          method === "identity.onboarding.complete") &&
        ctx.device
      ) {
        if (!("token" in (result as object))) return;
        const token = (result as { token: string }).token;
        identity.bind(
          ctx.connection,
          identity.resume(ctx.device, token),
          ctx.device,
        );
      } else if (method === "auth.lock") identity.lock(ctx.connection);
      // The original logout already revoked its requested token. Replays only
      // restore the connection binding, never revoke a newer login's session.
      else if (method === "auth.logout") identity.lock(ctx.connection);
      else if (method === "auth.device.register")
        identity.bindDevice(
          ctx.connection,
          (result as { device: string }).device,
        );
    },
  });
  host.link.onDisconnect((connection) => syncHub.unsubscribe(connection.id));
  registerApi(
    {
      host,
      identity,
      authority,
      me,
      learning,
      community: communityService,
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
    },
    libraryAccess,
    options.build,
    now,
  );
  seedIdentity(identity, uow, options.testSeed);
  for (const user of authority.repo.users()) {
    library.ensureBuiltins(user);
    communityService.initializeUser(user);
    chatService.ensureStates(user);
  }
  return {
    purge,
    ai,
    ops,
    admin,
    db,
    store,
    uow,
    syncHub,
    identity,
    authority,
    me,
    learning,
    library,
    netbooks,
    media,
    community: communityService,
    chat: chatService,
    jobs,
    tasks,
    objects,
    uploads,
    tickets,
    host,
    audit,
    incidents,
    ...applicationLifecycle(
      {
        jobs,
        ops,
        host,
        tickets,
        db,
        uploads,
        media,
        objects,
        ai,
        syncHub,
      },
      now,
      options.backgroundTasks,
    ),
  };
}
