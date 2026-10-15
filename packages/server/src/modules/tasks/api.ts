import { contract } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { TasksService } from "./service.ts";

export function registerTasksApi(host: LinkHost, service: TasksService): void {
  host.register(contract.tasks.retry, (context, args) => {
    service.retry(context.user!, args.id);
    return { ok: true as const };
  });
  host.register(contract.tasks.cancel, (context, args) => {
    service.cancel(context.user!, args.id);
    return { ok: true as const };
  });
  host.register(contract.tasks.clear, (context, args) => {
    service.clear(context.user!, args.id);
    return { ok: true as const };
  });
}
