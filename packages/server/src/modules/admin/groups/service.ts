import { AppError } from "@talos/base";
import type { ArgsOf, contract } from "@talos/contract";
import type { AuditWriter } from "../../../kernel/diagnostics/ports.ts";
import type { CommunityAdmin } from "../../community/ports.ts";

export interface AdminGroupsOptions {
  audit: AuditWriter;
  community: CommunityAdmin;
}
export class AdminGroups {
  constructor(private readonly options: AdminGroupsOptions) {}
  listGroups(input: ArgsOf<typeof contract.admin.group.list>) {
    return this.options.community.adminDirectory.groups(
      input.query ?? "",
      input.offset ?? 0,
      input.limit ?? 50,
    );
  }
  createGroup(
    actor: string,
    input: ArgsOf<typeof contract.admin.group.create>,
  ) {
    const created = this.options.community.create(actor, input);
    this.options.audit.append(actor, "admin.group.create", created.id);
    return { group: this.options.community.adminDirectory.group(created.id)! };
  }
  updateGroup(
    actor: string,
    input: ArgsOf<typeof contract.admin.group.update>,
  ) {
    this.options.community.adminUpdate(input.id, input);
    this.options.audit.append(actor, "admin.group.update", input.id, {
      fields: Object.keys(input).filter((key) => key !== "id"),
    });
    return { group: this.options.community.adminDirectory.group(input.id)! };
  }
  deleteGroup(actor: string, id: string, name: string): void {
    const current = this.options.community.adminDirectory.group(id);
    if (!current) throw new AppError("E_NOT_FOUND", "群组不存在");
    if (current.name !== name)
      throw new AppError("E_CONFLICT", "群组名称不匹配");
    this.options.community.adminDelete(id);
    this.options.audit.append(actor, "admin.group.delete", id, { name });
  }
  groupMembers(id: string) {
    if (!this.options.community.adminDirectory.group(id))
      throw new AppError("E_NOT_FOUND", "群组不存在");
    return this.options.community.members(id);
  }
  changeGroupMember(
    actor: string,
    input: ArgsOf<typeof contract.admin.group.member>,
  ): void {
    this.options.community.adminMember(input.id, input.user, input.operation);
    this.options.audit.append(
      actor,
      `admin.group.member.${input.operation}`,
      input.id,
      { user: input.user },
    );
  }
}
