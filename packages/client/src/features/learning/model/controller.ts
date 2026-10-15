import { AppError } from "@talos/base";
import {
  contract,
  LEARNING_DISCIPLINE_KEY,
  nextLearningAnswer,
} from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { StoredRow } from "../../../core/data/db.ts";
import type { Repository } from "../../../core/data/repository.ts";
import type { GuardedNavigation } from "../../../core/navigation/index.ts";
import type {
  RuntimeCommandPort,
  RuntimeNavigationPort,
  RuntimeQueryPort,
  RuntimeSessionPort,
  RuntimeSettingsPort,
} from "../../../core/runtime-port.ts";
import { LearningDecoder, wordProgress } from "./corpus.ts";
import type { LearningData } from "./corpus.ts";
import { disciplineDismissible } from "./overlays.ts";
import { PracticeSession } from "./session.ts";
import type { PracticeMode } from "./selection.ts";
import { ActiveDeadline } from "./time.ts";
import type { LearningTime } from "./time.ts";

/** Narrow runtime capabilities the learning controller needs; never the whole client runtime. */
export type LearningPort = Pick<RuntimeCommandPort, "command"> &
  Pick<RuntimeQueryPort, "repositories" | "getSnapshot" | "subscribe"> &
  Pick<RuntimeNavigationPort, "navigationGuards" | "dispatch"> &
  Pick<RuntimeSessionPort, "gate" | "lock"> &
  Pick<RuntimeSettingsPort, "setting">;

/** Page visibility and unload confirmation supplied by the host (browser adapter or test double). */
export interface LearningHost {
  hidden(): boolean;
  onVisibility(listener: () => void): () => void;
  /** Registers a confirm-on-unload prompt that applies while `shouldConfirm()` is true. */
  confirmUnload(shouldConfirm: () => boolean): () => void;
}

export interface LearningState {
  data: LearningData;
  /** A user-started practice session. */
  session?: PracticeSession;
  /** The single-question session raised by the active-use discipline deadline. */
  discipline?: PracticeSession;
  /** A navigation request held back while a practice session is live. */
  exit?: GuardedNavigation;
  /** True after the tab was hidden during a session until the user resumes. */
  paused: boolean;
}

/** Five visible, unlocked minutes of use between discipline questions. */
export const DISCIPLINE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Practice sessions, the active-use discipline deadline and the navigation guard.
 * `attach()` starts listening to the runtime and host; `detach()` releases everything.
 */
export class LearningController extends StateStore<LearningState> {
  private readonly decoder = new LearningDecoder();
  private readonly repository: Pick<
    Repository<StoredRow>,
    "getSnapshot" | "subscribe"
  >;
  private rows: readonly StoredRow[];
  private user: string | undefined;
  private visible: boolean;
  private pendingRecord = false;
  private timer?: ActiveDeadline;
  private cleanups: Array<() => void> = [];
  constructor(
    private readonly port: LearningPort,
    private readonly host: LearningHost,
    readonly time: LearningTime,
    private readonly random: () => number,
  ) {
    super({
      data: { words: [], progress: new Map(), version: 0, cached: false },
      paused: false,
    });
    this.repository = port.repositories.get("learning.data")!;
    this.rows = this.repository.getSnapshot();
    this.state = { ...this.state, data: this.decoder.decode(this.rows) };
    this.visible = !host.hidden();
    this.user = port.getSnapshot().user?.id;
  }

  attach(): void {
    this.timer = new ActiveDeadline(this.time, DISCIPLINE_INTERVAL_MS, () =>
      this.due(),
    );
    this.cleanups = [
      this.port.subscribe(this.refresh),
      this.repository.subscribe(this.refresh),
      this.host.onVisibility(this.visibility),
      this.host.confirmUnload(() => !!this.state.session),
      this.port.navigationGuards.add(this.guard),
    ];
    this.refresh();
  }

  detach(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.timer?.close();
    this.timer = undefined;
    this.state.session?.close();
    this.state.discipline?.close();
    this.state = { data: this.state.data, paused: false };
  }

  /** Whether the user's synced discipline-mode setting is on. */
  disciplineEnabled(): boolean {
    return this.port.setting<boolean>(LEARNING_DISCIPLINE_KEY, false) === true;
  }

  start = (mode: PracticeMode): void => {
    this.port.dispatch({
      type: "pushPage",
      area: "learning",
      page: { kind: "page", id: `learning.${mode}` },
    });
    this.state.session?.close();
    this.assign({
      session: new PracticeSession(
        mode,
        this.time,
        this.random,
        () => this.state.data,
        this.record,
      ),
    });
    this.apply();
  };

