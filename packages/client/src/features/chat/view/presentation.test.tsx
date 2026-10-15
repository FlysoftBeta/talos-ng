import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DateSeparator } from "./date-separator.tsx";
import { chatDay, dateLabel } from "../model/format.ts";
import { PostCard } from "../connect/post-card.tsx";
import type { PostView } from "../model/module.ts";
vi.mock("../../../platform/react/context.tsx", () => ({
  useRuntime: () => ({
    getSnapshot: () => ({ user: { id: "viewer", roles: [] } }),
    can: () => ({ ok: true }),
  }),
  useClientSnapshot: () => ({ user: { id: "viewer", roles: [] } }),
  useCan: () => ({ ok: true }),
}));
it("renders missing-author fallback and Shanghai midnight/year/leap-day separators", () => {
  const noop = () => {};
  const post: PostView = {
    id: "post",
    conversation: "conversation",
    seq: 1,
    rev: 1,
    author: "",
    authorName: "",
    kind: "text",
    preview: "正文",
    bodyLength: 2,
    replyTo: null,
    created: Date.parse("2026-01-01T00:00:00Z"),
    edited: null,
    deletedAt: null,
    image: null,
    sticker: null,
  };
  expect(
    renderToStaticMarkup(
      <PostCard
        post={post}
        onReply={noop}
        onJump={noop}
        onFull={noop}
        onEdit={noop}
        onDelete={noop}
        onImage={noop}
        onRetry={noop}
        onDiscard={noop}
        onSelect={noop}
      />,
    ),
  ).toContain("无主内容");
  const now = Date.parse("2025-12-31T16:00:00Z");
  expect(chatDay(now - 1)).toBe("2025-12-31");
  expect(chatDay(now)).toBe("2026-01-01");
  for (const [value, clock, expected] of [
    [now, now, "今天"],
    [now - 1, now, "昨天"],
    [now - 86400001, now, "12月30日"],
    [
      Date.parse("2024-02-29T15:59:59Z"),
      Date.parse("2024-02-29T16:00:00Z"),
      "昨天",
    ],
  ] as const) {
    expect(
      renderToStaticMarkup(
        <DateSeparator label={dateLabel(value, clock)} />,
      ).replace(/<[^>]+>/g, ""),
    ).toBe(expected);
  }
});
