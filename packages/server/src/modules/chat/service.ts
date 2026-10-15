import { migrate } from "../../kernel/persistence/db.ts";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { ChatAdminQueries } from "./admin-queries.ts";
import { ChatAttachments } from "./attachments/service.ts";
import { Drafts } from "./drafts/service.ts";
import { Moderation } from "./moderation/service.ts";
import type { ChatOptions } from "./options.ts";
import { Posts } from "./posts/service.ts";
import { ChatRepo } from "./repo.ts";
import { chatMigrations } from "./schema.ts";
import { registerChatSync } from "./sync.ts";
export { initialChatState } from "./drafts/state.ts";
export type { BodyChunk, ChatOptions } from "./options.ts";
/** Domain mutations use one UOW; actor policy is enforced by the API boundary. */
export class ChatService {
  readonly adminQueries: ChatAdminQueries;
  readonly repo: ChatRepo;
  readonly now: () => number;
  readonly assets: ChatAttachments;
  constructor(readonly options: ChatOptions) {
    const service = () => this;
    const posts = new Posts({
      get repo() {
        return service().repo;
      },
      text: (...args) => this.text(...args),
      get options() {
        return service().options;
      },
      get now() {
        return service().now;
      },
      touch: (...args) => this.touch(...args),
      get assets() {
        return service().assets;
      },
      requirePost: (...args) => this.requirePost(...args),
    });
    this.getPost = posts.getPost.bind(posts);
    this.send = posts.send.bind(posts);
    this.create = posts.create.bind(posts);
    this.page = posts.page.bind(posts);
    this.edit = posts.edit.bind(posts);
    this.delete = posts.delete.bind(posts);
    this.body = posts.body.bind(posts);
    this.image = posts.image.bind(posts);
    const drafts = new Drafts({
      get repo() {
        return service().repo;
      },
      get options() {
        return service().options;
      },
      get now() {
        return service().now;
      },
    });
    this.membershipChanged = drafts.membershipChanged.bind(drafts);
    this.state = drafts.state.bind(drafts);
    this.ensureStates = drafts.ensureStates.bind(drafts);
    this.touch = drafts.touch.bind(drafts);
    this.putText = drafts.putText.bind(drafts);
    this.text = drafts.text.bind(drafts);
    this.stagedText = drafts.stagedText.bind(drafts);
    this.textBody = drafts.textBody.bind(drafts);
    this.setState = drafts.setState.bind(drafts);
    this.read = drafts.read.bind(drafts);
    const moderation = new Moderation({
      get options() {
        return service().options;
      },
      get repo() {
        return service().repo;
      },
      get now() {
        return service().now;
      },
      state: (...args) => this.state(...args),
    });
    this.requireAccess = moderation.requireAccess.bind(moderation);
    this.requirePost = moderation.requirePost.bind(moderation);
    this.publish = moderation.publish.bind(moderation);
    this.ack = moderation.ack.bind(moderation);
    this.mute = moderation.mute.bind(moderation);

    this.adminQueries = new ChatAdminQueries(options.db);
    this.now = options.now ?? Date.now;
    migrate(options.db, "chat", chatMigrations, this.now);
    this.repo = new ChatRepo(options.db);
    this.assets = new ChatAttachments(options, this.repo);
  }
  get ready(): Promise<void> {
    return this.assets.seed();
  }
  registerSync(hub: SyncHub): void {
    registerChatSync(
      {
        repo: this.repo,
        community: this.options.community,
        identity: this.options.identity,
      },
      hub,
    );
  }
  readonly requireAccess: Moderation["requireAccess"];
  readonly requirePost: Moderation["requirePost"];
  readonly getPost: Posts["getPost"];
  readonly membershipChanged: Drafts["membershipChanged"];
  readonly state: Drafts["state"];
  readonly ensureStates: Drafts["ensureStates"];
  readonly touch: Drafts["touch"];
  readonly putText: Drafts["putText"];
  readonly text: Drafts["text"];
  readonly stagedText: Drafts["stagedText"];
  readonly send: Posts["send"];
  readonly create: Posts["create"];
  readonly page: Posts["page"];
  readonly edit: Posts["edit"];
  readonly delete: Posts["delete"];
  readonly body: Posts["body"];
  readonly textBody: Drafts["textBody"];
  readonly setState: Drafts["setState"];
  readonly read: Drafts["read"];
  readonly image: Posts["image"];
  readonly publish: Moderation["publish"];
  readonly ack: Moderation["ack"];
  readonly mute: Moderation["mute"];
}
