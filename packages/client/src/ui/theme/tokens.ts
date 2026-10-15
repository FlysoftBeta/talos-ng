export type ColorMode = "light" | "dark";
/**
 * The single source of design tokens. Colours are emitted as CSS custom properties
 * (`--<name>`) by TalosProvider; sizes, type and spacing are mirrored by `tokens.css`
 * (CSS cannot import TS). Change both together; docs/impl/design-system.md lists the rules.
 */
export const tokens = {
  space: [0, 4, 8, 12, 16, 24, 32, 48] as const,
  size: {
    rail: 64,
    listWide: 296,
    listNarrow: 264,
    navWide: 216,
    navNarrow: 184,
    header: 56,
    control: 40,
    controlSmall: 32,
    row: 44,
    rowTwoLine: 56,
    stack: 720,
    wide: 1100,
  },
  radius: { control: 8, surface: 12 },
  type: [12, 13, 14, 16, 20, 28] as const,
  motion: { fast: 120, normal: 180 },
  font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif',
  palettes: {
    light: {
      /** Content pane and floating surfaces. */
      bg: "#ffffff",
      /** Rail and list pane. */
      sidebar: "#f5f6f8",
      /** Grouped sections and wells drawn on bg. */
      raised: "#f7f8fa",
      hover: "#eceef1",
      selected: "#e4e7ec",
      border: "#e3e6ea",
      "border-strong": "#cdd2d9",
      text: "#1b1f24",
      muted: "#5a626d",
      /** Decorative only (placeholders, disabled glyphs); never essential text. */
      faint: "#9aa1ab",
      accent: "#1f5bd6",
      "accent-hover": "#1a4fbd",
      "accent-ink": "#ffffff",
      "accent-soft": "#e7eefc",
      pending: "#975400",
      "pending-soft": "#fdf1df",
      failed: "#c42b2b",
      "failed-soft": "#fcebea",
      confirmed: "#1b7340",
      "confirmed-soft": "#e6f4ec",
      inverse: "#22262c",
      "inverse-ink": "#f4f5f7",
      scrim: "rgba(17, 20, 24, 0.32)",
      shadow:
        "0 12px 32px rgba(17, 20, 24, 0.14), 0 2px 6px rgba(17, 20, 24, 0.08)",
    },
    dark: {
      bg: "#1b1c1f",
      sidebar: "#141517",
      raised: "#222327",
      hover: "#27282c",
      selected: "#303237",
      border: "#2c2e33",
      "border-strong": "#40434a",
      text: "#e8e9ec",
      muted: "#a3a8b1",
      faint: "#6c717a",
      accent: "#7aa5ff",
      "accent-hover": "#93b6ff",
      "accent-ink": "#0d1526",
      "accent-soft": "#1e2a45",
      pending: "#eeb04a",
      "pending-soft": "#3a2c14",
      failed: "#ff8a80",
      "failed-soft": "#3d1f1e",
      confirmed: "#62cf8f",
      "confirmed-soft": "#173325",
      inverse: "#eceef1",
      "inverse-ink": "#1b1c1f",
      scrim: "rgba(0, 0, 0, 0.55)",
      shadow: "0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3)",
    },
  },
} as const;
