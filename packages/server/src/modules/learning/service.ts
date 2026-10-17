import { deflateRawSync } from "node:zlib";
import { AppError, createUlid, toBase64Url, utf8Encode } from "@talos/base";
import {
  applyLearningAnswer,
  emptyLearningProgress,
  learningAnswerSchema,
  LEARNING_CORPUS_LIMIT,
} from "@talos/contract";
import type {
  LearningAnswer,
  LearningCorpus,
  LearningProgress,
  LearningWord,
} from "@talos/contract";
import type { Db } from "../../kernel/persistence/db.ts";
import { migrate } from "../../kernel/persistence/db.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { LearningRepo } from "./repo.ts";
import { learningMigrations } from "./schema.ts";
export interface LearningOptions {
  db: Db;
  uow: Uow;
  now?: () => number;
  id?: () => string;
}
export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
  version: number;
}
export class LearningService {
  readonly repo: LearningRepo;
  private readonly id: () => string;
  constructor(private readonly options: LearningOptions) {
    migrate(options.db, "learning", learningMigrations, options.now);
    this.repo = new LearningRepo(options.db);
    this.id = options.id ?? createUlid({ clock: options.now });
    if (!this.repo.corpus())
      options.uow.write((ctx) => {
        this.repo.putCorpus(this.pack(this.id(), 1, []), ctx.rev);
      });
  }
  import(text: string): ImportResult {
    if (typeof text !== "string" || utf8Encode(text).length > 180 * 1024)
      throw new AppError("E_TOO_LARGE", "请分批导入，每批不超过 180 KiB");
    return this.options.uow.write((ctx) => {
      const words = this.repo.words();
      const existing = new Set(words.map((w) => w[1]));
      let imported = 0,
        skipped = 0;
      for (const entry of text.split("￥")) {
        const record = entry.trim();
        if (!record) continue;
        const split = record.indexOf("#");
        const english = record.slice(0, split).trim();
        const definition = record.slice(split + 1).trim();
        if (
          split < 1 ||
          !english ||
          !definition ||
          english.length > 128 ||
          definition.length > 2000 ||
          existing.has(english)
        ) {
          skipped++;
          continue;
        }
        const word: LearningWord = [this.id(), english, definition];
        this.repo.insert(word);
        words.push(word);
        existing.add(english);
        imported++;
      }
      const previous = this.repo.corpus()!.data as LearningCorpus;
      const version = previous.version + (imported ? 1 : 0);
      if (imported) {
        this.repo.putCorpus(this.pack(previous.id, version, words), ctx.rev);
        ctx.changed("learn", "learningCorpus", previous.id);
      }
      return { imported, skipped, total: words.length, version };
    });
  }
  answer(user: string, input: LearningAnswer): void {
    const parsed = learningAnswerSchema.safeParse(input);
    if (!parsed.success) throw new AppError("E_INVALID", "学习答案无效");
    const answer = parsed.data;
    if (!this.repo.hasWord(answer.word))
      throw new AppError("E_NOT_FOUND", "单词不存在");
    this.options.uow.write((ctx) => {
      const old = this.repo.progress(user, answer.word)?.data as
        LearningProgress | undefined;
      const next = applyLearningAnswer(
        old ?? emptyLearningProgress(answer.word),
        answer,
      );
      if (old && JSON.stringify(old) === JSON.stringify(next)) return;
      this.repo.putProgress(user, next, ctx.rev);
      ctx.changed(`me:${user}`, "learningProgress", answer.word);
    });
  }
  /** Access policy is supplied by api.ts, including corpus scope revocation. */
  registerSync(hub: SyncHub, allowed: (user: string) => boolean): void {
    hub.registerProvider({
      match: (scope) => scope === "learn",
      access: (user, scope) => scope === "learn" && allowed(user),
      list: (user) => (allowed(user) ? ["learn"] : []),
      select: (_scope, since) => {
        const row = this.repo.corpus();
        return row && row.rev > since ? [row] : [];
      },
    });
    hub.registerProvider({
      match: (scope) => scope.startsWith("me:"),
      access: (user, scope) => scope === `me:${user}`,
      list: (user) => [`me:${user}`],
      select: (scope, since, limit) =>
        this.repo.select(scope.slice(3), since, limit),
    });
    hub.registerEntity("learningCorpus", {
      serialize: (row) => row,
      read: (scope, id) => {
        const row = this.repo.corpus();
        return scope === "learn" && row?.id === id ? row : undefined;
      },
    });
    hub.registerEntity("learningProgress", {
      accessNeutral: true,
      serialize: (row) => row,
      read: (scope, id) => this.repo.progress(scope.slice(3), id),
    });
  }
  private pack(
    id: string,
    version: number,
    words: LearningWord[],
  ): LearningCorpus {
    const data = toBase64Url(deflateRawSync(utf8Encode(JSON.stringify(words))));
    if (data.length > LEARNING_CORPUS_LIMIT)
      throw new AppError("E_TOO_LARGE", "词库超过同步容量，本次导入未保存");
    return {
      id,
      version,
      count: words.length,
      encoding: "deflate-json-v1",
      data,
    };
  }
}
