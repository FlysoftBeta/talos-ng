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
  /**
   * Playlists the user may open. Access needs ownership or a grant, so only
   * owned and granted playlists are candidates (newest revision first).
   */
  playlists(user: string): MediaPlaylist[] {
    return this.service.repo
      .playlistsFor(
        user,
        this.authority
          .grantedResources(user, "coll:")
          .map((resource) => resource.slice(5)),
      )
      .sort((a, b) => b.rev - a.rev || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => JSON.parse(row.body) as MediaPlaylist)
      .filter((p) => this.playlist(user, p));
  }
  track(user: string, id: string): boolean {
    const row = this.service.repo.track(id);
    return (
      !!row &&
      !row.deleted &&
      this.authority.can(user, "feature.use", { feature: "media" }) &&
      (this.service.repo.discovered(user, id) ||
        this.service.repo.playlists().some((row) => {
          const p = JSON.parse(row.body) as MediaPlaylist;
          return p.tracks.includes(id) && this.playlist(user, p);
        }))
    );
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
  require(user: string, id: string): void {
    if (!this.track(user, id))
      throw new AppError("E_DENIED", "没有此曲目的访问权限");
  }
  downloadable(user: string, object: string): boolean {
    return this.service.repo
      .tracks()
      .some((row) => row.object_id === object && this.track(user, row.id));
  }
}
