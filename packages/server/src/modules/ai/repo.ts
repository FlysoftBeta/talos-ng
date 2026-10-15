import type {
  AiConversation,
  AiCredit,
  AiDraft,
  AiMessage,
  AiPolicy,
  AiStats,
} from "@talos/contract";
import type { Row } from "@talos/sync";
import type { Db } from "../../kernel/persistence/db.ts";
export interface RunRecord {
  id: string;
  user: string;
  conversation: string;
  message: string;
  job: string;
  state: string;
  reserved: number;
  charged: number;
  plan: number;
  topup: number;
  day: string;
  week: string;
  created: number;
}
export interface FileRecord {
  user: string;
  path: string;
  mime: string;
  bytes: Uint8Array;
  rev: number;
}
interface DataRecord {
  id: string;
  type: string;
  data: string;
  rev: number;
  deleted: number;
}
export class AiRepo {
  constructor(readonly db: Db) {}
  get<T>(user: string, type: string, id: string): T | undefined {
    const row = this.db.get<DataRecord>(
      "SELECT * FROM ai_rows WHERE user=? AND type=? AND id=?",
      user,
      type,
      id,
    );
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  put(
    user: string,
    type: string,
    id: string,
    data: AiConversation | AiDraft | AiCredit,
    rev: number,
  ): void {
    this.db.run(
      "INSERT INTO ai_rows VALUES(?,?,?,?,?,0) ON CONFLICT(user,type,id) DO UPDATE SET data=excluded.data,rev=excluded.rev",
      user,
      type,
      id,
      JSON.stringify(data),
      rev,
    );
  }
  rows(user: string, since = 0, limit = 1000): Row[] {
    return this.db
      .all<DataRecord>(
        "SELECT * FROM ai_rows WHERE user=? AND rev>? ORDER BY rev,type,id LIMIT ?",
        user,
        since,
        limit,
      )
      .map((r) => ({
        type: r.type,
        id: r.id,
        rev: r.rev,
        deleted: !!r.deleted,
        data: JSON.parse(r.data) as Row["data"],
      }));
  }
  conversation(user: string, id: string): AiConversation | undefined {
    return this.get(user, "aiConversation", id);
  }
  conversations(user: string): AiConversation[] {
    return this.rows(user, -1, 100000)
      .filter((r) => r.type === "aiConversation")
      .map((r) => r.data as AiConversation);
  }
  message(id: string): AiMessage | undefined {
    const r = this.db.get<DataRecord>(
      "SELECT * FROM ai_messages WHERE id=?",
      id,
    );
    return r ? (JSON.parse(r.data) as AiMessage) : undefined;
  }
  putMessage(user: string, m: AiMessage): void {
    this.db.run(
      "INSERT INTO ai_messages VALUES(?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,rev=excluded.rev",
      m.id,
      user,
      m.conversation,
      m.seq,
      JSON.stringify(m),
      m.rev,
    );
  }
  messages(
    conversation: string,
    before = Number.MAX_SAFE_INTEGER,
    limit = 20,
  ): AiMessage[] {
    return this.db
      .all<DataRecord>(
        "SELECT * FROM ai_messages WHERE conversation=? AND seq<? ORDER BY seq DESC LIMIT ?",
        conversation,
        before,
        limit,
      )
      .map((r) => JSON.parse(r.data) as AiMessage)
      .reverse();
  }
  messageRows(conversation: string, since: number, limit: number): Row[] {
    return this.db
      .all<DataRecord>(
        "SELECT * FROM ai_messages WHERE conversation=? AND rev>? ORDER BY rev,id LIMIT ?",
        conversation,
        since,
        limit,
      )
      .map((r) => ({
        type: "aiMessage",
        id: r.id,
        rev: r.rev,
        deleted: false,
        data: messagePreview(JSON.parse(r.data) as AiMessage),
      }));
  }
  run(id: string): RunRecord | undefined {
    return this.db.get<RunRecord>("SELECT * FROM ai_runs WHERE id=?", id);
  }
  active(user?: string): RunRecord[] {
    return this.db.all<RunRecord>(
      "SELECT * FROM ai_runs WHERE state IN ('queued','running')" +
        (user ? " AND user=?" : ""),
      ...(user ? [user] : []),
    );
  }
  insertRun(r: RunRecord): void {
    this.db.run(
      "INSERT INTO ai_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      r.id,
      r.user,
      r.conversation,
      r.message,
      r.job,
      r.state,
      r.reserved,
      r.charged,
      r.plan,
      r.topup,
      r.day,
      r.week,
      r.created,
    );
  }
  finishRun(id: string, state: string, charged: number): void {
    this.db.run(
      "UPDATE ai_runs SET state=?,charged=? WHERE id=?",
      state,
      charged,
      id,
    );
  }
  account(user: string): { topup: number; plan_ends: number } {
    return (
      this.db.get<{ topup: number; plan_ends: number }>(
        "SELECT * FROM ai_accounts WHERE user=?",
        user,
      ) ?? { topup: 0, plan_ends: 0 }
    );
  }
  putAccount(user: string, topup: number, ends: number): void {
    this.db.run(
      "INSERT INTO ai_accounts VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET topup=excluded.topup,plan_ends=excluded.plan_ends",
      user,
      topup,
      ends,
    );
  }
  policy(): AiPolicy {
    return this.db.get<AiPolicy>(
      "SELECT daily,weekly,days FROM ai_policy WHERE id=1",
    )!;
  }
  setPolicy(p: AiPolicy): void {
    this.db.run(
      "UPDATE ai_policy SET daily=?,weekly=?,days=? WHERE id=1",
      p.daily,
      p.weekly,
      p.days,
    );
  }
  usage(
    user: string,
    day: string,
    week: string,
  ): { day: number; week: number } {
    const rows = this.db.all<{
      day: string;
      week: string;
      plan: number;
      charged: number;
      state: string;
    }>(
      "SELECT day,week,plan,charged,state FROM ai_runs WHERE user=? AND (day=? OR week=?)",
      user,
      day,
      week,
    );
    return rows.reduce(
      (a, r) => {
        const n =
          r.state === "queued" || r.state === "running"
            ? r.plan
            : Math.min(r.plan, r.charged);
        return {
          day: a.day + (r.day === day ? n : 0),
          week: a.week + (r.week === week ? n : 0),
        };
      },
      { day: 0, week: 0 },
    );
  }
  ledger(id: string): { fingerprint: string } | undefined {
    return this.db.get("SELECT fingerprint FROM ai_ledger WHERE id=?", id);
  }
  addLedger(
    id: string,
    user: string,
    kind: string,
    amount: number,
    note: string,
    created: number,
    fingerprint = "",
  ): void {
    this.db.run(
      "INSERT INTO ai_ledger VALUES(?,?,?,?,?,?,?)",
      id,
      user,
      kind,
      amount,
      note,
      created,
      fingerprint,
    );
  }
  stats(now: number): AiStats {
    const policy = this.policy();
    return {
      policy,
      topup: this.db.get<{ n: number }>(
        "SELECT coalesce(sum(topup),0) n FROM ai_accounts",
      )!.n,
      planStock:
        this.db.get<{ n: number }>(
          "SELECT count(*) n FROM ai_accounts WHERE plan_ends>?",
          now,
        )!.n * policy.weekly,
      consumed: this.db.get<{ n: number }>(
        "SELECT coalesce(sum(charged),0) n FROM ai_runs",
      )!.n,
      days: this.db
        .all(
          "SELECT day, sum(charged) amount FROM ai_runs GROUP BY day ORDER BY day DESC LIMIT 30",
        )
        .reverse() as AiStats["days"],
      ledger: this.db.all(
        "SELECT id,user,kind,amount,note,created FROM ai_ledger ORDER BY created DESC LIMIT 100",
      ) as AiStats["ledger"],
    };
  }
  files(user: string): FileRecord[] {
    return this.db.all(
      "SELECT * FROM ai_files WHERE user=? ORDER BY path",
      user,
    );
  }
  file(user: string, path: string): FileRecord | undefined {
    return this.db.get(
      "SELECT * FROM ai_files WHERE user=? AND path=?",
      user,
      path,
    );
  }
  putFile(f: FileRecord): void {
    this.db.run(
      "INSERT INTO ai_files VALUES(?,?,?,coalesce(?,zeroblob(0)),?) ON CONFLICT(user,path) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,rev=excluded.rev",
      f.user,
      f.path,
      f.mime,
      f.bytes,
      f.rev,
    );
  }
  deleteFile(user: string, path: string): void {
    this.db.run("DELETE FROM ai_files WHERE user=? AND path=?", user, path);
  }
  text(
    user: string,
    id: string,
  ): { total: number; content: string } | undefined {
    const row = this.db.get<{ total: number; content: string }>(
      "SELECT total,content FROM ai_texts WHERE user=? AND id=?",
      user,
      id,
    );
    return row
      ? { total: row.total, content: JSON.parse(row.content) as string }
      : undefined;
  }
  putText(
    user: string,
    id: string,
    total: number,
    content: string,
    now: number,
  ): void {
    this.db.run(
      "INSERT INTO ai_texts VALUES(?,?,?,?,?) ON CONFLICT(user,id) DO UPDATE SET content=excluded.content,updated=excluded.updated",
      id,
      user,
      total,
      JSON.stringify(content),
      now,
    );
  }
  tool(run: string, call: string): unknown {
    const r = this.db.get<{ result: string }>(
      "SELECT result FROM ai_tools WHERE run=? AND call=?",
      run,
      call,
    );
    return r ? (JSON.parse(r.result) as unknown) : undefined;
  }
  putTool(run: string, call: string, result: unknown): void {
    this.db.run(
      "INSERT INTO ai_tools VALUES(?,?,?)",
      run,
      call,
      JSON.stringify(result),
    );
  }
}

export function messagePreview(m: AiMessage): AiMessage {
  return { ...m, text: m.text.slice(0, 16000), textLength: m.text.length };
}
