import { AppError, utf8Encode } from "@talos/base";
import type { ArgsOf, ChatImage, ChatPost } from "@talos/contract";
import { chat, CHAT_PREVIEW } from "@talos/contract";
import type { WriteContext } from "../../../kernel/persistence/uow.ts";
import type { ChatAttachments } from "../attachments/service.ts";
import { textChunk } from "../drafts/text-chunk.ts";
import type { BodyChunk, ChatOptions } from "../options.ts";
import type { ChatRepo } from "../repo.ts";
export interface PostsContext {
  repo: Pick<
    ChatRepo,
    "post" | "sticker" | "latest" | "putPost" | "page" | "body"
  >;
  text(user: string, args: { text?: string; textId?: string }): string;
  options: Pick<
    ChatOptions,
    "uow" | "identity" | "objects" | "store" | "uploads"
  >;
  now: () => number;
  touch(conversation: string, ctx: WriteContext): void;
  assets: Pick<ChatAttachments, "prepareImage">;
  requirePost(user: string, conversation: string): void;
}
export class Posts {
  constructor(private readonly context: PostsContext) {}
  getPost(id: string): ChatPost {
    const post = this.context.repo.post(id);
    if (!post) throw new AppError("E_NOT_FOUND", "消息不存在");
    return post;
  }
  send(user: string, args: ArgsOf<typeof chat.post.send>): { post: ChatPost } {
    const value = chat.post.send.args.safeParse(args);
    if (!value.success) throw new AppError("E_INVALID", "消息参数无效");
    const input = value.data;
    const body = input.kind === "text" ? this.context.text(user, input) : "";
    const sticker =
      input.kind === "sticker"
        ? this.context.repo.sticker(input.sticker!)
        : null;
    if (input.kind === "sticker" && !sticker)
      throw new AppError("E_NOT_FOUND", "表情不存在，请重新选择");
    return this.create(user, input, body, sticker ?? null, null);
  }
  create(
    user: string,
    input: { id: string; conversation: string; replyTo?: string },
    body: string,
    sticker: ChatPost["sticker"],
    image: ChatImage | null,
  ): { post: ChatPost } {
    return this.context.options.uow.write((ctx) => {
      if (this.context.repo.post(input.id))
        throw new AppError("E_CONFLICT", "消息编号已使用");
      if (input.replyTo) {
        const reply = this.getPost(input.replyTo);
        if (
          reply.conversation !== input.conversation ||
          reply.deletedAt !== null
        )
          throw new AppError("E_INVALID", "回复对象不属于此对话或已删除");
      }
      const post: ChatPost = {
        id: input.id,
        conversation: input.conversation,
        seq: (this.context.repo.latest(input.conversation)?.seq ?? 0) + 1,
        rev: ctx.rev,
        author: user,
        authorName:
          this.context.options.identity.user(user)?.name ?? "无主内容",
        kind: image ? "image" : sticker ? "sticker" : "text",
        preview: image
          ? "[图片]"
          : sticker
            ? `[表情] ${sticker.name}`.slice(0, CHAT_PREVIEW)
            : body.slice(0, CHAT_PREVIEW),
        bodyLength: body.length,
        replyTo: input.replyTo ?? null,
        created: this.context.now(),
        edited: null,
        deletedAt: null,
        sticker,
        image,
      };
      this.context.repo.putPost(post, body);
      ctx.changed(`conv:${post.conversation}`, "post", post.id);
      this.context.touch(post.conversation, ctx);
      return { post };
    });
  }
  page(args: ArgsOf<typeof chat.post.page>): {
    posts: ChatPost[];
    first: number;
    last: number;
    latest: number;
    hasBefore: boolean;
    hasAfter: boolean;
  } {
    const { conversation, anchor, direction = "latest", limit = 40 } = args;
    const latest = this.context.repo.latest(conversation)?.seq ?? 0;
    let start = 1,
      end = latest;
    if (direction === "before")
      end = Math.min(latest, (anchor ?? latest + 1) - 1);
    if (direction === "after") start = (anchor ?? 0) + 1;
    if (direction === "around")
      start = Math.max(1, (anchor ?? latest) - Math.floor(limit / 2));
    if (direction === "latest" || direction === "before")
      start = Math.max(1, end - limit + 1);
    const posts = this.context.repo.page(
      conversation,
      start,
      end,
      Math.min(limit, 40),
    );
    while (
      posts.length > 1 &&
      utf8Encode(JSON.stringify(posts)).length > 180 * 1024
    ) {
      if (direction === "latest" || direction === "before") posts.shift();
      else posts.pop();
    }
    const first = posts[0]?.seq ?? 0,
      last = posts[posts.length - 1]?.seq ?? 0;
    return {
      posts,
      first,
      last,
      latest,
      hasBefore: first > 1,
      hasAfter: last > 0 && last < latest,
    };
  }
  edit(user: string, args: ArgsOf<typeof chat.post.edit>): { post: ChatPost } {
    const body = this.context.text(user, args);
    return this.context.options.uow.write((ctx) => {
      const before = this.getPost(args.id);
      if (before.deletedAt !== null)
        throw new AppError("E_CONFLICT", "消息已删除");
      if (before.kind !== "text")
        throw new AppError("E_INVALID", "只能编辑文字消息");
      const post = {
        ...before,
        preview: body.slice(0, CHAT_PREVIEW),
        bodyLength: body.length,
        edited: this.context.now(),
        rev: ctx.rev,
      };
      this.context.repo.putPost(post, body);
      ctx.changed(`conv:${post.conversation}`, "post", post.id);
      this.context.touch(post.conversation, ctx);
      return { post };
    });
  }
  delete(id: string): { post: ChatPost } {
    const before = this.getPost(id);
    if (before.deletedAt !== null) return { post: before };
    return this.context.options.uow.write((ctx) => {
      const post = {
        ...before,
        preview: "",
        bodyLength: 0,
        deletedAt: this.context.now(),
        sticker: null,
        image: null,
        rev: ctx.rev,
      };
      this.context.repo.putPost(post, "");
      if (before.image)
        for (const file of [before.image.original, before.image.thumbnail])
          this.context.options.objects.removeRef(file.rid, "chat-post", id);
      ctx.changed(`conv:${post.conversation}`, "post", id);
      this.context.touch(post.conversation, ctx);
      return { post };
    });
  }
  body(args: ArgsOf<typeof chat.post.body>): BodyChunk {
    const post = this.getPost(args.id);
    if (post.deletedAt !== null)
      throw new AppError("E_NOT_FOUND", "消息已删除");
    return textChunk(this.context.repo.body(args.id) ?? "", args);
  }
  async image(
    user: string,
    args: ArgsOf<typeof chat.post.image>,
    authorize?: () => void,
  ): Promise<{ post: ChatPost }> {
    const image = await this.context.assets.prepareImage(user, args.upload);
    this.context.requirePost(user, args.conversation);
    return this.context.options.objects
      .publish(
        () => this.context.options.store.put(image.thumbnail),
        () => {
          this.context.requirePost(user, args.conversation);
          authorize?.();
          this.context.options.uploads.claim(
            user,
            args.upload,
            "chat-post",
            args.id,
          );
          this.context.options.objects.addRef(
            image.image.thumbnail.rid,
            "chat-post",
            args.id,
          );
          this.create(user, args, "", null, image.image);
        },
      )
      .then(() => ({ post: this.getPost(args.id) }));
  }
}
