import type { CancellationSignal } from "@talos/base";
import { AppError, sleep, utf8Encode } from "@talos/base";
import type { Netbook } from "@talos/contract";
import { migrate } from "../../kernel/persistence/db.ts";
import type { Db } from "../../kernel/persistence/db.ts";
import type { JobContext } from "../../kernel/jobs/jobs.ts";
import type { JobCommands } from "../../kernel/jobs/ports.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import type { LibraryAccess } from "../library/index.ts";
import type { LibraryPublication } from "../library/ports.ts";
import type { NetbooksProvider, Catalog } from "./provider.ts";
import { NetbooksRepo } from "./repo.ts";
import { netbooksMigrations } from "./schema.ts";
export interface NetbooksOptions {
  db: Db;
  uow: Uow;
  jobs: JobCommands;
  library: LibraryPublication;
  access: LibraryAccess;
  provider: NetbooksProvider;
  now?: () => number;
  wait?: (ms: number, signal: CancellationSignal) => Promise<void>;
  paceMs?: number;
}
export class NetbooksService {
  readonly repo: NetbooksRepo;
  private readonly now: () => number;
  private readonly wait: (
    ms: number,
    signal: CancellationSignal,
  ) => Promise<void>;
  private searchAt = 0;
  private searching = false;
  constructor(readonly options: NetbooksOptions) {
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? sleep;
    migrate(options.db, "netbooks", netbooksMigrations, this.now);
    this.repo = new NetbooksRepo(options.db);
    options.jobs.register("netbooks.download", {
      concurrency: 1,
      timeoutMs: 24 * 60 * 60 * 1000,
      onBoot: "requeue",
      retryable: true,
      run: (ctx) => this.run(ctx),
    });
  }
  /** Called inside library deletion's transaction by the application composition. */
  removeDocument(id: string): { job: string; user_id: string }[] {
    return this.repo.removeForDocument(id);
  }
  removeCollection(id: string): { job: string; user_id: string }[] {
    return this.repo.removeForCollection(id);
  }
  require(user: string, collection?: string): void {
    if (
      !this.options.access.authority.can(user, "feature.use", {
        feature: "article_download",
      })
    )
      throw new AppError("E_DENIED", "当前账号未获网络书籍下载授权");
    if (collection)
      this.options.access.requireCollection(user, collection, "write");
  }
  async search(
    user: string,
    query: string,
    signal?: CancellationSignal,
  ): Promise<{ books: Netbook[]; retryAt: number; serverTime: number }> {
    this.require(user);
    const now = this.now();
    if (this.searching || now < this.searchAt)
      throw new AppError("E_BUSY", "搜索繁忙，请稍后重试", {
        retryAt: Math.max(this.searchAt, now + 5000),
        serverTime: now,
      });
    this.searchAt = now + 5000;
    this.searching = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort);
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 20000);
    try {
      const books = await this.options.provider.search(
        query,
        controller.signal,
      );
      return {
        books: books.slice(0, 20).map((b) => ({
          ...b,
          abstract:
            b.abstract.length > 80 ? b.abstract.slice(0, 80) + "…" : b.abstract,
        })),
        retryAt: this.searchAt,
        serverTime: this.now(),
      };
    } catch (e) {
      if (e instanceof AppError && e.code === "E_BUSY") {
        const d = e.data as { retryAt?: number } | undefined;
        this.searchAt = Math.max(
          this.searchAt,
          d?.retryAt ?? this.now() + 5000,
        );
        throw new AppError("E_BUSY", e.message, {
          retryAt: this.searchAt,
          serverTime: this.now(),
        });
      }
      throw e;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      this.searching = false;
    }
  }
  download(
    user: string,
    book: string,
    collection: string,
  ): { job: string; joined: boolean } {
    this.require(user, collection);
    return this.options.uow.write(() => {
      const active = new Set(
        this.options.jobs
          .activeJobs("netbooks.download", user)
          .map((job) => job.id),
      );
      const existing = this.repo
        .downloads(user, book, collection)
        .find((row) => active.has(row.job));
      if (existing) return { job: existing.job, joined: true };
      const job = this.options.jobs.enqueue(user, "netbooks.download", {
        book,
        collection,
        title: "网络书籍下载",
      });
      this.repo.insert(job.id, user, book, collection);
      return { job: job.id, joined: false };
    });
  }
  private async attempt<T>(
    fn: () => Promise<T>,
    signal: CancellationSignal,
  ): Promise<T> {
    for (let n = 0; ; n++) {
      if (signal.aborted) throw new AppError("E_CANCELLED", "下载已停止");
      try {
        return await fn();
      } catch (e) {
        if (signal.aborted) throw new AppError("E_CANCELLED", "下载已停止");
        if (
          !(e instanceof AppError) ||
          !["E_BUSY", "E_UNAVAILABLE", "E_TIMEOUT"].includes(e.code) ||
          n >= 4
        )
          throw e;
        const data = e.data as { retryAt?: number } | undefined;
        await this.wait(
          Math.max(800 * 2 ** n, (data?.retryAt ?? 0) - this.now()),
          signal,
        );
      }
    }
  }
  private async run(ctx: JobContext): Promise<{ doc: string }> {
    const row = this.repo.get(ctx.id);
    if (!row) throw new AppError("E_NOT_FOUND", "下载记录不存在");
    this.require(ctx.owner, row.collection);
    if (row.document) return { doc: row.document };
    const catalog: Catalog = row.catalog
      ? (JSON.parse(row.catalog) as Catalog)
      : await this.attempt(
          () => this.options.provider.catalog(row.book, ctx.signal),
          ctx.signal,
        );
    if (!catalog.chapters.length || catalog.chapters.length > 20000)
      throw new AppError("E_INVALID", "书籍目录为空或过大");
    this.repo.catalog(ctx.id, catalog);
    const parts: string[] = [];
    let size = 0;
    for (let i = 0; i < catalog.chapters.length; i++) {
      this.require(ctx.owner, row.collection);
      if (ctx.signal.aborted) throw new AppError("E_CANCELLED", "下载已停止");
      const chapter = catalog.chapters[i]!;
      let body = this.repo.chapter(ctx.id, i);
      if (body === undefined) {
        await this.wait(this.options.paceMs ?? 500, ctx.signal);
        body = await this.attempt(
          () => this.options.provider.chapter(chapter.id, ctx.signal),
          ctx.signal,
        );
        if (!body.trim()) throw new AppError("E_UNAVAILABLE", "章节正文为空");
        if (ctx.signal.aborted) throw new AppError("E_CANCELLED", "下载已停止");
        this.repo.save(ctx.id, i, body);
      }
      const part = chapter.title + "\n" + body + "\n\n";
      size += utf8Encode(part).length;
      if (size > 200 * 1024 * 1024)
        throw new AppError("E_TOO_LARGE", "书籍超过 200 MiB");
      parts.push(part);
      ctx.progress(
        (i + 1) / (catalog.chapters.length + 1),
        `下载 ${catalog.title} · ${i + 1}/${catalog.chapters.length}`,
      );
    }
    this.require(ctx.owner, row.collection);
    const result = await this.options.library.importGeneratedText(
      ctx.owner,
      {
        title: catalog.title.slice(0, 200),
        body: parts.join(""),
        collection: row.collection,
      },
      (doc) => {
        this.require(ctx.owner, row.collection);
        // A task retry can race a newer request; publish to all currently active requests
        // while still inside the library's synchronous publication UoW.
        const active = new Set(
          this.options.jobs
            .activeJobs("netbooks.download", ctx.owner)
            .map((job) => job.id),
        );
        for (const download of this.repo.downloads(
          ctx.owner,
          row.book,
          row.collection,
        ))
          if (active.has(download.job)) this.repo.publish(download.job, doc);
        this.repo.clearPublishedChapters(
          ctx.owner,
          row.book,
          row.collection,
          doc,
        );
      },
      ctx.signal,
    );
    return { doc: result.doc };
  }
}
