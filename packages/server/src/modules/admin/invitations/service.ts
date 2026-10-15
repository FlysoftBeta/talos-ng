import { AppError } from "@talos/base";
import type { ArgsOf, contract } from "@talos/contract";
import type { AuditWriter } from "../../../kernel/diagnostics/ports.ts";
import type { IdentityAdmin } from "../../identity/ports.ts";

export interface AdminInvitationsOptions {
  audit: AuditWriter;
  identity: Pick<IdentityAdmin, "directory">;
}
export class AdminInvitations {
  constructor(private readonly options: AdminInvitationsOptions) {}
  listInvitations(input: ArgsOf<typeof contract.admin.invitation.list>) {
    return this.options.identity.directory.invitations(
      input.offset ?? 0,
      input.limit ?? 50,
    );
  }
  revokeInvitation(actor: string, id: string): void {
    if (!this.options.identity.directory.revokeInvitation(id))
      throw new AppError("E_NOT_FOUND", "邀请不存在或已使用");
    this.options.audit.append(actor, "admin.invitation.revoke", id);
  }
  bulkRevokeInvitations(
    actor: string,
    ids: string[],
  ): { results: { id: string; ok: boolean; error?: string }[] } {
    const results = [...new Set(ids)].map((id) => {
      try {
        this.revokeInvitation(actor, id);
        return { id, ok: true };
      } catch (error) {
        return {
          id,
          ok: false,
          error: error instanceof Error ? error.message : "操作失败",
        };
      }
    });
    this.options.audit.append(actor, "admin.invitation.bulkRevoke", null, {
      requested: ids.length,
      succeeded: results.filter((item) => item.ok).length,
    });
    return { results };
  }
}
