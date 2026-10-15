import { contract } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { NetbooksService } from "./service.ts";
export function registerNetbooksApi(
  host: LinkHost,
  service: NetbooksService,
): void {
  host.register(contract.netbooks.search, (ctx, args, _body, signal) =>
    service.search(ctx.user!, args.query, signal),
  );
  host.register(contract.netbooks.download, (ctx, args) =>
    service.download(ctx.user!, args.book, args.collection),
  );
}
