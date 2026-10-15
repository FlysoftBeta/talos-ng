import { AppError } from "@talos/base";
import type { MediaPlaylist, MediaUserState } from "@talos/contract";
import type { AuthorityService } from "../authority/index.ts";
import type { CommunityService } from "../community/index.ts";
import type { MediaService } from "./service.ts";

/** Favourites/queues are references, never independent access grants. */
export class MediaAccess {
  constructor(
    readonly service: MediaService,
    readonly authority: AuthorityService,
    readonly community: CommunityService,
  ) {}
  playlist(user: string, p: MediaPlaylist): boolean {
    if (!this.authority.can(user, "feature.use", { feature: "media" }))
      return false;
    if (p.owner === user) return true;
    const groups = this.community.groups(user);
    return this.authority.repo
      .grants(`coll:${p.id}`)
      .some((g) =>
        g.principal_type === "user"
          ? g.principal === user
          : groups.includes(g.principal),
      );
  }
  track(user: string, id: string, distribute = false): boolean {
    const row = this.service.repo.track(id);
    if (
      !row ||
      row.deleted ||
      !this.authority.can(user, "feature.use", { feature: "media" })
    )
      return false;
    if (
      this.service.options.db.get(
        "SELECT 1 FROM media_discoveries WHERE user_id=? AND track=?",
        user,
        id,
      )
    )
      return true;
    const groups = this.community.groups(user);
    return this.service.repo.playlists().some((row) => {
      const p = JSON.parse(row.body) as MediaPlaylist;
      if (!p.tracks.includes(id)) return false;
      if (p.owner === user) return true;
      return this.authority.repo
        .grants(`coll:${p.id}`)
        .some(
          (g) =>
            (g.principal_type === "user"
              ? g.principal === user
              : groups.includes(g.principal)) &&
            (!distribute ||
              this.service.repo.delegation(
                p.id,
                g.principal_type,
                g.principal,
              )),
        );
    });
  }
  state(user: string): MediaUserState {
    const state = this.service.state(user);
    return {
      ...state,
      queue: state.queue.filter((id) => this.track(user, id)),
      recents: state.recents.filter((id) => this.track(user, id)),
      favorites: Object.fromEntries(
        Object.entries(state.favorites).filter(([id]) => this.track(user, id)),
      ),
    };
  }
  require(user: string, id: string, distribute = false): void {
    if (!this.track(user, id, distribute))
      throw new AppError("E_DENIED", "没有此曲目的访问或转授权限");
  }
  downloadable(user: string, object: string): boolean {
    return this.service.repo
      .tracks()
      .some((row) => row.object_id === object && this.track(user, row.id));
  }
}
