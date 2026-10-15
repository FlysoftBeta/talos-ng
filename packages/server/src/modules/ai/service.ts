import { AppError, createUlid } from "@talos/base";
import { migrate } from "../../kernel/persistence/db.ts";
import { Billing } from "./billing/service.ts";
import { Conversations } from "./conversations/service.ts";
import type { AiOptions } from "./options.ts";
import { AiRepo } from "./repo.ts";
import { Runs } from "./runs/service.ts";
import { aiMigrations } from "./schema.ts";
import { Workspace, imageValid } from "./workspace/service.ts";
export type { AiOptions } from "./options.ts";
export class AiService {
  readonly repo: AiRepo;
  readonly workspace: Workspace;
  readonly billing: Billing;
  readonly id: () => string;
  private closed = false;
  constructor(readonly options: AiOptions) {
    const service = () => this;
    const conversations = new Conversations({
      get options() {
        return service().options;
      },
      get repo() {
        return service().repo;
      },
      get id() {
        return service().id;
      },
    });
    this.putText = conversations.putText.bind(conversations);
    this.content = conversations.content.bind(conversations);
    this.requireConversation =
      conversations.requireConversation.bind(conversations);
    this.putConversation = conversations.putConversation.bind(conversations);
    this.create = conversations.create.bind(conversations);
    this.update = conversations.update.bind(conversations);
    this.read = conversations.read.bind(conversations);
    this.draft = conversations.draft.bind(conversations);
    this.page = conversations.page.bind(conversations);
    this.fork = conversations.fork.bind(conversations);
    this.registerSync = conversations.registerSync.bind(conversations);
    const runs = new Runs({
      get repo() {
        return service().repo;
      },
      get options() {
        return service().options;
      },
      requireConversation: (...args) => this.requireConversation(...args),
      get billing() {
        return service().billing;
      },
      get id() {
        return service().id;
      },
      putConversation: (...args) => this.putConversation(...args),
      get closed() {
        return service().closed;
      },
      get workspace() {
        return service().workspace;
      },
    });
    this.jobsChanged = runs.jobsChanged.bind(runs);
    this.start = runs.start.bind(runs);
    this.stop = runs.stop.bind(runs);
    this.finish = runs.finish.bind(runs);
    this.execute = runs.execute.bind(runs);

    migrate(options.db, "ai", aiMigrations, options.now);
    this.repo = new AiRepo(options.db);
    this.workspace = new Workspace(this.repo, options.uow);
    this.billing = new Billing(
      this.repo,
      options.uow,
      options.now,
      () => !!options.provider,
    );
    this.id = options.id ?? createUlid({ clock: options.now });
    // A provider stream cannot be replayed safely after a process crash. Retain partial text and settle its checkpoint.
    for (const r of this.repo.active())
      if (r.state === "running")
        this.finish(
          r.id,
          "failed",
          r.charged,
          "服务器重启，生成已中断；已保留部分回答",
        );
    options.jobs.register("ai.run", {
      concurrency: 4,
      timeoutMs: 120000,
      onBoot: "requeue",
      run: (ctx) => this.execute(ctx),
    });
  }
  readonly putText: Conversations["putText"];
  readonly content: Conversations["content"];
  readonly jobsChanged: Runs["jobsChanged"];
  close(): void {
    this.closed = true;
  }
  readonly requireConversation: Conversations["requireConversation"];
  readonly putConversation: Conversations["putConversation"];
  readonly create: Conversations["create"];
  readonly update: Conversations["update"];
  readonly read: Conversations["read"];
  readonly draft: Conversations["draft"];
  readonly page: Conversations["page"];

  readonly fork: Conversations["fork"];
  async image(
    user: string,
    upload: string,
    mime: string,
  ): Promise<ReturnType<Workspace["list"]>[number]> {
    const object = this.options.uploads.getCommitted(user, upload);
    if (object.size > 5 * 1024 * 1024 || object.size === 0)
      throw new AppError("E_TOO_LARGE", "单张图片须不超过 5 MiB");
    const bytes = await this.options.store.readAll(object.id);
    if (!imageValid(mime, bytes))
      throw new AppError("E_INVALID", "图片格式与内容不符");
    this.options.assertOwnerWritable?.(user);
    const ext = mime === "image/jpeg" ? "jpg" : mime.slice(6);
    return this.options.uow.write(() =>
      this.workspace.put(
        user,
        `attachments/${this.id()}.${ext}`,
        mime,
        bytes,
        null,
      ),
    );
  }
  readonly start: Runs["start"];
  readonly stop: Runs["stop"];
  readonly finish: Runs["finish"];
  readonly execute: Runs["execute"];
  readonly registerSync: Conversations["registerSync"];
}
