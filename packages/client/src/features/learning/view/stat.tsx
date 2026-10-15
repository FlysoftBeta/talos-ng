import type { ReactElement } from "react";

/** A stat value such as "16 词" or "8 / 16": the leading number large, the rest small. */
export function StatValue({ value }: { value: string }): ReactElement {
  const space = value.indexOf(" ");
  return (
    <strong className="learn-stat-value">
      {space < 0 ? (
        value
      ) : (
        <>
          {value.slice(0, space)}
          <small>{value.slice(space)}</small>
        </>
      )}
    </strong>
  );
}
/** A row of equal stat tiles: number on top, label below. */
export function StatTiles({
  tiles,
  compact = false,
  "data-testid": testId,
}: {
  tiles: ReadonlyArray<{ label: string; value: string }>;
  compact?: boolean;
  "data-testid"?: string;
}): ReactElement {
  return (
    <div
      className={`learn-stats learn-stats-${tiles.length}${compact ? " is-compact" : ""}`}
      data-testid={testId}
    >
      {tiles.map((tile) => (
        <div key={tile.label} className="learn-stat">
          <StatValue value={tile.value} />
          <span className="learn-stat-label">{tile.label}</span>
        </div>
      ))}
    </div>
  );
}
