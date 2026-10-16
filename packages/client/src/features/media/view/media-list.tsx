import type { ReactElement } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import { Field, SearchField } from "../../../ui/inputs/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import type { IconName } from "../../../ui/icon/icon.tsx";
import {
  Pane,
  PaneBody,
  PaneHeader,
  PaneTools,
  SectionHeader,
} from "../../../ui/layout/index.ts";
import { ListRow, StatePanel } from "../../../ui/feedback/index.ts";
import "./media.css";

export type MediaSourceId = "recent" | "favorite" | "search";
const sources: Record<MediaSourceId, { title: string; icon: IconName }> = {
  recent: { title: "最近", icon: "history" },
  favorite: { title: "收藏", icon: "heart" },
  search: { title: "搜索结果", icon: "search" },
};
export const sourceTitle = (id: MediaSourceId): string => sources[id].title;

export interface PlaylistRowView {
  id: string;
  title: string;
  hint: string;
  selected: boolean;
}
/** The 36 px leading tile of playlist rows and the player cover. */
export function MediaTile({
  icon = "list",
  size = 36,
}: {
  icon?: IconName;
  size?: 36 | 48;
}): ReactElement {
  return (
    <span className={`media-tile media-tile-${size}`} aria-hidden="true">
      <Icon name={icon} size={size === 48 ? 22 : 18} />
    </span>
  );
}
export function MediaListView({
  query,
  onQuery,
  onSearch,
  searchDisabled,
  searchReason,
  source,
  counts,
  searched,
  onSource,
  playlists,
  playlistsState,
  createReason,
  onCreate,
  onOpenPlaylist,
  creating,
}: {
  query: string;
  onQuery(value: string): void;
  onSearch(): void;
  searchDisabled: boolean;
  searchReason: string | undefined;
  /** The selected source, or undefined while a playlist is open. */
  source: MediaSourceId | undefined;
  counts: Record<MediaSourceId, number>;
  /** A search ran: the 搜索结果 entry is listed. */
  searched: boolean;
  onSource(id: MediaSourceId): void;
  playlists: readonly PlaylistRowView[];
  /** Shown when there are no playlists. */
  playlistsState: "offline" | "empty" | "loading";
  createReason: string | undefined;
  onCreate(): void;
  onOpenPlaylist(id: string): void;
  creating:
    | {
        title: string;
        onTitle(value: string): void;
        canCreate: boolean;
        /** Why the last attempt failed. */
        error: string;
        onCreate(): void;
        onClose(): void;
      }
    | undefined;
}): ReactElement {
  const ids: MediaSourceId[] = searched
    ? ["recent", "favorite", "search"]
    : ["recent", "favorite"];
  return (
    <Pane className="media-nav">
      <PaneHeader
        title="音乐"
        actions={
          <IconButton
            label="新建歌单"
            icon="plus"
            disabledReason={createReason}
            onClick={onCreate}
          />
        }
      />
      <PaneTools>
        <div className="media-search">
          <SearchField
            label="搜索曲目或艺人"
            placeholder="搜索音乐"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !searchDisabled && !searchReason)
                onSearch();
            }}
          />
          {query.trim() && (
            <IconButton
              label="搜索"
              icon="arrow"
              size="small"
              className="media-search-go"
              disabled={searchDisabled}
              disabledReason={searchReason}
              onClick={onSearch}
            />
          )}
        </div>
      </PaneTools>
      <PaneBody className="media-nav-body">
        {ids.map((id) => (
          <ListRow
            key={id}
            title={sources[id].title}
            selected={source === id}
            leading={<Icon name={sources[id].icon} size={18} />}
            meta={
              counts[id] ? (
                <span className="media-count">{counts[id]}</span>
              ) : undefined
            }
            onClick={() => onSource(id)}
          />
        ))}
        <div className="media-nav-section">
          <SectionHeader title="歌单" />
        </div>
        {playlists.length ? (
          playlists.map((p) => (
            <ListRow
              key={p.id}
              title={p.title}
              hint={p.hint}
              selected={p.selected}
              leading={<MediaTile />}
              onClick={() => onOpenPlaylist(p.id)}
            />
          ))
        ) : (
          <StatePanel
            compact
            state={playlistsState}
            title={playlistsState === "loading" ? "正在同步歌单" : "还没有歌单"}
            hint={playlistsState === "empty" ? "点 + 新建歌单" : undefined}
          />
        )}
      </PaneBody>
      {creating && (
        <Dialog
          open
          size="sm"
          title="新建歌单"
          onClose={creating.onClose}
          footer={
            <>
              <Button variant="secondary" onClick={creating.onClose}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={!creating.canCreate}
                onClick={creating.onCreate}
              >
                创建
              </Button>
            </>
          }
        >
          <Field
            label="歌单名称"
            value={creating.title}
            error={creating.error || undefined}
            autoFocus
            onChange={(e) => creating.onTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && creating.canCreate) creating.onCreate();
            }}
          />
        </Dialog>
      )}
    </Pane>
  );
}
