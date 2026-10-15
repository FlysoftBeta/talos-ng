import type { CSSProperties, ReactElement } from "react";
import { IconButton } from "../../../ui/actions/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { MediaTile } from "./media-list.tsx";
import "./media.css";

/** Share of a range filled, as the `--fill` custom property of the slider track. */
const fill = (value: number, max: number): CSSProperties =>
  ({
    "--fill": `${Math.round((Math.max(0, Math.min(value, max)) / (max || 1)) * 1000) / 10}%`,
  }) as CSSProperties;

/** The 72 px player bar at the foot of the music content pane. */
export function NowPlayingView({
  title,
  artists,
  cacheLabel,
  playing,
  position,
  positionLabel,
  totalLabel,
  total,
  volume,
  maxVolume,
  volumePercent,
  stopAtEnd,
  error,
  onPrevious,
  onToggle,
  onNext,
  onStop,
  onSeek,
  onVolume,
  onStopAtEnd,
  onQueue,
}: {
  title: string;
  artists: string;
  cacheLabel: string;
  playing: boolean;
  position: number;
  positionLabel: string;
  totalLabel: string;
  /** Seconds. */
  total: number;
  volume: number;
  maxVolume: number;
  volumePercent: number;
  stopAtEnd: boolean;
  error: string;
  onPrevious(): void;
  onToggle(): void;
  onNext(): void;
  onStop(): void;
  onSeek(seconds: number): void;
  onVolume(value: number): void;
  onStopAtEnd(value: boolean): void;
  onQueue(): void;
}): ReactElement {
  const length = Math.max(1, total);
  const level = Math.min(volume, maxVolume);
  return (
    <section className="media-player" aria-label="播放器">
      <div className="media-player-track">
        <MediaTile icon="media" size={48} />
        <div className="media-player-copy">
          <p className="media-player-title" title={title}>
            {title}
          </p>
          {error ? (
            <p className="media-player-error" role="alert" title={error}>
              {error}
            </p>
          ) : (
            <p
              className="media-player-artist"
              title={`${artists} · ${cacheLabel}`}
            >
              {artists}
              <span className="media-player-cache"> · {cacheLabel}</span>
            </p>
          )}
        </div>
      </div>
      <div className="media-player-controls">
        <IconButton label="上一首" icon="previous" onClick={onPrevious} />
        <button
          type="button"
          className="media-play"
          title={playing ? "暂停" : "播放"}
          aria-label={playing ? "暂停" : "播放"}
          onClick={onToggle}
        >
          <Icon name={playing ? "pause" : "play"} size={22} />
        </button>
        <IconButton label="下一首" icon="next" onClick={onNext} />
      </div>
      <div className="media-player-seek">
        <time>{positionLabel}</time>
        <input
          className="media-range"
          aria-label="进度"
          type="range"
          min={0}
          max={length}
          step={0.1}
          value={position}
          style={fill(position, length)}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <time>{totalLabel}</time>
      </div>
      <div className="media-player-tools">
        <IconButton
          label="播完即停"
          icon="stop-after"
          pressed={stopAtEnd}
          onClick={() => onStopAtEnd(!stopAtEnd)}
        />
        <span
          className="media-volume"
          title={`音量上限 ${volumePercent}%（管理员设置）`}
        >
          <Icon name={level > 0 ? "volume" : "volume-off"} size={18} />
          <input
            className="media-range"
            aria-label="音量"
            type="range"
            min={0}
            max={maxVolume}
            step={0.01}
            value={level}
            style={fill(level, maxVolume)}
            onChange={(e) => onVolume(Number(e.target.value))}
          />
        </span>
        <IconButton label="播放队列" icon="queue" onClick={onQueue} />
        <IconButton label="停止" icon="stop" onClick={onStop} />
      </div>
    </section>
  );
}
