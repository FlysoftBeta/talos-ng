import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";

interface Collection {
  kind: "playlist" | "artist" | "album";
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string | null;
}
type Kind = "song" | Collection["kind"];
const KINDS = [
  { id: "song", title: "歌曲" },
  { id: "playlist", title: "歌单" },
  { id: "album", title: "专辑" },
  { id: "artist", title: "歌手" },
] as const;
const KIND_TITLE = { playlist: "歌单", album: "专辑", artist: "歌手" } as const;

/** The 歌曲/歌单/专辑/歌手 tabs above the search hits. */
export function OnlineTabsView({
  kind,
  busy,
  onKind,
}: {
  kind: Kind;
  busy: boolean;
  onKind(kind: Kind): void;
}): ReactElement {
  return (
    <div className="media-online" data-testid="media.online">
      <div className="media-online-tabs" role="tablist">
        {KINDS.map((k) => (
          <Button
            key={k.id}
            size="small"
            role="tab"
            aria-selected={kind === k.id}
            disabled={busy}
            onClick={() => onKind(k.id)}
          >
            {k.title}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The details page header of an opened playlist, album or artist, with its actions. */
export function CollectionHeaderView({
  collection,
  trackCount,
  busy,
  playReason,
  queueReason,
  saveReason,
  onBack,
  onPlayAll,
  onEnqueueAll,
  onSave,
}: {
  collection: Collection;
  trackCount: number;
  busy: boolean;
  /** Why each action is unavailable; undefined when it is allowed. */
  playReason: string | undefined;
  queueReason: string | undefined;
  saveReason: string | undefined;
  onBack(): void;
  onPlayAll(): void;
  onEnqueueAll(): void;
  onSave(): void;
}): ReactElement {
  const none = trackCount === 0;
  return (
    <div className="media-online" data-testid="media.collection">
      <Button size="small" onClick={onBack} disabled={busy}>
        返回
      </Button>
      <div className="media-collection-head">
        {collection.thumbnail ? (
          <img
            className={`media-collection-cover media-collection-cover-${collection.kind}`}
            src={collection.thumbnail}
            alt=""
          />
        ) : (
          <div className="media-collection-cover" />
        )}
        <div className="media-collection-text">
          <div className="media-collection-kind">
            {KIND_TITLE[collection.kind]}
          </div>
          <div className="media-collection-title">{collection.title}</div>
          <div className="media-online-hint">{collection.subtitle}</div>
        </div>
      </div>
      <div className="media-collection-actions">
        <Button
          size="small"
          disabled={none || busy || !!playReason}
          title={playReason}
          onClick={onPlayAll}
        >
          播放全部
        </Button>
        <Button
          size="small"
          disabled={none || !!queueReason}
          title={queueReason}
          onClick={onEnqueueAll}
        >
          加入队列
        </Button>
        <Button
          size="small"
          disabled={none || !!saveReason}
          title={saveReason}
          onClick={onSave}
        >
          保存为歌单
        </Button>
      </div>
    </div>
  );
}

/** Playlist/album/artist hits (or the albums of an artist page) and the load-more button. */
export function OnlineHitsView({
  title,
  collections,
  hasMore,
  busy,
  onOpen,
  onMore,
}: {
  /** Heading above the hits when they accompany a track list. */
  title: string | undefined;
  collections: readonly Collection[];
  hasMore: boolean;
  busy: boolean;
  onOpen(collection: Collection): void;
  onMore(): void;
}): ReactElement {
  return (
    <div className="media-online">
      {title && collections.length ? (
        <div className="media-collection-kind">{title}</div>
      ) : null}
      {collections.map((c) => (
        <div
          key={c.id}
          className="media-online-item"
          role="button"
          tabIndex={0}
          onClick={() => onOpen(c)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onOpen(c);
          }}
        >
          {c.thumbnail ? (
            <img className="media-online-thumb" src={c.thumbnail} alt="" />
          ) : (
            <div className="media-online-thumb" />
          )}
          <span className="media-online-name">{c.title}</span>
          <span className="media-online-hint">{c.subtitle}</span>
        </div>
      ))}
      {hasMore ? (
        <Button size="small" disabled={busy} onClick={onMore}>
          加载更多
        </Button>
      ) : null}
    </div>
  );
}
