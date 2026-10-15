import {
  aiConversationSchema,
  aiCreditSchema,
  aiDraftSchema,
  aiMessageSchema,
} from "@talos/contract";
import type {
  AiConversation,
  AiCredit,
  AiDraft,
  AiMessage,
} from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import type { Repository } from "../../../core/data/repository.ts";
import type { Page } from "../../../core/navigation/nav.ts";
import type { RuntimeQueryPort } from "../../../core/runtime-port.ts";

/** The synchronized `ai.rows` repository every AI controller reads. */
export type AiRowSource = Pick<
  Repository<StoredRow>,
  "getSnapshot" | "subscribe"
>;
export function aiRowSource(
  port: Pick<RuntimeQueryPort, "repositories">,
): AiRowSource {
  const source = port.repositories.get("ai.rows");
  if (!source) throw new Error("AI 数据仓库不可用");
  return source;
}

export function conversationsOf(rows: readonly StoredRow[]): AiConversation[] {
  return rows
    .filter((v) => v.type === "aiConversation")
    .map((v) => aiConversationSchema.parse(v.data))
    .sort((a, b) => b.updated - a.updated);
}
export function creditOf(rows: readonly StoredRow[]): AiCredit | undefined {
  const parsed = aiCreditSchema.safeParse(
    rows.find((v) => v.type === "aiCredit")?.data,
  );
  return parsed.success ? parsed.data : undefined;
}
export function draftOf(
  rows: readonly StoredRow[],
  conversation: string,
): AiDraft | undefined {
  const parsed = aiDraftSchema.safeParse(
    rows.find((v) => v.type === "aiDraft" && v.id === conversation)?.data,
  );
  return parsed.success ? parsed.data : undefined;
}
export function messagesOf(
  rows: readonly StoredRow[],
  conversation: string,
): AiMessage[] {
  return rows
    .filter(
      (v) =>
        v.type === "aiMessage" &&
        (v.data as { conversation?: string }).conversation === conversation,
    )
    .map((v) => aiMessageSchema.parse(v.data))
    .sort((a, b) => a.seq - b.seq);
}
/** The conversation shown in the AI content pane: the top `page` entry of the area stack. */
export function currentConversationId(
  stack: readonly Page[],
): string | undefined {
  const current = stack[stack.length - 1];
  return current?.kind === "page" ? current.id : undefined;
}
export function findConversation(
  rows: readonly StoredRow[],
  id: string | undefined,
): AiConversation | undefined {
  const row =
    id === undefined
      ? undefined
      : rows.find((r) => r.type === "aiConversation" && r.id === id);
  return row ? aiConversationSchema.parse(row.data) : undefined;
}
