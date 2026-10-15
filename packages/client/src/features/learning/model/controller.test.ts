import { describe, expect, it, vi } from "vitest";
import { deflateSync } from "fflate";
import { toBase64Url, utf8Encode } from "@talos/base";
import type { LearningWord } from "@talos/contract";
import { NavGuards } from "../../../core/navigation/guards.ts";
import type { NavIntent } from "../../../core/navigation/index.ts";
import { LearningController } from "./controller.ts";
import type { LearningHost, LearningPort } from "./controller.ts";
import { overlaysModel } from "./overlays.ts";
import { wordListModel } from "./word-list.ts";
import { screenModel, sidebarModel } from "./pages.ts";
import { quizModel, summaryModel } from "./quiz.ts";
import { dashboardModel, DisciplineSetting } from "./dashboard.ts";

const ids = Array.from(
  { length: 5 },
  (_, n) => `01ARZ3NDEKTSV4RRFFQ69G5FA${n}`,
);
const words: LearningWord[] = ids.map((id, n) => [id, `word${n}`, `释义${n}`]);
const corpusRow = {
  scope: "learn",
  type: "learningCorpus",
  id: ids[0]!,
  rev: 1,
  deleted: false,
  data: {
    id: ids[0],
    version: 1,
    count: 5,
    encoding: "deflate-json-v1",
    data: toBase64Url(deflateSync(utf8Encode(JSON.stringify(words)))),
  },
};

class Time {
  at = 0;
  next = 0;
  tasks = new Map<number, { at: number; fn: () => void }>();
  now = () => this.at;
  set = (fn: () => void, ms: number): number => {
    const id = ++this.next;
    this.tasks.set(id, { at: this.at + ms, fn });
    return id;
  };
  clear = (id: unknown): void => {
    this.tasks.delete(id as number);
  };
  advance(ms: number): void {
    const target = this.at + ms;
    for (;;) {
      const due = [...this.tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > target) break;
      this.at = due[1].at;
      this.tasks.delete(due[0]);
      due[1].fn();
    }
    this.at = target;
  }
}

function harness(options: { discipline?: boolean } = {}) {
  const time = new Time();
  const listeners = new Set<() => void>();
  const rowListeners = new Set<() => void>();
  let rows: unknown[] = [corpusRow];
  const snapshot = {
    gate: "app",
    concealed: false,
    user: { id: "u1" } as { id: string } | undefined,
    device: ids[4]! as string | undefined,
  };
  const state = { discipline: options.discipline ?? false, gateOk: true };
  const dispatched: NavIntent[] = [];
  const guards = new NavGuards();
  const command = vi.fn<(...args: unknown[]) => Promise<never>>(
    async () => ({}) as never,
  );
  const port: LearningPort = {
    command: command as never,
    repositories: new Map([
      [
        "learning.data",
        {
          getSnapshot: () => rows as never,
          subscribe: (fn: () => void) => {
            rowListeners.add(fn);
            return () => rowListeners.delete(fn);
          },
        },
      ],
    ]) as never,
    getSnapshot: () => snapshot as never,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    navigationGuards: guards,
    dispatch: (intent) => {
      dispatched.push(intent);
      guards.request(intent, () => {});
    },
    gate: () => (state.gateOk ? { ok: true } : { ok: false, reason: "no" }),
    lock: vi.fn(),
    setting: ((_key: string, fallback: unknown) =>
      state.discipline ? true : fallback) as never,
  };
  let hidden = false;
  const visibility = new Set<() => void>();
  let confirm: (() => boolean) | undefined;
  const host: LearningHost = {
    hidden: () => hidden,
    onVisibility: (fn) => {
      visibility.add(fn);
      return () => visibility.delete(fn);
    },
    confirmUnload: (fn) => {
      confirm = fn;
      return () => {
        confirm = undefined;
      };
    },
  };
  const controller = new LearningController(port, host, time, () => 0.2);
  const notify = () => listeners.forEach((fn) => fn());
  return {
    time,
    controller,
    snapshot,
    state,
    dispatched,
    guards,
    command,
    port,
    notify,
    setHidden(value: boolean) {
      hidden = value;
      visibility.forEach((fn) => fn());
    },
    setRows(next: unknown[]) {
      rows = next;
      rowListeners.forEach((fn) => fn());
    },
    unloadGuard: () => confirm?.(),
    listeners,
    rowListeners,
    visibility,
  };
}

