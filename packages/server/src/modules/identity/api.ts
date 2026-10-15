import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import { sessionState } from "./sessions/binding.ts";
import type { AuthorityPolicy } from "../authority/ports.ts";
import type { IdentityService } from "./service.ts";
export function registerIdentityApi(
  host: LinkHost,
  service: IdentityService,
  authority: AuthorityPolicy,
): void {
  host.register(contract.auth.device.register, (ctx, args) => {
    if (ctx.device) return { device: ctx.device };
    const device = service.registerDevice(
      args.label,
      remoteIp(ctx.connection.info),
      remoteUserAgent(ctx.connection.info),
    );
    service.bindDevice(ctx.connection, device);
    return { device };
  });
  host.register(contract.auth.login, async (ctx, args) => {
    if (!ctx.device) throw new AppError("E_UNAUTHENTICATED", "设备未注册");
    const result = await service.loginAsync(
      ctx.device,
      args.pin,
      remoteIp(ctx.connection.info),
      remoteUserAgent(ctx.connection.info),
    );
    if ("user" in result) service.bind(ctx.connection, result, ctx.device);
    return result;
  });
  host.register(contract.auth.resume, (ctx, args) => {
    if (!ctx.device) throw new AppError("E_UNAUTHENTICATED", "设备未注册");
    const result = service.resume(
      ctx.device,
      args.token,
      remoteIp(ctx.connection.info),
      remoteUserAgent(ctx.connection.info),
    );
    service.bind(ctx.connection, result, ctx.device);
    return result;
  });
  host.register(contract.auth.logout, (ctx, args) => {
    service.logout(ctx.connection, args.token);
    return { ok: true as const };
  });
  host.register(contract.auth.lock, (ctx) => {
    service.lock(ctx.connection);
    return { ok: true as const };
  });
  host.register(contract.identity.invitation.create, (ctx) => {
    if (!authority.can(ctx.user!, "identity.invitation.create"))
      throw new AppError("E_DENIED", "需要准入管理权限");
    return service.issueInvitation();
  });
  host.register(contract.identity.onboarding.complete, async (ctx, args) => {
    const result = await service.completeOnboarding(
      ctx.device!,
      args,
      remoteIp(ctx.connection.info),
    );
    service.bind(ctx.connection, result, ctx.device!);
    return result;
  });
  host.register(contract.identity.profile.update, (ctx, args) =>
    service.updateProfile(ctx.user!, args),
  );
  host.register(contract.identity.pins.replace, (ctx, args) =>
    service.replacePins(
      ctx.user!,
      ctx.device!,
      sessionState(ctx.connection)?.tokenHash,
      args,
      remoteIp(ctx.connection.info),
    ),
  );
}

function remoteIp(info: unknown): string | undefined {
  return info &&
    typeof info === "object" &&
    "remoteAddress" in info &&
    typeof info.remoteAddress === "string"
    ? info.remoteAddress
    : undefined;
}
function remoteUserAgent(info: unknown): string | undefined {
  if (!info || typeof info !== "object" || !("request" in info))
    return undefined;
  const request = (
    info as {
      request?: { headers?: Record<string, string | string[] | undefined> };
    }
  ).request;
  const header = request?.headers?.["user-agent"];
  return typeof header === "string" ? header : undefined;
}
