import type { UserPurgeParticipant } from "../persistence/user-purge.ts";
import type { UploadService } from "./uploads.ts";
export function uploadsPurge(uploads: UploadService): UserPurgeParticipant {
  return { owner: "uploads", purgeUser: (user) => uploads.purgeUser(user) };
}
