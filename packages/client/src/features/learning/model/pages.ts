import type { Page } from "../../../core/navigation/index.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type { LearningData } from "./corpus.ts";

export type PracticePage = "normal" | "speed" | "clear";
export type WordListKind = "wrong" | "mastered";

export const pageTitles: Record<string, string> = {
  dashboard: "学习概览",
  wrong: "错题本",
  mastered: "已掌握",
  normal: "单词练习",
  speed: "极速练习",
  clear: "清错练习",
};

/** The reason an action is unavailable, or undefined when the capability is granted. */
export function denial(capability: Capability): string | undefined {
  return capability.ok ? undefined : capability.reason;
}

/** The learning page id on top of the navigation stack. */
export function currentPage(stack: readonly Page[]): string {
  const top = stack[stack.length - 1];
  return top?.kind === "page" ? top.id.slice("learning.".length) : "dashboard";
}

export interface SidebarItem {
  id: "dashboard" | "wrong" | "mastered";
  title: string;
  hint: string;
  selected: boolean;
}

export interface SidebarModel {
  items: SidebarItem[];
  cache: string;
  note: string;
}

export function sidebarModel(
  stack: readonly Page[],
  data: LearningData,
): SidebarModel {
  const selected = stack.slice(-1)[0];
  const active = selected?.kind === "page" ? selected.id : "learning.dashboard";
  const item = (
    id: SidebarItem["id"],
    title: string,
    hint: string,
  ): SidebarItem => ({
    id,
    title,
    hint,
    selected: active === `learning.${id}`,
  });
  return {
    items: [
      item("dashboard", "学习概览", "每天进步一点"),
      item("wrong", "错题本", "巩固还不熟悉的单词"),
      item("mastered", "已掌握", "回看已经积累的词汇"),
    ],
    cache: data.cached
      ? `词库 v${data.version} · ${data.words.length} 词已缓存`
      : "词库尚未缓存",
    note: "完整词库保存在本机。断网也能继续练习。",
  };
}

export type ScreenContent =
  | {
      kind: "state";
      state: "forbidden" | "error" | "offline" | "loading";
      hint?: string;
    }
  | { kind: "practice" }
  | { kind: "wordList"; list: WordListKind }
  | { kind: "dashboard" };

export interface ScreenModel {
  title: string;
  content: ScreenContent;
  /** Present when the area has history to go back to. */
  back?: { label: string };
}

export function screenModel(input: {
  gate: Capability;
  data: LearningData;
  connection: string;
  stack: readonly Page[];
  hasSession: boolean;
}): ScreenModel {
  const page = currentPage(input.stack);
  const practice =
    input.hasSession && ["normal", "speed", "clear"].includes(page);
  const title = pageTitles[page] ?? pageTitles.dashboard!;
  let content: ScreenContent;
  if (!input.gate.ok)
    content = { kind: "state", state: "forbidden", hint: input.gate.reason };
  else if (input.data.error)
    content = { kind: "state", state: "error", hint: input.data.error };
  else if (!input.data.cached)
    content = {
      kind: "state",
      state: input.connection === "offline" ? "offline" : "loading",
      hint: "连接服务器后会将完整词库保存到本机",
    };
  else if (practice) content = { kind: "practice" };
  else if (page === "wrong" || page === "mastered")
    content = { kind: "wordList", list: page };
  else content = { kind: "dashboard" };
  return {
    title,
    content,
    back:
      input.stack.length > 1
        ? { label: practice ? "结束练习" : "返回" }
        : undefined,
  };
}
