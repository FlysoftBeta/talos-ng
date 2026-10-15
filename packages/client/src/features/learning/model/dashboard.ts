import { LEARNING_DISCIPLINE_KEY } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { RuntimeSettingsPort } from "../../../core/runtime-port.ts";
import { learningStats } from "./corpus.ts";
import type { LearningData } from "./corpus.ts";

export interface DashboardModel {
  stats: Array<{ label: string; value: string }>;
  cached: string;
  syncNote: string;
  /** No words imported yet: show the empty state instead of practice actions. */
  empty: boolean;
  discipline: "on" | "off";
  /** The one-line warning about operations that failed to synchronise, if any. */
  failedNote: boolean;
}

export function dashboardModel(input: {
  data: LearningData;
  now: number;
  connection: string;
  pending: number;
  failed: number;
  disciplineEnabled: boolean;
}): DashboardModel {
  const counts = learningStats(input.data, input.now);
  return {
    stats: [
      { label: "今日练习", value: `${counts.today} 词` },
      { label: "已掌握", value: `${counts.mastered} 词` },
      { label: "待巩固", value: `${counts.wrong} 词` },
      { label: "尚未掌握", value: `${counts.remaining} / ${counts.total}` },
      { label: "累计作答", value: `${counts.answers} 次` },
    ],
    cached: `${input.data.words.length} 词已缓存`,
    syncNote:
      (input.connection === "offline" ? "离线练习可用" : "进度自动同步") +
      (input.pending > 0 ? ` · ${input.pending} 项待同步` : ""),
    empty: input.data.words.length === 0,
    discipline: input.disciplineEnabled ? "on" : "off",
    failedNote: input.failed > 0,
  };
}

/** Writes the synced discipline-mode preference and keeps the last failure message. */
export class DisciplineSetting extends StateStore<{ error: string }> {
  constructor(private readonly port: Pick<RuntimeSettingsPort, "setSetting">) {
    super({ error: "" });
  }
  set = (mode: string): void => {
    this.patch({ error: "" });
    void this.port
      .setSetting(LEARNING_DISCIPLINE_KEY, mode === "on")
      .catch((e: unknown) =>
        this.patch({ error: e instanceof Error ? e.message : "设置未能保存" }),
      );
  };
}
