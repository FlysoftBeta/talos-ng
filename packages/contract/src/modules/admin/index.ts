import { adminAnnouncementMethods } from "./announcements.ts";
import { adminDeviceMethods } from "./devices.ts";
import {
  adminAuditMethods,
  adminIncidentMethods,
  adminPerformanceMethods,
} from "./diagnostics.ts";
import { adminGroupMethods } from "./groups.ts";
import { adminInvitationMethods } from "./invitations.ts";
import { adminSettingsMethods } from "./settings.ts";
import { adminUserMethods } from "./users.ts";

export { adminUserSchema } from "./users.ts";
export type { AdminUser } from "./users.ts";
export { adminDeviceSchema } from "./devices.ts";
export type { AdminDevice } from "./devices.ts";
export { adminGroupSchema } from "./groups.ts";
export type { AdminGroup } from "./groups.ts";
export type { AdminSettings } from "./settings.ts";
export type { AdminPerformance } from "./diagnostics.ts";
export { ADMIN_ACTION_ROLES, adminActionRole } from "./actions.ts";
export type { AdminAction } from "./actions.ts";

export const admin = Object.freeze({
  user: adminUserMethods,
  invitation: adminInvitationMethods,
  device: adminDeviceMethods,
  group: adminGroupMethods,
  announcement: adminAnnouncementMethods,
  settings: adminSettingsMethods,
  audit: adminAuditMethods,
  incident: adminIncidentMethods,
  performance: adminPerformanceMethods,
});
export const adminMethods = Object.freeze([
  admin.user.list,
  admin.user.create,
  admin.user.update,
  admin.user.bulk,
  admin.user.purge,
  admin.invitation.list,
  admin.invitation.revoke,
  admin.invitation.bulkRevoke,
  admin.device.list,
  admin.device.update,
  admin.device.delete,
  admin.device.policy.get,
  admin.device.policy.set,
  admin.group.list,
  admin.group.create,
  admin.group.update,
  admin.group.delete,
  admin.group.members,
  admin.group.member,
  admin.announcement.list,
  admin.announcement.publish,
  admin.settings.get,
  admin.settings.set,
  admin.audit.list,
  admin.incident.report,
  admin.incident.list,
  admin.incident.detail,
  admin.incident.download,
  admin.incident.selfTest,
  admin.performance.get,
]);
