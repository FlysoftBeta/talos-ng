import { AppError, concat, utf8Decode } from "@talos/base";
import { CHAT_MAX_TEXT, CHAT_TEXT_CHUNK, contract } from "@talos/contract";
import type {
  ArgsOf,
  ChatFile,
  ChatPost,
  Method,
  ResultOf,
} from "@talos/contract";
import type { CommandPort } from "./ports.ts";
export function message(error: unknown): string {
  return error instanceof AppError ? error.message : "暂时无法完成，请重试";
}
export async function onlineCall<M extends Method>(
  runtime: Pick<CommandPort, "command">,
  method: M,
  args: ArgsOf<M>,
): Promise<ResultOf<M>> {
  const result = await runtime.command(method, args);
  if (result && typeof result === "object" && "queued" in result)
    throw new AppError("E_INTERNAL", "需要立即返回的操作被排队");
  return result as ResultOf<M>;
}
export async function textSource(
  runtime: CommandPort,
  text: string,
): Promise<{ text: string } | { textId: string }> {
  if (text.length > CHAT_MAX_TEXT)
    throw new AppError("E_TOO_LARGE", "正文最多 5,000,000 字符");
  if (text.length <= CHAT_TEXT_CHUNK) return { text };
  const id = runtime.operation().op;
  await runtime.setLocal(`text:${id}`, text);
  for (let offset = 0; offset < text.length; offset += CHAT_TEXT_CHUNK)
    await runtime.command(contract.chat.text.put, {
      id,
      offset,
      total: text.length,
      text: text.slice(offset, offset + CHAT_TEXT_CHUNK),
    });
  return { textId: id };
}
export async function setState(
  runtime: CommandPort,
  conversation: string,
  key: "pin" | "mute" | "draft" | "retention",
  value: boolean | string,
): Promise<void> {
  const { op, t } = runtime.operation();
  const source =
    key === "draft" && typeof value === "string"
      ? await textSource(runtime, value)
      : undefined;
  await runtime.command(
    contract.chat.state.set,
    {
      conversation,
      key,
      value: { v: source && "textId" in source ? "" : value, t, op },
      ...(source && "textId" in source ? source : {}),
    },
    { op },
  );
}
export async function sendText(
  runtime: CommandPort,
  conversation: string,
  text: string,
  replyTo?: string,
): Promise<string> {
  const body = text.trim();
  if (!body) throw new AppError("E_INVALID", "请输入消息内容");
  const source = await textSource(runtime, body);
  const { op } = runtime.operation();
  await runtime.setLocal(`body:${op}`, body);
  await runtime.command(
    contract.chat.post.send,
    {
      id: op,
      conversation,
      kind: "text",
      ...source,
      ...(replyTo ? { replyTo } : {}),
    },
    { op },
  );
  return op;
}
export async function page(
  runtime: CommandPort,
  conversation: string,
  direction: "before" | "after" | "around" | "latest",
  anchor?: number,
): Promise<ResultOf<typeof contract.chat.post.page>> {
  const result = await onlineCall(runtime, contract.chat.post.page, {
    conversation,
    direction,
    limit: 40,
    ...(anchor !== undefined ? { anchor } : {}),
  });
  await runtime.loadRows(
    `conv:${conversation}`,
    result.posts.map((post) => ({
      type: "post",
      id: post.id,
      rev: post.rev,
      deleted: post.deletedAt !== null,
      data: post,
    })),
  );
  return result;
}
export async function fullBody(
  runtime: CommandPort,
  post: ChatPost,
): Promise<string> {
  const key = `conv:${post.conversation}:body:${post.id}:${post.edited === null ? 0 : post.rev}`;
  const cached =
    (await runtime.getLocal<string>(key)) ??
    (!post.edited
      ? await runtime.getLocal<string>(`body:${post.id}`)
      : undefined);
  if (cached !== undefined) return cached;
  if (post.bodyLength <= post.preview.length) return post.preview;
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const result = await runtime.fetchBody(contract.chat.post.body, {
      id: post.id,
      offset,
    });
    parts.push(result.body);
    offset += result.body.byteLength;
    if (result.data.eof) break;
    if (!result.body.length) throw new AppError("E_PROTOCOL", "正文分片为空");
  }
  const body = utf8Decode(concat(...parts));
  await runtime.setLocal(key, body);
  return body;
}
export async function fileBytes(
  runtime: CommandPort,
  file: ChatFile,
  conversation?: string,
  owner = conversation ? `conv:${conversation}:cache` : "chat-stickers",
): Promise<Uint8Array> {
  const cached = await runtime.readFile(file.rid);
  if (cached) {
    await runtime.retainFile(file.rid, owner);
    return cached;
  }
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const result = await runtime.fetchBody(contract.chat.file.fetch, {
      rid: file.rid,
      offset,
      ...(conversation ? { conversation } : {}),
    });
    parts.push(result.body);
    offset += result.body.byteLength;
    if (result.data.eof) break;
    if (!result.body.length) throw new AppError("E_PROTOCOL", "图片分片为空");
  }
  const bytes = concat(...parts);
  await runtime.saveFile(file.rid, bytes, owner);
  return bytes;
}
export async function draftBody(
  runtime: CommandPort,
  id: string,
): Promise<string> {
  const cached = await runtime.getLocal<string>(`text:${id}`);
  if (cached !== undefined) return cached;
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const result = await runtime.fetchBody(contract.chat.text.fetch, {
      id,
      offset,
    });
    parts.push(result.body);
    offset += result.body.length;
    if (result.data.eof) break;
    if (!result.body.length) throw new AppError("E_PROTOCOL", "草稿分片为空");
  }
  const text = utf8Decode(concat(...parts));
  await runtime.setLocal(`text:${id}`, text);
  return text;
}

/** Find an uncached reply across disjoint history windows. */
export async function loadReply(
  runtime: CommandPort,
  conversation: string,
  id: string,
  before: number,
): Promise<ChatPost | undefined> {
  let anchor = before;
  while (anchor > 1) {
    const result = await page(runtime, conversation, "before", anchor);
    const found = result.posts.find((post) => post.id === id);
    if (found) return found;
    if (!result.hasBefore || result.first >= anchor || result.first === 0)
      return;
    anchor = result.first;
  }
  return;
}