  openPage = (id: string): void => {
    this.port.dispatch({
      type: "pushPage",
      area: "learning",
      page: { kind: "page", id: `learning.${id}` },
    });
  };

  back = (): void => this.port.dispatch({ type: "back" });

  resume = (): void => {
    this.assign({ paused: false });
    this.apply();
  };

  /** Ends the session; a held navigation continues unless it was a lock. */
  finish = (): void => {
    const { session, exit } = this.state;
    session?.close();
    this.assign({ session: undefined, exit: undefined, paused: false });
    if (exit?.intent.type !== "lock") exit?.proceed();
  };

  cancelExit = (): void => {
    this.state.exit?.cancel();
    this.assign({ exit: undefined });
    this.apply();
  };

  closeDiscipline = (): void => {
    this.state.discipline?.close();
    this.assign({ discipline: undefined });
    this.apply();
  };

  /** Close request from the dialog chrome (backdrop, close button). */
  requestCloseDiscipline = (canAnswer: boolean): void => {
    if (disciplineDismissible(this.state.data, canAnswer))
      this.closeDiscipline();
  };

  /** Escape: dismiss when unanswerable, otherwise lock the app. */
  escapeDiscipline = (canAnswer: boolean): void => {
    if (disciplineDismissible(this.state.data, canAnswer))
      this.closeDiscipline();
    else this.port.lock();
  };

  private readonly record = async (
    word: string,
    result: "correct" | "wrong" | "mastered",
  ): Promise<void> => {
    if (this.pendingRecord) throw new AppError("E_BUSY", "正在保存上一题");
    const device = this.port.getSnapshot().device;
    if (!device) throw new AppError("E_UNAVAILABLE", "设备尚未就绪");
    this.pendingRecord = true;
    try {
      await this.port.command(
        contract.learning.answer.record,
        nextLearningAnswer(
          wordProgress(this.state.data, word),
          device,
          result,
          this.time.now(),
        ),
      );
    } finally {
      this.pendingRecord = false;
    }
  };

  private due(): void {
    this.state.discipline?.close();
    this.assign({
      discipline: new PracticeSession(
        "discipline",
        this.time,
        this.random,
        () => this.state.data,
        this.record,
        this.closeDiscipline,
      ),
    });
    this.apply();
  }

  private readonly guard = (request: GuardedNavigation): boolean => {
    const session = this.state.session;
    if (!session) return true;
    session.setActive(false);
    this.assign({ exit: request });
    return request.intent.type === "lock";
  };

  private readonly visibility = (): void => {
    const hidden = this.host.hidden();
    this.visible = !hidden;
    const session = this.state.session;
    if (hidden && session) {
      session.setActive(false);
      this.assign({ paused: true });
    }
    this.apply();
  };

  /** Re-reads rows and the runtime snapshot; an account switch drops every live session. */
  private readonly refresh = (): void => {
    const rows = this.repository.getSnapshot();
    if (rows !== this.rows) {
      this.rows = rows;
      this.assign({ data: this.decoder.decode(rows) });
    }
    const user = this.port.getSnapshot().user?.id;
    if (user !== this.user) {
      this.user = user;
      this.state.session?.close();
      this.state.discipline?.close();
      this.timer?.reset();
      this.assign({
        session: undefined,
        discipline: undefined,
        exit: undefined,
        paused: false,
      });
    }
    this.apply();
  };

  private isActive(): boolean {
    const snapshot = this.port.getSnapshot();
    return (
      snapshot.gate === "app" &&
      !snapshot.concealed &&
      this.visible &&
      this.port.gate("learning").ok
    );
  }

  /** Pushes the derived "is the user actively here" flag into the deadline and sessions. */
  private apply(): void {
    const { session, discipline, exit, paused } = this.state;
    const active = this.isActive();
    const enabled = this.disciplineEnabled();
    if (!enabled || discipline) this.timer?.reset();
    this.timer?.setActive(enabled && active && !discipline);
    session?.setActive(active && !paused && !exit && !discipline);
    discipline?.setActive(active);
  }

  private assign(value: Partial<LearningState>): void {
    const changed = (Object.keys(value) as Array<keyof LearningState>).some(
      (key) => !Object.is(this.state[key], value[key]),
    );
    if (changed) this.patch(value);
  }
}
