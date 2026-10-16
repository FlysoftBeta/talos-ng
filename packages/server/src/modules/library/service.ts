import { MAX_FUTURE_SKEW_MS } from "@talos/contract";
import type { CancellationSignal } from "@talos/base";
import { AppError, HybridClock, createUlid, utf8Encode } from "@talos/base";
import { emptyLibraryState, applyLibraryProgress } from "@talos/contract";
import type {
  LibraryRetention,
  LibraryDoc,
  LibraryCollection,
  LibraryState,
  LibraryProgressInput,
} from "@talos/contract";
import { PackReader, encodeResourceBatch } from "@talos/docpack";
import type { ConverterRegistry } from "@talos/docpipe";
import type { ObjectStore } from "@talos/objectstore";
import { clampFutureStamp, lwwMerge } from "@talos/sync";
import type { Db } from "../../kernel/persistence/db.ts";
import { migrate } from "../../kernel/persistence/db.ts";
import type { Uow, WriteContext } from "../../kernel/persistence/uow.ts";
import type { Jobs } from "../../kernel/jobs/jobs.ts";
import type { ObjectLedger } from "../../kernel/objects/objects.ts";
import type { UploadService } from "../../kernel/objects/uploads.ts";
import { LibraryRepo } from "./repo.ts";
import { libraryMigrations } from "./schema.ts";
import { convertObject, defaultConverters } from "./conversion.ts";
export interface LibraryOptions {
  db: Db;
  uow: Uow;
  store: ObjectStore;
  objects: ObjectLedger;
  uploads: UploadService;
  jobs: Jobs;
  now?: () => number;
  id?: () => string;
  converters?: ConverterRegistry;
  onDeleteDocument?: (id: string, tx: WriteContext) => void;
  onDeleteCollection?: (id: string, tx: WriteContext) => void;
}
export class LibraryService {
  readonly repo: LibraryRepo;
  private readonly now: () => number;
  private readonly id: () => string;
  constructor(readonly options: LibraryOptions) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? createUlid({ clock: this.now });
    migrate(options.db, "library", libraryMigrations, this.now);
    this.repo = new LibraryRepo(options.db);
    const converters = options.converters ?? defaultConverters();
    options.jobs.register("library.convert", {
      concurrency: 1,
      timeoutMs: 30 * 60 * 1000,
      onBoot: "requeue",
      retryable: true,
      run: async (ctx) => {
        const payload = ctx.payload as { doc: string };
        const row = this.repo.doc(payload.doc);
        if (!row || row.deleted)
          throw new AppError("E_NOT_FOUND", "文档已删除");
        const doc = JSON.parse(row.body) as LibraryDoc;
        if (doc.status === "ready") return { doc: doc.id };
        let metadata:
          { kind: "flow" | "paged"; units: number; chars: number } | undefined;
        const stage = await convertObject(
          options.store,
          converters,
          row.source!,
          row.filename!,
          ctx,
        );
        await options.objects.publish(
          async () => {
            if (ctx.signal.aborted) {
              await stage.abort();
              throw new AppError("E_CANCELLED", "文档转换已取消");
            }
            const info = await stage.commit();
            const source = await options.store.open(info.id);
            try {
              const manifest = (await PackReader.open(source)).manifest;
              metadata = {
                kind: manifest.kind,
                units: manifest.units.length,
                chars: manifest.units.reduce((n, u) => n + (u.chars ?? 0), 0),
              };
            } finally {
              await source.close();
            }
            return info;
          },
          (info) => {
            const current = this.repo.doc(doc.id);
            if (!current || current.deleted)
              throw new AppError("E_NOT_FOUND", "文档已删除");
            if (ctx.signal.aborted)
              throw new AppError("E_CANCELLED", "文档转换已取消");
            options.objects.addRef(info.id, "library.pack", doc.id);
            const write = options.uow.current!;
            this.repo.putDoc(
              { ...doc, ...metadata!, status: "ready", pack: info },
              row.source!,
              row.filename!,
              write.rev,
            );
            this.changedDoc(doc.id, doc.owner, write.changed);
          },
        );
        return { doc: doc.id };
      },
    });
  }
  document(id: string): LibraryDoc {
    const row = this.repo.doc(id);
    if (!row || row.deleted) throw new AppError("E_NOT_FOUND", "文档不存在");
    return JSON.parse(row.body) as LibraryDoc;
  }
  collection(id: string): LibraryCollection {
    const row = this.repo.collection(id);
    if (!row || row.deleted) throw new AppError("E_NOT_FOUND", "书单不存在");
    return JSON.parse(row.body) as LibraryCollection;
  }
  /** Idempotent provisioning, before a sync snapshot or an import transaction. */
  ensureBuiltins(user: string): { shelf: string; favourites: string } {
    const find = (kind: "shelf" | "favourites") =>
      this.repo
        .ownedCollections(user)
        .filter((row) => !row.deleted)
        .map((row) => JSON.parse(row.body) as LibraryCollection)
        .find((collection) => collection.builtin === kind)?.id;
    const shelf = find("shelf"),
      favourites = find("favourites");
    if (shelf && favourites) return { shelf, favourites };
    return this.options.uow.write((ctx) => {
      const create = (builtin: "shelf" | "favourites", title: string) => {
        const id = this.id();
        this.repo.putCollection(
          { id, owner: user, title, group: null, docs: [], builtin },
          ctx.rev,
        );
        ctx.changed(`me:${user}`, "libraryCollection", id);
        return id;
      };
      return {
        shelf: shelf ?? create("shelf", "我的书架"),
        favourites: favourites ?? create("favourites", "我的收藏"),
      };
    });
  }
  createCollection(user: string, title: string, group?: string): string {
    return this.options.uow.write((ctx) => {
      const id = this.id();
      this.repo.putCollection(
        { id, title, owner: user, group: group ?? null, docs: [] },
        ctx.rev,
      );
      ctx.changed(`coll:${id}`, "libraryCollection", id);
      ctx.changed(`me:${user}`, "libraryCollection", id);
      return id;
    });
  }
  setItems(id: string, docs: string[]): void {
    const collection = this.collection(id);
    if (new Set(docs).size !== docs.length)
      throw new AppError("E_INVALID", "书单不能包含重复文档");
    if (docs.length > 1000)
      throw new AppError("E_TOO_LARGE", "书单最多包含 1000 份文档");
    docs.forEach((doc) => this.document(doc));
    this.options.uow.write((ctx) => {
      this.repo.putCollection({ ...collection, docs }, ctx.rev);
      this.repo.replaceItems(id, docs, ctx.rev);
      ctx.changed(`coll:${id}`, "libraryCollection", id);
      ctx.changed(`me:${collection.owner}`, "libraryCollection", id);
      for (const doc of new Set([...collection.docs, ...docs])) {
        ctx.changed(`coll:${id}`, "libraryDoc", doc);
      }
      if (collection.builtin === "favourites") {
        for (const doc of new Set([...collection.docs, ...docs])) {
          if (this.repo.doc(doc)?.deleted) continue;
          const state = this.state(collection.owner, doc);
          const included = docs.includes(doc);
          if (!!state.favourite?.v !== included) {
            const clock = new HybridClock(this.now);
            state.favourite = {
              v: included,
              t: state.favourite
                ? clock.observe(state.favourite.t)
                : clock.now(),
              op: this.id(),
            };
            this.writeState(collection.owner, state);
          }
        }
      }
      for (const doc of collection.docs) {
        if (
          !docs.includes(doc) &&
          !this.repo.hasContainer(doc) &&
          !this.repo.doc(doc)?.deleted
        )
          this.deleteDoc(doc);
      }
    });
  }
  deleteCollection(id: string, purging = false): void {
    const collection = this.collection(id);
    if (collection.builtin && !purging)
      throw new AppError("E_DENIED", "内置书单不能删除");
    this.options.uow.write((ctx) => {
      this.setItems(id, []);
      this.repo.putCollection({ ...collection, docs: [] }, ctx.rev, true);
      this.repo.clearDelegations(id);
      this.options.onDeleteCollection?.(id, ctx);
      ctx.changed(`coll:${id}`, "libraryCollection", id);
      ctx.changed(`me:${collection.owner}`, "libraryCollection", id);
    });
  }
  async importText(
    user: string,
    args: { title: string; body: string; collection?: string },
    authorize: () => void = () => {},
  ): Promise<{ doc: string; job: string }> {
    const bytes = utf8Encode(args.body);
    if (!args.body.trim() || bytes.length > 512 * 1024)
      throw new AppError("E_INVALID", "文本为空或超过 512 KiB");
    let result: { doc: string; job: string } | undefined;
    await this.options.objects.publish(
      () => this.options.store.put(bytes),
      (info) => {
        authorize();
        result = this.insert(
          user,
          args.title,
          info.id,
          `${args.title}.txt`,
          args.collection,
        );
      },
    );
    return result!;
  }
  /** Server-generated text shares the document publication transaction. */
  async importGeneratedText(
    user: string,
    args: { title: string; body: string; collection: string },
    published: (doc: string) => void,
    signal: CancellationSignal,
  ): Promise<{ doc: string; job: string }> {
    const bytes = utf8Encode(args.body);
    if (!bytes.length || bytes.length > 200 * 1024 * 1024)
      throw new AppError("E_TOO_LARGE", "书籍为空或超过 200 MiB");
    let result: { doc: string; job: string } | undefined;
    await this.options.objects.publish(
      () => this.options.store.put(bytes),
      (info) => {
        if (signal.aborted) throw new AppError("E_CANCELLED", "下载已停止");
        result = this.insert(
          user,
          args.title,
          info.id,
          `${args.title}.txt`,
          args.collection,
        );
        published(result.doc);
      },
    );
    return result!;
  }
  importFile(
    user: string,
    args: { title: string; name: string; upload: string; collection?: string },
  ): { doc: string; job: string } {
    const source = this.options.uploads.getCommitted(user, args.upload);
    if (source.size > 200 * 1024 * 1024 || source.size === 0)
      throw new AppError("E_TOO_LARGE", "文件必须大于 0 且不超过 200 MiB");
    return this.options.uow.write(() => {
      const result = this.insert(
        user,
        args.title,
        source.id,
        args.name,
        args.collection,
      );
      this.options.uploads.claim(
        user,
        args.upload,
        "library.source",
        result.doc,
      );
      return result;
    });
  }
  private insert(
    user: string,
    title: string,
    source: string,
    filename: string,
    collection?: string,
  ): { doc: string; job: string } {
    return this.options.uow.write((ctx) => {
      const id = this.id();
      const doc: LibraryDoc = {
        id,
        title,
        owner: user,
        created: this.now(),
        kind: null,
        status: "processing",
        pack: null,
        units: 0,
        chars: 0,
      };
      this.repo.putDoc(doc, source, filename, ctx.rev);
      this.options.objects.addRef(source, "library.source", id);
      const target = collection ?? this.ensureBuiltins(user).shelf;
      this.setItems(target, [...this.collection(target).docs, id]);
      ctx.changed(`me:${user}`, "libraryDoc", id);
      const job = this.options.jobs.enqueue(user, "library.convert", {
        doc: id,
        title,
      });
      return { doc: id, job: job.id };
    });
  }
  describe(id: string): {
    document: LibraryDoc;
    pack: { id: string; size: number };
  } {
    const document = this.document(id);
    if (!document.pack)
      throw new AppError("E_BUSY", "文档正在转换，请查看任务");
    return { document, pack: document.pack };
  }
  async open(id: string): Promise<{
    document: LibraryDoc;
    manifest: ReturnType<PackReader["clientManifest"]>;
    pack: { id: string; size: number };
  }> {
    const { document, pack } = this.describe(id);
    const source = await this.options.store.open(pack.id);
    try {
      return {
        document,
        manifest: (await PackReader.open(source)).clientManifest(),
        pack,
      };
    } finally {
      await source.close();
    }
  }
  async fetch(id: string, rids: string[]): Promise<Uint8Array> {
    const doc = this.document(id);
    if (!doc.pack) throw new AppError("E_BUSY", "文档正在转换");
    const source = await this.options.store.open(doc.pack.id);
    try {
      const reader = await PackReader.open(source);
      const resources = reader.manifest.resources;
      let size = 0;
      for (const rid of rids) {
        const resource = resources[rid];
        if (!resource) throw new AppError("E_NOT_FOUND", "资源不存在");
        size += 37 + resource.stored;
        if (size > 512 * 1024)
          throw new AppError("E_TOO_LARGE", "请使用分段下载获取大资源");
      }
      return encodeResourceBatch(
        await Promise.all(
          rids.map(async (rid) => ({
            rid,
            enc: resources[rid]!.enc,
            bytes: await reader.readStored(rid),
          })),
        ),
      );
    } finally {
      await source.close();
    }
  }
  deleteDoc(id: string): void {
    const row = this.repo.doc(id);
    const doc = this.document(id);
    this.options.uow.write((ctx) => {
      this.repo.putDoc(doc, row!.source!, row!.filename!, ctx.rev, true);
      this.options.onDeleteDocument?.(id, ctx);
      for (const user of this.repo.deleteStates(id, ctx.rev))
        ctx.changed(`me:${user}`, "libraryState", id);
      for (const job of this.options.jobs.list(doc.owner)) {
        if (
          !job.deleted &&
          job.kind === "library.convert" &&
          (job.payload as { doc?: string }).doc === id
        ) {
          this.options.jobs.cancel(doc.owner, job.id);
          this.options.jobs.clear(doc.owner, job.id);
        }
      }
      this.options.objects.removeRef(row!.source!, "library.source", id);
      if (doc.pack)
        this.options.objects.removeRef(doc.pack.id, "library.pack", id);
      for (const collection of this.repo.collections()) {
        const data = JSON.parse(collection.body) as LibraryCollection;
        if (!collection.deleted && data.docs.includes(id))
          this.setItems(
            data.id,
            data.docs.filter((d) => d !== id),
          );
      }
      this.changedDoc(id, doc.owner, ctx.changed);
      ctx.afterCommit(async () => {
        await this.options.objects.reclaim([
          row!.source!,
          ...(doc.pack ? [doc.pack.id] : []),
        ]);
      });
    });
  }
  retention(
    user: string,
    kind: LibraryRetention["kind"],
    id: string,
  ): LibraryRetention {
    return (
      this.repo.retention(user, id) ?? { id, kind, value: null, lastUsed: 0 }
    );
  }
  setRetention(
    user: string,
    kind: LibraryRetention["kind"],
    id: string,
    value: NonNullable<LibraryRetention["value"]>,
  ): void {
    const state = this.retention(user, kind, id);
    const next = {
      ...value,
      t: clampFutureStamp(value.t, this.now(), MAX_FUTURE_SKEW_MS).stamp,
    };
    this.writeRetention(user, {
      ...state,
      value: state.value ? lwwMerge(state.value, next) : next,
    });
  }
  recordUse(
    user: string,
    kind: LibraryRetention["kind"],
    id: string,
    ms: number,
  ): void {
    const state = this.retention(user, kind, id);
    this.writeRetention(user, {
      ...state,
      lastUsed: Math.max(
        state.lastUsed,
        Math.min(ms, this.now() + MAX_FUTURE_SKEW_MS),
      ),
    });
  }
  private writeRetention(user: string, state: LibraryRetention): void {
    this.options.uow.write((ctx) => {
      this.repo.putRetention(user, state, ctx.rev);
      ctx.changed(`me:${user}`, "libraryRetention", state.id);
    });
  }
  state(user: string, doc: string): LibraryState {
    const row = this.repo.state(user, doc);
    return row && !row.deleted
      ? (JSON.parse(row.body) as LibraryState)
      : emptyLibraryState(doc);
  }
  progress(user: string, input: LibraryProgressInput): void {
    this.document(input.doc);
    this.options.uow.write(() => {
      this.recordUse(user, "doc", input.doc, input.resume.t.ms);
      this.writeState(
        user,
        applyLibraryProgress(this.state(user, input.doc), input),
      );
    });
  }
  preference(
    user: string,
    id: string,
    key: "favourite",
    value: NonNullable<LibraryState["favourite"]>,
  ): void {
    this.document(id);
    const state = this.state(user, id);
    state.favourite = state.favourite
      ? lwwMerge(state.favourite, value)
      : value;
    this.options.uow.write(() => {
      this.writeState(user, state);
      if (key === "favourite") {
        const collection = this.collection(
          this.ensureBuiltins(user).favourites,
        );
        const included = !!state.favourite?.v;
        if (collection.docs.includes(id) !== included)
          this.setItems(
            collection.id,
            included
              ? [...collection.docs, id]
              : collection.docs.filter((doc) => doc !== id),
          );
      }
    });
  }
  private writeState(user: string, state: LibraryState): void {
    this.options.uow.write((ctx) => {
      this.repo.putState(user, state, ctx.rev);
      ctx.changed(`me:${user}`, "libraryState", state.id);
    });
  }
  private changedDoc(
    id: string,
    owner: string,
    changed: (scope: string, type: string, id: string) => void,
  ): void {
    changed(`me:${owner}`, "libraryDoc", id);
    for (const row of this.repo.collections()) {
      const collection = JSON.parse(row.body) as LibraryCollection;
      if (!row.deleted && collection.docs.includes(id))
        changed(`coll:${collection.id}`, "libraryDoc", id);
    }
  }
}
