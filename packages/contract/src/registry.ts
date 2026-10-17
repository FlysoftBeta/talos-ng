import { netbooks } from "./modules/netbooks.ts";
import {
  ai,
  aiMethods,
  aiConversation,
  aiMessage,
  aiDraft,
  aiCredit,
} from "./modules/ai.ts";
import {
  library,
  libraryMethods,
  libraryDoc,
  libraryCollection,
  libraryState,
  libraryRetention,
} from "./modules/library.ts";
import { admin, adminMethods } from "./modules/admin/index.ts";
import {
  media,
  mediaMethods,
  mediaTrack,
  mediaPlaylist,
  mediaUserState,
  mediaRetention,
} from "./modules/media.ts";
import { ops, opsMethods } from "./modules/ops.ts";
import type { Method } from "./protocol/definitions.ts";
import { sys } from "./modules/sys.ts";
import { auth } from "./modules/auth.ts";
import { sync } from "./modules/sync.ts";
import { upload } from "./modules/upload.ts";
import { tasks } from "./modules/tasks.ts";
import { me, profile, setting } from "./modules/me/index.ts";
import { authority, grant } from "./modules/authority.ts";
import { identity } from "./modules/identity.ts";
import {
  learning,
  learningCorpus,
  learningProgress,
} from "./modules/learning.ts";
import {
  community,
  communityConversation,
  communityMember,
  communitySelf,
} from "./modules/community.ts";
import { chat } from "./modules/chat.ts";
export const contract = Object.freeze({
  ai,
  netbooks,
  library,
  media,
  sys,
  auth,
  sync,
  upload,
  tasks,
  me,
  identity,
  authority,
  learning,
  community,
  chat,
  ops,
  admin,
});
export const methods = Object.freeze([
  netbooks.search,
  netbooks.download,
  ...aiMethods,
  ...libraryMethods,
  ...mediaMethods,
  ...opsMethods,
  ...adminMethods,
  sys.info,
  sys.time,
  auth.device.register,
  auth.login,
  auth.resume,
  auth.logout,
  auth.lock,
  authority.access.set,
  authority.grant.set,
  identity.invitation.create,
  identity.onboarding.complete,
  identity.profile.update,
  identity.pins.replace,
  sync.pull,
  sync.push,
  upload.begin,
  upload.append,
  upload.commit,
  upload.abort,
  upload.ticket,
  tasks.retry,
  tasks.cancel,
  tasks.clear,
  me.setting.set,
  learning.corpus.import,
  learning.answer.record,
  learning.discipline.assign,
  ...Object.values(community.group),
  community.dm.open,
  chat.post.send,
  chat.post.page,
  chat.post.edit,
  chat.post.delete,
  chat.post.body,
  chat.post.image,
  chat.text.put,
  chat.text.fetch,
  chat.file.fetch,
  chat.sticker.list,
  chat.state.set,
  chat.state.read,
  chat.announcement.ack,
  chat.announcement.publish,
  chat.user.mute,
]);
const registry: Record<string, Method> = Object.create(null) as Record<
  string,
  Method
>;
methods.forEach((method) => {
  registry[method.name] = method;
});
export const methodRegistry: Readonly<Record<string, Method>> =
  Object.freeze(registry);
export const entities = Object.freeze({
  aiConversation,
  aiMessage,
  aiDraft,
  aiCredit,
  libraryDoc,
  libraryCollection,
  libraryState,
  libraryRetention,
  mediaTrack,
  mediaPlaylist,
  mediaUserState,
  mediaRetention,
  profile,
  setting,
  grant,
  job: tasks.job,
  learningCorpus,
  learningProgress,
  communityConversation,
  communityMember,
  communitySelf,
  post: chat.post,
  chatState: chat.state,
  announcement: chat.announcement,
  announcementAck: chat.announcementAck,
});
export const events = Object.freeze({ "sync.delta": sync.delta });
