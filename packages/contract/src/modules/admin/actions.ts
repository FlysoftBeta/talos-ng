export const ADMIN_ACTION_ROLES = {
  "admin.user.list": "administrator",
  "admin.user.create": "access_manager",
  "admin.user.profile": "advanced_community_manager",
  "admin.user.credential": "community_manager",
  "admin.user.roles": "root",
  "admin.user.features": "feature_manager",
  "admin.user.restrict": "community_manager",
  "admin.user.remove": "advanced_community_manager",
  "admin.user.purge": "advanced_community_manager",
  "admin.invitation.list": "access_manager",
  "admin.invitation.revoke": "access_manager",
  "admin.invitation.bulkRevoke": "access_manager",
  "admin.device.list": "access_manager",
  "admin.device.update": "access_manager",
  "admin.device.delete": "access_manager",
  "admin.device.policy": "access_manager",
  "admin.group.list": "community_manager",
  "admin.group.edit": "community_manager",
  "admin.group.members": "advanced_community_manager",
  "admin.announcement.list": "advanced_community_manager",
  "admin.announcement.publish": "advanced_community_manager",
  "admin.settings.system": "operations_assistant",
  "admin.settings.media": "community_manager",
  "admin.audit.list": "root",
  "admin.incident.list": "operations",
  "admin.incident.detail": "operations",
  "admin.incident.download": "operations",
  "admin.debug": "root",
  "admin.incident.selfTest": "operations",
} as const;
export type AdminAction = keyof typeof ADMIN_ACTION_ROLES;
export function adminActionRole(
  action: string,
): (typeof ADMIN_ACTION_ROLES)[AdminAction] | undefined {
  return Object.prototype.hasOwnProperty.call(ADMIN_ACTION_ROLES, action)
    ? ADMIN_ACTION_ROLES[action as AdminAction]
    : undefined;
}
