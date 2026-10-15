import type { ReactElement } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { Dialog, Menu } from "../../../ui/overlays/index.ts";
import { SelectField } from "../../../ui/inputs/index.ts";
import { Tag } from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import "./media.css";

export interface AddToPlaylistView {
  playlists: readonly { id: string; title: string }[];
  target: string;
  onTarget(id: string): void;
  onSubmit(): void;
  onClose(): void;
}
/**
 * One track: index (or the playing mark), title and artist, album, cache tag, duration,
 * favourite and a row menu. The whole row plays the track.
 */
export function TrackRowView({
  index,
  title,
  artist,
  album,
  duration,
  current,
  playing,
  deviceCached,
  serverCached,
  favorite,
  inPlaylist,
  addReason,
  removeReason,
  adding,
  error,
  onPlay,
  onFavorite,
  onEnqueue,
  onAdd,
  onRemove,
}: {
  /** 1-based position in the shown list. */
  index: number;
  title: string;
  artist: string;
  album: string | null;
  duration: string;
  current: boolean;
  playing: boolean;
  deviceCached: boolean;
  /** The server holds the prepared audio. */
  serverCached: boolean;
  favorite: boolean;
  /** Shown inside a playlist: offers removal instead of adding. */
  inPlaylist: boolean;
  addReason: string | undefined;
  removeReason: string | undefined;
  adding: AddToPlaylistView | undefined;
  error: string;
  onPlay(): void;
  onFavorite(): void;
  onEnqueue(): void;
  onAdd(): void;
  onRemove(): void;
}): ReactElement {
  return (
    <div
      role="listitem"
      data-testid="media.track"
      data-device-cache={deviceCached}
      className={`media-track${current ? " is-current" : ""}`}
    >
      <span className="media-track-index" aria-hidden="true">
        {current ? (
          <Icon name={playing ? "volume" : "pause"} size={16} />
        ) : (
          <>
            <span className="media-track-number">{index}</span>
            <Icon name="play" size={16} />
          </>
        )}
      </span>
      <span className="media-track-copy">
        <button
          type="button"
          className="media-track-main"
          aria-current={current ? "true" : undefined}
          onClick={onPlay}
        >
          <span className="media-track-title" data-testid="ui.row.title">
            {title}
          </span>
        </button>
        <span className="media-track-artist">{artist}</span>
      </span>
      <span className="media-track-album">{album}</span>
      <span className="media-track-tag">
        {deviceCached ? (
          <Tag tone="confirmed">离线</Tag>
        ) : serverCached ? (
          <Tag>已缓存</Tag>
        ) : null}
      </span>
      <span className="media-track-time">{duration}</span>
      <span className="media-track-actions">
        <IconButton
          icon="heart"
          className="media-fav"
          pressed={favorite}
          label={`${favorite ? "取消收藏" : "收藏"}${title}`}
          onClick={onFavorite}
        />
        <Menu
          label={`更多操作 ${title}`}
          items={[
            {
              label: `加入队列 ${title}`,
              icon: "queue",
              onSelect: onEnqueue,
            },
            {
              label: "添加到歌单",
              icon: "playlist-add",
              hidden: inPlaylist,
              disabledReason: addReason,
              onSelect: onAdd,
            },
            {
              label: "移出歌单",
              icon: "minus",
              hidden: !inPlaylist,
              disabledReason: removeReason,
              onSelect: onRemove,
            },
          ]}
        />
      </span>
      {error && (
        <p role="alert" className="media-track-error">
          {error}
        </p>
      )}
      {adding && (
        <Dialog
          open
          size="sm"
          title={`将「${title}」添加到歌单`}
          onClose={adding.onClose}
          footer={
            <>
              <Button variant="secondary" onClick={adding.onClose}>
                取消
              </Button>
              {adding.playlists.length > 0 && (
                <Button
                  variant="primary"
                  disabled={!adding.target}
                  onClick={adding.onSubmit}
                >
                  添加
                </Button>
              )}
            </>
          }
        >
          {adding.playlists.length ? (
            <SelectField
              label="目标歌单"
              value={adding.target}
              onChange={(e) => adding.onTarget(e.target.value)}
            >
              <option value="">选择歌单</option>
              {adding.playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </SelectField>
          ) : (
            <StatePanel
              compact
              state="empty"
              title="没有可编辑的歌单"
              hint="先新建一个歌单"
            />
          )}
        </Dialog>
      )}
    </div>
  );
}
