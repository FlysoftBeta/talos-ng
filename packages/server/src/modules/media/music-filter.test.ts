import { describe, expect, it } from "vitest";
import { isMusicEntry, nextOffset } from "./music-filter.ts";

const song = {
  title: "晴天",
  duration: 240,
  liveStatus: "not_live",
  categories: ["Music"],
};
describe("music filter", () => {
  it("keeps songs and rejects spoken, promotional, live and out-of-range entries", () => {
    expect(isMusicEntry(song)).toBe(true);
    expect(isMusicEntry({ ...song, categories: undefined })).toBe(true);
    for (const bad of [
      { duration: 10 },
      { duration: 3 * 3600 },
      { duration: undefined },
      { liveStatus: "is_live" },
      { title: "每日播客 第12期" },
      { title: "Best Ringtone 2024" },
      { title: "Audiobook chapter 3" },
      { title: "Super Sale ads 30s" },
      { categories: ["Podcast"] },
    ])
      expect(isMusicEntry({ ...song, ...bad })).toBe(false);
  });
  it("pages by raw provider count so filtering never stalls the cursor", () => {
    expect(nextOffset(0, 20, 20)).toBe(20);
    expect(nextOffset(20, 20, 20)).toBe(40);
    expect(nextOffset(40, 20, 7)).toBeNull();
  });
});
