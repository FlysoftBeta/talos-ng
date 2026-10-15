import type { Kernel } from "./create-application.ts";
import type { LibraryAccess } from "../modules/library/index.ts";
import { MediaAccess } from "../modules/media/index.ts";
export function objectAccess(
  {
    identity,
    uploads,
    authority,
    media,
    community: communityService,
  }: Pick<Kernel, "identity" | "uploads" | "authority" | "media" | "community">,
  libraryAccess: LibraryAccess,
  now: () => number,
  ops: {
    office(objectId: string): boolean;
    backup(user: string, objectId: string, now: number): boolean;
  },
  admin: { downloadable(user: string, objectId: string, now: number): boolean },
): (user: string, objectId: string) => boolean {
  return (user, objectId) =>
    identity.repo.active(user) &&
    (libraryAccess.downloadable(user, objectId) ||
      (authority.can(user, "feature.use", { feature: "media" }) &&
        new MediaAccess(media, authority, communityService).downloadable(
          user,
          objectId,
        )) ||
      uploads.downloadable(user, objectId) ||
      (authority.can(user, "ops.office.download") && ops.office(objectId)) ||
      (authority.can(user, "ops.backup.download") &&
        ops.backup(user, objectId, now())) ||
      (authority.can(user, "admin.incident.download") &&
        admin.downloadable(user, objectId, now())));
}
