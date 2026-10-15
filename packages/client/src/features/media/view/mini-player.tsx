import type { ReactElement } from "react";
import { Icon } from "../../../ui/icon/index.ts";
import "./media.css";

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The rail player: a 44 px round play/pause with a progress ring (plain SVG). */
export function MiniPlayerView({
  title,
  hidden,
  playing,
  progress,
  onToggle,
}: {
  title: string;
  hidden: boolean;
  playing: boolean;
  /** 0..1 */
  progress: number;
  onToggle(): void;
}): ReactElement {
  const label = `${playing ? "暂停" : "播放"} · ${title}`;
  return (
    <div
      className="media-mini"
      hidden={hidden}
      role="region"
      data-testid="media.mini"
      aria-label="迷你播放器"
    >
      <button
        type="button"
        className={`media-mini-play${playing ? " is-playing" : ""}`}
        data-testid="media.mini.play"
        aria-label={label}
        title={label}
        onClick={onToggle}
      >
        <svg
          className="media-mini-ring"
          width="44"
          height="44"
          viewBox="0 0 44 44"
          aria-hidden="true"
        >
          <circle
            className="media-mini-track"
            cx="22"
            cy="22"
            r={RADIUS}
            fill="none"
            strokeWidth="2"
          />
          <circle
            className="media-mini-progress"
            cx="22"
            cy="22"
            r={RADIUS}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE.toFixed(2)}
            strokeDashoffset={(
              CIRCUMFERENCE *
              (1 - Math.max(0, Math.min(1, progress)))
            ).toFixed(2)}
            transform="rotate(-90 22 22)"
          />
        </svg>
        <Icon name={playing ? "pause" : "play"} size={18} />
      </button>
    </div>
  );
}