describe("LearningController", () => {
  it("decodes the repository at construction and again when rows change", () => {
    const h = harness();
    expect(h.controller.getState().data.words).toHaveLength(5);
    h.controller.attach();
    h.setRows([]);
    expect(h.controller.getState().data.cached).toBe(false);
    h.controller.detach();
  });

  it("starting a session navigates to its page and guards later navigation", () => {
    const h = harness();
    h.controller.attach();
    h.controller.start("normal");
    expect(h.dispatched[0]).toEqual({
      type: "pushPage",
      area: "learning",
      page: { kind: "page", id: "learning.normal" },
    });
    expect(h.controller.getState().session).toBeDefined();
    expect(h.unloadGuard()).toBe(true);
    h.port.dispatch({ type: "back" });
    const { exit, session } = h.controller.getState();
    expect(exit?.intent).toEqual({ type: "back" });
    expect(session!.getSnapshot().phase).toBe("question");
    // The held request is continued only when the user ends the session.
    h.controller.finish();
    expect(h.controller.getState()).toMatchObject({
      session: undefined,
      exit: undefined,
      paused: false,
    });
    expect(h.unloadGuard()).toBe(false);
    h.controller.detach();
  });

  it("a lock request ends up pending and finish does not continue it", () => {
    const h = harness();
    h.controller.attach();
    h.controller.start("normal");
    const proceed = vi.fn();
    h.guards.conceal();
    const held = h.controller.getState().exit;
    expect(held?.intent.type).toBe("lock");
    held!.proceed = proceed;
    h.controller.finish();
    expect(proceed).not.toHaveBeenCalled();
    h.controller.detach();
  });

  it("cancelling the exit lets the session resume", async () => {
    const h = harness();
    h.controller.attach();
    h.controller.start("speed");
    h.port.dispatch({ type: "back" });
    h.time.advance(9000);
    expect(h.command).not.toHaveBeenCalled();
    h.controller.cancelExit();
    expect(h.controller.getState().exit).toBeUndefined();
    h.time.advance(5000);
    await Promise.resolve();
    expect(h.command).toHaveBeenCalledTimes(1);
    h.controller.detach();
  });

  it("a hidden tab pauses the session until resumed", () => {
    const h = harness();
    h.controller.attach();
    h.controller.start("speed");
    h.setHidden(true);
    expect(h.controller.getState().paused).toBe(true);
    h.time.advance(60000);
    expect(h.command).not.toHaveBeenCalled();
    h.setHidden(false);
    h.time.advance(60000);
    expect(h.command).not.toHaveBeenCalled();
    h.controller.resume();
    h.time.advance(4999);
    expect(h.command).not.toHaveBeenCalled();
    h.controller.detach();
  });

  it("raises one discipline question after five active minutes and restarts the count after it closes", async () => {
    const h = harness({ discipline: true });
    h.controller.attach();
    h.time.advance(4 * 60 * 1000);
    h.setHidden(true);
    h.time.advance(30 * 60 * 1000);
    expect(h.controller.getState().discipline).toBeUndefined();
    h.setHidden(false);
    h.time.advance(60 * 1000 - 1);
    expect(h.controller.getState().discipline).toBeUndefined();
    h.time.advance(1);
    const { discipline } = h.controller.getState();
    expect(discipline?.mode).toBe("discipline");
    h.time.advance(30 * 60 * 1000);
    expect(h.controller.getState().discipline).toBe(discipline);
    await discipline!.answer("correct");
    h.time.advance(500);
    expect(h.controller.getState().discipline).toBeUndefined();
    h.time.advance(5 * 60 * 1000);
    expect(h.controller.getState().discipline).toBeDefined();
    h.controller.detach();
  });

  it("does not count locked, concealed or forbidden time toward the deadline", () => {
    const h = harness({ discipline: true });
    h.controller.attach();
    h.snapshot.concealed = true;
    h.notify();
    h.time.advance(10 * 60 * 1000);
    expect(h.controller.getState().discipline).toBeUndefined();
    h.snapshot.concealed = false;
    h.state.gateOk = false;
    h.notify();
    h.time.advance(10 * 60 * 1000);
    expect(h.controller.getState().discipline).toBeUndefined();
    h.state.gateOk = true;
    h.notify();
    h.time.advance(5 * 60 * 1000);
    expect(h.controller.getState().discipline).toBeDefined();
    h.controller.detach();
  });

  it("turning the setting off cancels the pending deadline", () => {
    const h = harness({ discipline: true });
    h.controller.attach();
    h.time.advance(2 * 60 * 1000);
    h.state.discipline = false;
    h.notify();
    h.time.advance(60 * 60 * 1000);
    expect(h.controller.getState().discipline).toBeUndefined();
    expect(h.time.tasks.size).toBe(0);
    h.controller.detach();
  });

  it("an account switch drops the session, held navigation and discipline question", () => {
    const h = harness();
    h.controller.attach();
    h.controller.start("normal");
    h.port.dispatch({ type: "back" });
    const session = h.controller.getState().session!;
    h.snapshot.user = { id: "u2" };
    h.notify();
    expect(h.controller.getState()).toMatchObject({
      session: undefined,
      exit: undefined,
      discipline: undefined,
      paused: false,
    });
    void session.answer("correct");
    expect(h.command).not.toHaveBeenCalled();
    h.controller.detach();
  });

  it("records answers with the device and rejects a second save or an unready device", async () => {
    const h = harness();
    h.controller.attach();
    h.controller.start("normal");
    let release!: () => void;
    h.command.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({} as never))),
    );
    const session = h.controller.getState().session!;
    const first = session.answer("correct");
    expect(h.command).toHaveBeenCalledTimes(1);
    const args = h.command.mock.calls[0]![1] as { device: string };
    expect(args.device).toBe(ids[4]!);
    release();
    await first;
    expect(session.getSnapshot().phase).toBe("feedback");
    h.controller.detach();

    const g = harness();
    g.snapshot.device = undefined;
    g.controller.attach();
    g.controller.start("normal");
    const s = g.controller.getState().session!;
    await s.answer("correct");
    expect(s.getSnapshot()).toMatchObject({
      phase: "error",
      error: "设备尚未就绪",
    });
    expect(g.command).not.toHaveBeenCalled();
    g.controller.detach();
  });

  it("discipline dismissal: unanswerable questions close, answerable ones lock on escape", async () => {
    const h = harness({ discipline: true });
    h.controller.attach();
    h.time.advance(5 * 60 * 1000);
    h.controller.requestCloseDiscipline(true);
    expect(h.controller.getState().discipline).toBeDefined();
    h.controller.escapeDiscipline(true);
    expect(h.port.lock).toHaveBeenCalledTimes(1);
    expect(h.controller.getState().discipline).toBeDefined();
    h.controller.escapeDiscipline(false);
    expect(h.controller.getState().discipline).toBeUndefined();
    h.controller.detach();
  });

  it("detach releases listeners, timers and sessions and attach works again", () => {
    const h = harness({ discipline: true });
    h.controller.attach();
    h.controller.start("speed");
    h.controller.detach();
    expect(h.listeners.size).toBe(0);
    expect(h.rowListeners.size).toBe(0);
    expect(h.visibility.size).toBe(0);
    expect(h.time.tasks.size).toBe(0);
    expect(h.controller.getState().session).toBeUndefined();
    h.controller.attach();
    h.time.advance(5 * 60 * 1000);
    expect(h.controller.getState().discipline).toBeDefined();
    h.controller.detach();
  });
});

