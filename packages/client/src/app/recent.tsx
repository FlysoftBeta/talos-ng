import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import {
  useAccessEntries,
  useAccessHistory,
  useAccessHistoryFlush,
} from "../platform/react/use-access-history.ts";
import { useClientSnapshot, useRuntime } from "../platform/react/context.tsx";
import type { AreaId } from "../core/navigation/index.ts";
import { useConversations } from "../features/chat/connect/index.tsx";
import { collectionPageId, useLibrary } from "../features/library/index.ts";
import {
  playlistPageId,
  useMedia,
  useMediaPlayer,
} from "../features/media/index.ts";
import {
  kindLabel,
  newOpens,
  recentOverview,
  RecentPanelView,
  visibleRefs,
} from "../features/recent/index.ts";
import type { RecentResolvers, TrackedRef } from "../features/recent/index.ts";

/** Counts opens of conversations, books, booklists, playlists and played songs. */
export function RecentTracker(): null {
  const snapshot = useClientSnapshot(),
    history = useAccessHistory(),
    player = useMediaPlayer(),
    seen = useRef<ReadonlyMap<AreaId, TrackedRef>>(new Map());
  useAccessHistoryFlush(history);
  const present = snapshot.gate === "app" && !snapshot.concealed;
  useEffect(() => {
    if (!history || !present) return;
    const next = visibleRefs(snapshot.nav);
    for (const ref of newOpens(seen.current, next))
      history.record(ref.kind, ref.id);
    seen.current = next;
  }, [history, present, snapshot.nav]);
  const song = player.current?.id;
  useEffect(() => {
    if (history && song) history.record("song", song);
  }, [history, song]);
  return null;
}

/** The landing panel of the chat area: recent and frequent items of every module. */
export function RecentHome(): ReactElement {
  const runtime = useRuntime(),
    player = useMediaPlayer(),
    history = useAccessHistory(),
    entries = useAccessEntries(history),
    chats = useConversations(),
    library = useLibrary(),
    media = useMedia();
  const resolvers: RecentResolvers = {
    chat: (id) => {
      const chat = chats.find((c) => c.id === id);
      return chat && { title: chat.name, hint: "继续聊天" };
    },
    book: (id) => {
      const doc = library.docs.find((d) => d.id === id);
      return doc && { title: doc.title, hint: "继续阅读" };
    },
    booklist: (id) => {
      const list = library.collections.find((c) => c.id === id);
      return list && { title: list.title, hint: `${list.docs.length} 份文档` };
    },
    song: (id) => {
      const track = media.tracks.find((t) => t.id === id);
      return track && { title: track.title, hint: track.artists.join(" / ") };
    },
    playlist: (id) => {
      const list = media.playlists.find((p) => p.id === id);
      return list && { title: list.title, hint: `${list.tracks.length} 首` };
    },
  };
  const open: Record<TrackedRef["kind"], (id: string) => void> = {
    chat: (id) => runtime.dispatch({ type: "openConversation", id }),
    book: (id) => runtime.dispatch({ type: "openDocument", id }),
    booklist: (id) =>
      runtime.dispatch({
        type: "pushPage",
        area: "library",
        page: { kind: "page", id: collectionPageId(id) },
      }),
    song: (id) => {
      const track = media.tracks.find((t) => t.id === id);
      if (track) void player.play(track);
    },
    playlist: (id) =>
      runtime.dispatch({
        type: "pushPage",
        area: "media",
        page: { kind: "page", id: playlistPageId(id) },
      }),
  };
  const icons = {
    chat: "chat",
    book: "document",
    booklist: "book",
    song: "media",
    playlist: "list",
  } as const;
  return (
    <RecentPanelView
      emptyHint="选择一个对话"
      rows={recentOverview(entries, resolvers, Date.now()).map((e) => ({
        id: `${e.kind}:${e.id}`,
        title: e.title,
        hint: e.hint,
        label: kindLabel[e.kind],
        icon: icons[e.kind],
        onOpen: () => open[e.kind](e.id),
      }))}
    />
  );
}
