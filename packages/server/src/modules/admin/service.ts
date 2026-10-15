import { migrate } from "../../kernel/persistence/db.ts";
import type { Db } from "../../kernel/persistence/db.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import type {
  AuditQueries,
  AuditWriter,
} from "../../kernel/diagnostics/ports.ts";
import type { IncidentDiagnostics } from "../../kernel/diagnostics/ports.ts";
import type { Jobs } from "../../kernel/jobs/jobs.ts";
import type { TicketService } from "../../kernel/objects/tickets.ts";
import type { IdentityAdmin } from "../identity/ports.ts";
import type { AuthorityAdmin } from "../authority/ports.ts";
import type { ChatAdmin } from "../chat/ports.ts";
import type { CommunityAdmin } from "../community/ports.ts";
import { adminMigrations } from "./schema.ts";
import { AdminRepo } from "./repo.ts";
import { AdminUsers } from "./users/service.ts";
import { AdminInvitations } from "./invitations/service.ts";
import { AdminDevices } from "./devices/service.ts";
import { AdminPolicy } from "./policy/service.ts";
import { AdminGroups } from "./groups/service.ts";
import { AdminAnnouncements } from "./announcements/service.ts";
import { AdminDiagnostics } from "./diagnostics/service.ts";
export interface AdminOptions {
  db: Db;
  uow: Uow;
  identity: IdentityAdmin;
  authority: AuthorityAdmin;
  chat: ChatAdmin;
  community: CommunityAdmin;
  audit: AuditWriter & AuditQueries;
  incidents: IncidentDiagnostics;
  jobs: Jobs;
  onBanPending?: (user: string, until: number | null) => () => void;
  tickets: TicketService;
  now?: () => number;
  serverLogs?: () => string;
}
export class AdminService {
  readonly repo: AdminRepo;
  readonly users: AdminUsers;
  readonly invitations: AdminInvitations;
  readonly devices: AdminDevices;
  readonly policy: AdminPolicy;
  readonly groups: AdminGroups;
  readonly announcementWorkflow: AdminAnnouncements;
  readonly diagnostics: AdminDiagnostics;
  constructor(options: AdminOptions) {
    const now = options.now ?? Date.now;
    migrate(options.db, "admin", adminMigrations, now);
    this.repo = new AdminRepo(options.db);
    this.policy = new AdminPolicy(options);
    this.users = new AdminUsers(options);
    this.invitations = new AdminInvitations(options);
    this.devices = new AdminDevices({ ...options, policy: this.policy });
    this.groups = new AdminGroups(options);
    this.announcementWorkflow = new AdminAnnouncements(options);
    this.diagnostics = new AdminDiagnostics(options);
  }
  listUsers(
    ...args: Parameters<AdminUsers["listUsers"]>
  ): ReturnType<AdminUsers["listUsers"]> {
    return this.users.listUsers(...args);
  }
  createUser(
    ...args: Parameters<AdminUsers["createUser"]>
  ): ReturnType<AdminUsers["createUser"]> {
    return this.users.createUser(...args);
  }
  updateUser(
    ...args: Parameters<AdminUsers["updateUser"]>
  ): ReturnType<AdminUsers["updateUser"]> {
    return this.users.updateUser(...args);
  }
  bulkUsers(
    ...args: Parameters<AdminUsers["bulkUsers"]>
  ): ReturnType<AdminUsers["bulkUsers"]> {
    return this.users.bulkUsers(...args);
  }
  purgeUser(
    ...args: Parameters<AdminUsers["purgeUser"]>
  ): ReturnType<AdminUsers["purgeUser"]> {
    return this.users.purgeUser(...args);
  }
  listInvitations(
    ...args: Parameters<AdminInvitations["listInvitations"]>
  ): ReturnType<AdminInvitations["listInvitations"]> {
    return this.invitations.listInvitations(...args);
  }
  revokeInvitation(
    ...args: Parameters<AdminInvitations["revokeInvitation"]>
  ): ReturnType<AdminInvitations["revokeInvitation"]> {
    return this.invitations.revokeInvitation(...args);
  }
  bulkRevokeInvitations(
    ...args: Parameters<AdminInvitations["bulkRevokeInvitations"]>
  ): ReturnType<AdminInvitations["bulkRevokeInvitations"]> {
    return this.invitations.bulkRevokeInvitations(...args);
  }
  listDevices(
    ...args: Parameters<AdminDevices["listDevices"]>
  ): ReturnType<AdminDevices["listDevices"]> {
    return this.devices.listDevices(...args);
  }
  updateDevice(
    ...args: Parameters<AdminDevices["updateDevice"]>
  ): ReturnType<AdminDevices["updateDevice"]> {
    return this.devices.updateDevice(...args);
  }
  deleteDevice(
    ...args: Parameters<AdminDevices["deleteDevice"]>
  ): ReturnType<AdminDevices["deleteDevice"]> {
    return this.devices.deleteDevice(...args);
  }
  settings(
    ...args: Parameters<AdminPolicy["settings"]>
  ): ReturnType<AdminPolicy["settings"]> {
    return this.policy.settings(...args);
  }
  setPolicy(
    ...args: Parameters<AdminPolicy["setPolicy"]>
  ): ReturnType<AdminPolicy["setPolicy"]> {
    return this.policy.setPolicy(...args);
  }
  setMediaSettings(
    ...args: Parameters<AdminPolicy["setMediaSettings"]>
  ): ReturnType<AdminPolicy["setMediaSettings"]> {
    return this.policy.setMediaSettings(...args);
  }
  listGroups(
    ...args: Parameters<AdminGroups["listGroups"]>
  ): ReturnType<AdminGroups["listGroups"]> {
    return this.groups.listGroups(...args);
  }
  createGroup(
    ...args: Parameters<AdminGroups["createGroup"]>
  ): ReturnType<AdminGroups["createGroup"]> {
    return this.groups.createGroup(...args);
  }
  updateGroup(
    ...args: Parameters<AdminGroups["updateGroup"]>
  ): ReturnType<AdminGroups["updateGroup"]> {
    return this.groups.updateGroup(...args);
  }
  deleteGroup(
    ...args: Parameters<AdminGroups["deleteGroup"]>
  ): ReturnType<AdminGroups["deleteGroup"]> {
    return this.groups.deleteGroup(...args);
  }
  groupMembers(
    ...args: Parameters<AdminGroups["groupMembers"]>
  ): ReturnType<AdminGroups["groupMembers"]> {
    return this.groups.groupMembers(...args);
  }
  changeGroupMember(
    ...args: Parameters<AdminGroups["changeGroupMember"]>
  ): ReturnType<AdminGroups["changeGroupMember"]> {
    return this.groups.changeGroupMember(...args);
  }
  announcements(
    ...args: Parameters<AdminAnnouncements["announcements"]>
  ): ReturnType<AdminAnnouncements["announcements"]> {
    return this.announcementWorkflow.announcements(...args);
  }
  publishAnnouncement(
    ...args: Parameters<AdminAnnouncements["publishAnnouncement"]>
  ): ReturnType<AdminAnnouncements["publishAnnouncement"]> {
    return this.announcementWorkflow.publishAnnouncement(...args);
  }
  listAudit(
    ...args: Parameters<AdminDiagnostics["listAudit"]>
  ): ReturnType<AdminDiagnostics["listAudit"]> {
    return this.diagnostics.listAudit(...args);
  }
  listIncidents(
    ...args: Parameters<AdminDiagnostics["listIncidents"]>
  ): ReturnType<AdminDiagnostics["listIncidents"]> {
    return this.diagnostics.listIncidents(...args);
  }
  incidentDetail(
    ...args: Parameters<AdminDiagnostics["incidentDetail"]>
  ): ReturnType<AdminDiagnostics["incidentDetail"]> {
    return this.diagnostics.incidentDetail(...args);
  }
  incidentDownload(
    ...args: Parameters<AdminDiagnostics["incidentDownload"]>
  ): ReturnType<AdminDiagnostics["incidentDownload"]> {
    return this.diagnostics.incidentDownload(...args);
  }
  selfTest(
    ...args: Parameters<AdminDiagnostics["selfTest"]>
  ): ReturnType<AdminDiagnostics["selfTest"]> {
    return this.diagnostics.selfTest(...args);
  }
  reportClient(
    ...args: Parameters<AdminDiagnostics["reportClient"]>
  ): ReturnType<AdminDiagnostics["reportClient"]> {
    return this.diagnostics.reportClient(...args);
  }
}
