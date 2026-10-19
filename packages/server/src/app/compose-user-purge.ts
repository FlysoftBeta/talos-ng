import type { Kernel } from "./create-application.ts";
import { UserPurgeRegistry } from "./user-purge.ts";
import { identityPurge } from "../modules/identity/purge.ts";
import { communityPurge } from "../modules/community/purge.ts";
import { chatPurge } from "../modules/chat/purge.ts";
import { aiPurge } from "../modules/ai/purge.ts";
import { netbooksPurge } from "../modules/netbooks/purge.ts";
import { libraryPurge } from "../modules/library/purge.ts";
import { mediaPurge } from "../modules/media/purge.ts";
import { mePurge } from "../modules/me/purge.ts";
import { authorityPurge } from "../modules/authority/purge.ts";
import { jobsPurge } from "../kernel/jobs/purge.ts";
import { uploadsPurge } from "../kernel/objects/purge.ts";

export function composeUserPurge(
  k: Pick<
    Kernel,
    | "db"
    | "uow"
    | "identity"
    | "authority"
    | "chat"
    | "library"
    | "media"
    | "objects"
    | "uploads"
    | "jobs"
    | "tickets"
  >,
  drainUser: (user: string) => Promise<void>,
): UserPurgeRegistry {
  const {
    db,
    identity,
    authority,
    chat,
    library,
    media,
    objects,
    uploads,
    jobs,
  } = k;
  const registry = new UserPurgeRegistry({
    uow: k.uow,
    identity: identityPurge(db, identity.repo, (user) =>
      k.tickets.revokeUser(user),
    ),
    quiesce: async (user) => {
      await Promise.all([jobs.cancelOwner(user), drainUser(user)]);
      await uploads.quiesce();
    },
  });
  const removeRefs = (kind: string, id: string) =>
    objects.removeOwnerRefs(kind, id);
  const revokeResource = authority.revokeResource.bind(authority);
  registry.register(
    communityPurge(db, {
      membershipChanged: (user, conversation, tx) => {
        chat.membershipChanged(user, conversation, false, tx);
        authority.membershipChanged(user, conversation, tx);
      },
    }),
  );
  registry.register(
    chatPurge(db, { deletePost: (id) => chat.delete(id), removeRefs }),
  );
  registry.register(aiPurge(db));
  registry.register(netbooksPurge(db));
  registry.register(
    libraryPurge(db, {
      deleteDoc: (id) => library.deleteDoc(id),
      deleteCollection: (id) => library.deleteCollection(id, true),
      removeRefs,
      revokeResource,
    }),
  );
  registry.register(
    mediaPurge(db, {
      deletePlaylist: (id) => media.deletePlaylist(id),
      revokeResource,
    }),
  );
  registry.register(mePurge(db));
  registry.register(
    authorityPurge(db, {
      revokePrincipal: authority.revokePrincipal.bind(authority),
    }),
  );
  registry.register(uploadsPurge(uploads));
  registry.register(jobsPurge(db));
  return registry;
}
