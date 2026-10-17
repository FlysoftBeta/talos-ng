import type { LauncherView } from "../model/launcher.ts";

const FONT =
  "system-ui, -apple-system, 'Segoe UI', 'Noto Sans CJK SC', sans-serif";
const COLORS = {
  background: "#1b2330",
  tile: "#2c3748",
  selected: "#3b82f6",
  text: "#f1f5f9",
  muted: "#a3b0c2",
};
const TILE = 56;
const ROW = 30;
const MAX_ROWS = 3;

function round(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > width)
    cut--;
  return `${text.slice(0, cut)}…`;
}

/** Draws app shortcut tiles, then a window of recent items, highlighting the selection. */
export function drawLauncher(
  ctx: CanvasRenderingContext2D,
  view: LauncherView,
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.muted;
  ctx.font = `12px ${FONT}`;
  ctx.fillText("快速启动 · 上/下一首选择 · 播放键打开", 12, 14);
  const apps = view.items.filter((item) => item.group === "app"),
    recent = view.items.filter((item) => item.group === "recent");
  const gap = (width - 24 - apps.length * TILE) / Math.max(1, apps.length - 1);
  apps.forEach((item, i) => {
    const x = 12 + i * (TILE + Math.min(gap, 12)),
      on = item.id === view.selectedId;
    ctx.fillStyle = on ? COLORS.selected : COLORS.tile;
    round(ctx, x, 28, TILE, TILE, 10);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "center";
    ctx.font = `20px ${FONT}`;
    ctx.fillText(item.title.slice(0, 1), x + TILE / 2, 28 + 22);
    ctx.font = `11px ${FONT}`;
    ctx.fillText(fit(ctx, item.title, TILE - 6), x + TILE / 2, 28 + 44);
  });
  const at = recent.findIndex((item) => item.id === view.selectedId),
    first = Math.max(0, Math.min(at - 1, recent.length - MAX_ROWS));
  recent.slice(first, first + MAX_ROWS).forEach((item, i) => {
    const y = 96 + i * (ROW + 4),
      on = item.id === view.selectedId;
    ctx.fillStyle = on ? COLORS.selected : COLORS.tile;
    round(ctx, 12, y, width - 24, ROW, 8);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = `13px ${FONT}`;
    ctx.fillText(fit(ctx, item.title, width - 150), 22, y + ROW / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = on ? COLORS.text : COLORS.muted;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(fit(ctx, item.hint, 110), width - 22, y + ROW / 2);
  });
  if (!recent.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.muted;
    ctx.font = `12px ${FONT}`;
    ctx.fillText("还没有最近使用的内容", width / 2, 140);
  }
}
