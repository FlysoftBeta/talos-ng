import { AppError } from "@talos/base";
import { contract, MAX_HEADER_BYTES } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { TicketService } from "../../kernel/objects/tickets.ts";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { LibraryService } from "./service.ts";
import type { LibraryAccess } from "./access.ts";
import { registerLibrarySync } from "./sync.ts";
export function registerLibraryApi(
  host: LinkHost,
  service: LibraryService,
  access: LibraryAccess,
  tickets: TicketService,
  hub: SyncHub,
): void {
  registerLibrarySync(hub, service, access);
  const enabled = (user: string) => {
    if (!access.enabled(user))
      throw new AppError("E_DENIED", "当前账号未获文库授权");
  };
  const canRead = (user: string, doc: string) => {
    access.requireDoc(user, doc);
    const data = service.document(doc);
    if (
      !access.authority.can(user, "feature.use", {
        feature: data.kind === "paged" ? "ebook_reader" : "article_reader",
      })
    )
      throw new AppError("E_DENIED", "当前账号未获阅读授权");
  };
  const target = (user: string, collection?: string) => {
    enabled(user);
    if (collection) access.requireCollection(user, collection, "write");
  };
  host.register(contract.library.doc.importText, (ctx, args) => {
    target(ctx.user!, args.collection);
    return service.importText(ctx.user!, args);
  });
  host.register(contract.library.doc.importFile, async (ctx, args) => {
    target(ctx.user!, args.collection);
    const uploaded = service.options.uploads.getCommitted(
      ctx.user!,
      args.upload,
    );
    const source = await service.options.store.open(uploaded.id);
    let pdf: boolean;
    try {
      pdf =
        /\.pdf$/i.test(args.name) ||
        Buffer.from(await source.read(0, Math.min(5, source.size))).toString(
          "ascii",
        ) === "%PDF-";
    } finally {
      await source.close();
    }
    if (
      pdf &&
      !access.authority.can(ctx.user!, "feature.use", {
        feature: "ebook_reader",
      })
    )
      throw new AppError("E_DENIED", "当前账号未获 PDF 阅读授权");
    return service.importFile(ctx.user!, args);
  });
  host.register(contract.library.doc.open, async (ctx, args) => {
    canRead(ctx.user!, args.doc);
    const result = await service.open(args.doc);
    // Leave room for the transport envelope and download ticket; large indexes use /dl ranges.
    if (
      Buffer.byteLength(JSON.stringify(result), "utf8") >
      MAX_HEADER_BYTES - 4096
    )
      throw new AppError("E_TOO_LARGE", "文档目录较大，请使用分段下载打开", {
        method: "library.doc.describe",
      });
    return {
      ...result,
      download: tickets.issue({
        objectId: result.pack.id,
        user: ctx.user!,
        filename: `${result.document.title.replace(/[\x00-\x1f\/\\]/g, "_")}.tdp`,
        mime: "application/octet-stream",
      }),
    };
  });
  host.register(contract.library.doc.describe, (ctx, args) => {
    canRead(ctx.user!, args.doc);
    const result = service.describe(args.doc);
    return {
      ...result,
      download: tickets.issue({
        objectId: result.pack.id,
        user: ctx.user!,
        filename: `${result.document.title.replace(/[\x00-\x1f\/\\]/g, "_")}.tdp`,
        mime: "application/octet-stream",
      }),
    };
  });
  host.registerBody(contract.library.doc.fetch, async (ctx, args) => {
    canRead(ctx.user!, args.doc);
    return {
      data: { ok: true as const },
      body: await service.fetch(args.doc, args.rids),
    };
  });
  host.register(contract.library.doc.delete, (ctx, args) => {
    access.requireDoc(ctx.user!, args.doc);
    const doc = service.document(args.doc);
    const actor = access.authority.repo.actor(ctx.user!);
    if (doc.owner !== ctx.user && !actor?.roles.includes("community_manager"))
      throw new AppError("E_DENIED", "只有作者或社区管理员可以删除文档");
    service.deleteDoc(args.doc);
    return { ok: true as const };
  });
  host.register(contract.library.collection.create, (ctx, args) => {
    enabled(ctx.user!);
    if (args.group && !access.community.canPost(ctx.user!, args.group))
      throw new AppError("E_DENIED", "群组不可写入");
    return service.options.uow.write(() => {
      const id = service.createCollection(ctx.user!, args.title, args.group);
      if (args.group)
        access.authority.setGrant({
          resource: `coll:${id}`,
          principalType: "group",
          principal: args.group,
          level: "read",
        });
      return { id };
    });
  });
  host.register(contract.library.collection.items, (ctx, args) => {
    access.requireCollection(ctx.user!, args.collection, "write");
    const previous = service.collection(args.collection).docs;
    args.docs.forEach((id) => {
      access.requireDoc(ctx.user!, id);
      if (!previous.includes(id) && !access.canDistribute(ctx.user!, id))
        throw new AppError("E_DENIED", "此文档没有转授权限，不能加入其他书单");
    });
    service.setItems(args.collection, args.docs);
    return { ok: true as const };
  });
  host.register(contract.library.collection.delete, (ctx, args) => {
    access.requireCollection(ctx.user!, args.collection, "own");
    service.deleteCollection(args.collection);
    return { ok: true as const };
  });
  host.register(contract.library.sharing.principals, (ctx, args) => {
    enabled(ctx.user!);
    const ids = new Set([ctx.user!]);
    for (const conv of access.community.conversations(ctx.user!))
      for (const member of access.community.visibleMembers(ctx.user!, conv.id)
        .members)
        ids.add(member.user);
    const principals = [
      ...Array.from(ids)
        .map((id) => access.authority.repo.actor(id))
        .filter((user) => user !== undefined)
        .map((user) => ({
          id: user.id,
          type: "user" as const,
          name: user.name,
        })),
      ...access.community
        .conversations(ctx.user!)
        .filter((conv) => conv.kind === "group")
        .map((conv) => ({
          id: conv.id,
          type: "group" as const,
          name: conv.name,
        })),
    ];
    return {
      principals: principals.filter(
        (p) => !args.query || p.name.includes(args.query),
      ),
    };
  });
  host.register(contract.library.sharing.list, (ctx, args) => {
    access.requireCollection(ctx.user!, args.collection);
    return {
      grants: access.authority.repo
        .grants(`coll:${args.collection}`)
        .map((g) => ({
          id: g.id,
          principalType: g.principal_type,
          principal: g.principal,
          level: g.level,
          delegate: service.repo.delegation(
            args.collection,
            g.principal_type,
            g.principal,
          ),
        })),
      canShare: access.grantLevel(ctx.user!, args.collection) > 0,
    };
  });
  host.register(contract.library.sharing.set, (ctx, args) => {
    access.setGrant(ctx.user!, args);
    return { ok: true as const };
  });
  host.register(contract.library.favourite.set, (ctx, args) => {
    access.requireDoc(ctx.user!, args.doc);
    service.preference(ctx.user!, args.doc, "favourite", args.value);
    return { ok: true as const };
  });
  host.register(contract.library.retention.set, (ctx, args) => {
    access.requireDoc(ctx.user!, args.doc);
    if (!access.authority.can(ctx.user!, "feature.use", { feature: "offline" }))
      throw new AppError("E_DENIED", "当前账号未获离线授权");
    service.preference(ctx.user!, args.doc, "retention", args.value);
    return { ok: true as const };
  });
  host.register(contract.library.progress.set, (ctx, args) => {
    canRead(ctx.user!, args.doc);
    if (args.device !== ctx.device)
      throw new AppError("E_INVALID", "阅读设备标识无效");
    service.progress(ctx.user!, args);
    return { ok: true as const };
  });
}
