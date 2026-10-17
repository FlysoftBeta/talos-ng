import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";

interface Collection {
  kind: "playlist" | "artist";
  id: string;
  title: string;
  subtitle: string;
}
const KINDS = [
  { id: "song", title: "歌曲" },
  { id: "playlist", title: "歌单" },
  { id: "artist", title: "歌手" },
] as const;

/** Tabs, playlist/artist hits and the load-more button of the online search results. */
export function OnlineResultsView({
  kind,
  opened,
  collections,
  hasMore,
  busy,
  onKind,
  onOpen,
  onMore,
}: {
  kind: "song" | "playlist" | "artist";
  /** Title of the opened playlist or artist, whose tracks are listed above. */
  opened: string | undefined;
  collections: readonly Collection[];
  hasMore: boolean;
  busy: boolean;
  onKind(kind: "song" | "playlist" | "artist"): void;
  onOpen(collection: Collection | null): void;
  onMore(): void;
}): ReactElement {
  return (
    <div className="media-online" data-testid="media.online">
      {opened === undefined ? (
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
      ) : (
        <Button size="small" onClick={() => onOpen(null)}>
          返回 · {opened}
        </Button>
      )}
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
          <span>{c.title}</span>
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
