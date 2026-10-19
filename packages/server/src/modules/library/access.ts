import { AppError } from "@talos/base";
import type { LibraryCollection, LibraryGrantInput } from "@talos/contract";
import type { AuthorityService } from "../authority/index.ts";
import type { CommunityService } from "../community/index.ts";
import type { LibraryService } from "./service.ts";
export class LibraryAccess {
  constructor(
    readonly service: LibraryService,
    readonly authority: AuthorityService,
    readonly community: CommunityService,
  ) {}
  enabled(user: string): boolean {
    return this.authority.can(user, "feature.use", { feature: "articles" });
  }
  collection(
    user: string,
    id: string,
    level: "read" | "write" | "own" = "read",
  ): boolean {
    const row = this.service.repo.collection(id);
    if (!row || row.deleted) return false;
    const collection = JSON.parse(row.body) as LibraryCollection;
    if (collection.builtin)
      return this.enabled(user) && collection.owner === user;
    return (
      this.enabled(user) &&
      this.authority.can(user, `resource.${level}`, {
        id: `coll:${id}`,
        owner: collection.owner,
      })
    );
  }
  document(user: string, id: string): boolean {
    const row = this.service.repo.doc(id);
    if (!row || row.deleted || !this.enabled(user)) return false;
    if (row.owner === user) return true;
    return this.service.repo
      .collectionsWithItem(id)
      .some(
        (row) =>
          !row.deleted &&
          (JSON.parse(row.body) as LibraryCollection).docs.includes(id) &&
          this.collection(user, row.id),
      );
  }
  /** A queued preference or progress write for a deleted document is moot, not denied. */
  deletedDoc(id: string): boolean {
    return !!this.service.repo.doc(id)?.deleted;
  }
  canDistribute(user: string, id: string): boolean {
    if (!this.document(user, id)) return false;
    if (this.service.document(id).owner === user) return true;
    return this.service.repo
      .collectionsWithItem(id)
      .some(
        (row) =>
          !row.deleted &&
          (JSON.parse(row.body) as LibraryCollection).docs.includes(id) &&
          this.collection(user, row.id) &&
          this.canTransfer(user, row.id),
      );
  }
  canTransfer(user: string, source: string): boolean {
    if (!this.collection(user, source)) return false;
    const collection = this.service.collection(source);
    return collection.owner === user || this.grantLevel(user, source) > 0;
  }
  requireCollection(
    user: string,
    id: string,
    level: "read" | "write" | "own" = "read",
  ): void {
    if (!this.collection(user, id, level))
      throw new AppError("E_DENIED", "没有此书单的访问权限");
  }
  requireDoc(user: string, id: string): void {
    if (!this.document(user, id))
      throw new AppError("E_DENIED", "没有此文档的访问权限");
  }
  downloadable(user: string, object: string): boolean {
    return this.service.repo.docs().some((row) => {
      if (row.deleted) return false;
      const doc = this.service.document(row.id);
      return (
        doc.pack?.id === object &&
        this.document(user, row.id) &&
        this.authority.can(user, "feature.use", {
          feature: doc.kind === "paged" ? "ebook_reader" : "article_reader",
        })
      );
    });
  }
  grantLevel(user: string, id: string): number {
    if (this.service.collection(id).builtin) return 0;
    if (this.collection(user, id, "own")) return 3;
    const groups = this.community.groups(user);
    return this.authority.repo
      .grants(`coll:${id}`)
      .reduce(
        (max, g) =>
          (g.principal_type === "user"
            ? g.principal === user
            : groups.includes(g.principal)) &&
          this.service.repo.delegation(id, g.principal_type, g.principal)
            ? Math.max(max, { read: 1, write: 2, own: 3 }[g.level])
            : max,
        0,
      );
  }
  setGrant(user: string, input: LibraryGrantInput): void {
    this.requireCollection(user, input.collection);
    if (this.service.collection(input.collection).builtin)
      throw new AppError("E_DENIED", "内置书单不能分享");
    const power = this.grantLevel(user, input.collection);
    const requested = input.level
      ? { read: 1, write: 2, own: 3 }[input.level]
      : 3;
    if (!power || requested > power)
      throw new AppError("E_DENIED", "当前权限不能授予此访问级别");
    const collection = this.service.collection(input.collection);
    if (input.principalType === "user" && input.principal === collection.owner)
      throw new AppError("E_DENIED", "不能修改原始所有者的访问权");
    if (
      input.principalType === "user"
        ? !this.authority.repo.actor(input.principal)
        : !this.community.groups(user).includes(input.principal)
    )
      throw new AppError("E_NOT_FOUND", "共享对象不存在或不可见");
    const existing = this.authority.repo
      .grants(`coll:${input.collection}`)
      .find(
        (g) =>
          g.principal_type === input.principalType &&
          g.principal === input.principal,
      );
    if (existing && { read: 1, write: 2, own: 3 }[existing.level] > power)
      throw new AppError("E_DENIED", "不能修改更高权限");
    this.service.options.uow.write((ctx) => {
      this.authority.setGrant({
        resource: `coll:${input.collection}`,
        principalType: input.principalType,
        principal: input.principal,
        level: input.level,
      });
      this.service.repo.delegate(
        input.collection,
        input.principalType,
        input.principal,
        input.level !== null && input.delegate,
      );
      this.service.repo.putCollection(collection, ctx.rev);
      ctx.changed(`coll:${collection.id}`, "libraryCollection", collection.id);
    });
  }
}