describe("learning presentation models", () => {
  const data = {
    words,
    progress: new Map(),
    version: 3,
    cached: true,
  };
  it("derives the sidebar selection and cache label", () => {
    const m = sidebarModel([{ kind: "page", id: "learning.wrong" }], data);
    expect(m.items.map((i) => i.selected)).toEqual([false, true, false]);
    expect(m.cache).toBe("词库 v3 · 5 词已缓存");
    expect(
      sidebarModel([{ kind: "home" }], { ...data, cached: false }).items[0]!
        .selected,
    ).toBe(true);
  });
  it("chooses the screen content in priority order", () => {
    const base = {
      gate: { ok: true } as const,
      data,
      connection: "connected",
      stack: [
        { kind: "home" },
        { kind: "page", id: "learning.normal" },
      ] as const,
      hasSession: true,
    };
    expect(
      screenModel({ ...base, gate: { ok: false, reason: "x" } }).content,
    ).toMatchObject({ state: "forbidden", hint: "x" });
    expect(
      screenModel({ ...base, data: { ...data, error: "bad" } }).content,
    ).toMatchObject({ state: "error" });
    expect(
      screenModel({
        ...base,
        data: { ...data, cached: false },
        connection: "offline",
      }).content,
    ).toMatchObject({ state: "offline" });
    expect(
      screenModel({ ...base, data: { ...data, cached: false } }).content,
    ).toMatchObject({ state: "loading" });
    const practice = screenModel(base);
    expect(practice.content.kind).toBe("practice");
    expect(practice.back).toEqual({ label: "结束练习" });
    expect(screenModel({ ...base, hasSession: false }).content.kind).toBe(
      "dashboard",
    );
    expect(
      screenModel({
        ...base,
        hasSession: false,
        stack: [{ kind: "page", id: "learning.mastered" }],
      }),
    ).toMatchObject({
      content: { kind: "wordList", list: "mastered" },
      title: "已掌握",
      back: undefined,
    });
  });
  it("formats the dashboard", () => {
    const m = dashboardModel({
      data,
      now: 0,
      connection: "offline",
      pending: 2,
      failed: 1,
      disciplineEnabled: true,
    });
    expect(m.syncNote).toBe("离线练习可用 · 2 项待同步");
    expect(m.stats[3]).toEqual({ label: "尚未掌握", value: "5 / 5" });
    expect(m).toMatchObject({
      discipline: "on",
      failedNote: true,
      empty: false,
    });
  });
  it("keeps the discipline-setting failure until the next attempt", async () => {
    const setSetting = vi
      .fn()
      .mockRejectedValueOnce(new Error("离线"))
      .mockResolvedValueOnce(undefined);
    const setting = new DisciplineSetting({ setSetting });
    setting.set("on");
    await Promise.resolve();
    await Promise.resolve();
    expect(setting.getState().error).toBe("离线");
    setting.set("off");
    expect(setting.getState().error).toBe("");
    expect(setSetting).toHaveBeenLastCalledWith(expect.any(String), false);
  });
  it("titles the empty word lists", () => {
    const m = wordListModel({ ...data, words: [] }, "wrong", 0);
    expect(m).toMatchObject({ empty: true, title: "没有待巩固的单词" });
    expect(wordListModel({ ...data, words: [] }, "mastered", 0)).toMatchObject({
      title: "还没有已掌握的单词",
    });
  });
  it("describes quiz states and the mastery summary", () => {
    const quiz = { word: words[0]!, choices: words.slice(0, 3) };
    const question = quizModel(
      "speed",
      { quiz, phase: "question", total: 2, correct: 1, explicit: 0 },
      4250,
    );
    expect(question).toMatchObject({
      kind: "question",
      number: "第 3 题",
      timer: "4.3 秒",
      fewChoices: true,
      answerable: true,
      showMastered: true,
    });
    const feedback = quizModel(
      "discipline",
      {
        quiz,
        phase: "feedback",
        total: 3,
        correct: 2,
        explicit: 1,
        result: "wrong",
      },
      0,
    );
    expect(feedback).toMatchObject({
      number: "第 3 题",
      timer: undefined,
      showMastered: false,
      feedback: { text: "再记一次 · 释义0", tone: "failed" },
    });
    expect(
      (
        feedback as { choices: Array<{ highlight: boolean; answer: string }> }
      ).choices.map((c) => [c.highlight, c.answer]),
    ).toEqual([
      [true, "correct"],
      [false, "wrong"],
      [false, "wrong"],
    ]);
    expect(
      quizModel(
        "clear",
        { phase: "empty", total: 0, correct: 0, explicit: 0 },
        0,
      ),
    ).toMatchObject({ kind: "empty", title: "错题已全部清理完毕" });
    expect(
      summaryModel({ phase: "saving", total: 3, correct: 2, explicit: 1 }),
    ).toEqual({
      answered: "3 题",
      correct: "2 题",
      accuracy: "67%",
      explicit: "1 次",
      saving: true,
    });
    expect(
      summaryModel({ phase: "empty", total: 0, correct: 0, explicit: 0 })
        .accuracy,
    ).toBe("0%");
  });
  it("opens overlays only for an unconcealed app", () => {
    const s = {
      data,
      paused: true,
      session: {} as never,
      discipline: undefined,
      exit: undefined,
    };
    expect(
      overlaysModel({
        state: s,
        gate: "app",
        concealed: false,
        canAnswer: true,
      }),
    ).toMatchObject({
      visible: true,
      pauseOpen: true,
      disciplineDismissible: false,
    });
    expect(
      overlaysModel({ state: s, gate: "app", concealed: true, canAnswer: true })
        .visible,
    ).toBe(false);
    expect(
      overlaysModel({
        state: s,
        gate: "app",
        concealed: false,
        canAnswer: false,
      }).disciplineDismissible,
    ).toBe(true);
    expect(
      overlaysModel({
        state: { ...s, data: { ...data, words: [] } },
        gate: "app",
        concealed: false,
        canAnswer: true,
      }).disciplineDismissible,
    ).toBe(true);
  });
});
