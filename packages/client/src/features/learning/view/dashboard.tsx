import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import {
  Group,
  GroupRow,
  PaneBody,
  PaneHeader,
} from "../../../ui/layout/index.ts";
import {
  InlineNotice,
  OfflineHint,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import { Segmented } from "../../../ui/navigation/index.ts";
import type { DashboardModel } from "../model/dashboard.ts";
import { StatTiles } from "./stat.tsx";
import "./learning.css";

export function DashboardView({
  title,
  model,
  wrongCount,
  practiceDenied,
  disciplineDenied,
  error,
  onStart,
  onOpenPage,
  onDiscipline,
}: {
  title: string;
  model: DashboardModel;
  /** Words with recorded errors; clearing needs at least one. */
  wrongCount: number;
  practiceDenied: string | undefined;
  disciplineDenied: string | undefined;
  error: string;
  onStart: (mode: "normal" | "speed" | "clear") => void;
  onOpenPage: (id: "wrong" | "mastered") => void;
  onDiscipline: (mode: string) => void;
}): ReactElement {
  const [mode, setMode] = useState<"normal" | "speed">("normal");
  const tiles = model.stats.slice(0, 4);
  const extra = model.stats.slice(4);
  return (
    <>
      <PaneHeader
        title={title}
        subtitle={`${model.cached} · ${model.syncNote}`}
      />
      <PaneBody padded className="learn-dashboard">
        <div className="learn-column">
          {model.failedNote && (
            <InlineNotice tone="failed">
              有操作未能同步，请打开同步与任务查看原因。
            </InlineNotice>
          )}
          <StatTiles tiles={tiles} data-testid="learning.stats" />
          {extra.length > 0 && (
            <p className="learn-stats-note">
              {extra.map((stat) => (
                <span key={stat.label}>
                  {stat.label} {stat.value}
                </span>
              ))}
            </p>
          )}
          {model.empty ? (
            <div className="learn-empty">
              <StatePanel
                state="empty"
                title="词库还是空的"
                hint="请联系功能管理员导入词库"
              />
            </div>
          ) : (
            <div className="learn-cards">
              <section className="learn-card">
                <h3>单词练习</h3>
                <p>
                  {mode === "speed"
                    ? "每题 5 秒，超时记为答错。"
                    : "不限时，按自己的节奏作答。"}
                </p>
                <div className="learn-card-actions">
                  <Segmented
                    label="练习节奏"
                    value={mode}
                    options={[
                      { value: "normal", label: "标准" },
                      { value: "speed", label: "极速" },
                    ]}
                    onChange={setMode}
                  />
                  <Button
                    variant="primary"
                    disabledReason={practiceDenied}
                    onClick={() => onStart(mode)}
                  >
                    开始练习
                  </Button>
                </div>
              </section>
              <section className="learn-card">
                <h3>清错练习</h3>
                <p>每题 5 秒，答对一次清除一次错误。</p>
                <div className="learn-card-actions">
                  <Button variant="ghost" onClick={() => onOpenPage("wrong")}>
                    复习错题
                  </Button>
                  <Button
                    variant="secondary"
                    disabledReason={
                      practiceDenied ||
                      (wrongCount ? undefined : "暂无待巩固的单词")
                    }
                    onClick={() => onStart("clear")}
                  >
                    开始清错
                  </Button>
                </div>
              </section>
            </div>
          )}
          <Group className="learn-discipline">
            <GroupRow
              label="自律模式"
              hint="开启后，每使用应用 5 分钟练习一题。隐藏或锁定时暂停。"
            >
              <OfflineHint label="自律模式" reason={disciplineDenied}>
                <Segmented
                  label="自律模式"
                  value={model.discipline}
                  options={[
                    { value: "off", label: "关闭" },
                    { value: "on", label: "开启" },
                  ]}
                  onChange={onDiscipline}
                />
              </OfflineHint>
            </GroupRow>
          </Group>
          {error && <InlineNotice tone="failed">{error}</InlineNotice>}
        </div>
      </PaneBody>
    </>
  );
}
