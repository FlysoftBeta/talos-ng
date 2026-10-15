# 152c — Music

Rules: `docs/tasks/152-ui-common.md`. Feature `media` (views + `media.css`); the sharing
sheet is already restyled (152a). e2e: `node tools/e2e/run.mjs media`.

## What the area essentially is

Browse and pick music, then keep it playing while doing other things. The list pane is a
nav of sources; the content pane lists tracks; the player persists everywhere.

## List pane (nav width)

`PaneHeader` 音乐 with `IconButton` 新建歌单 (`plus`). `PaneTools`: `SearchField` (Enter or the
搜索 action searches; keep the 搜索 button name reachable). Rows: 最近 (`history`),
收藏 (`heart`), 搜索结果 (`search`, only after a search), then a small section label 歌单 and
one row per playlist (leading `list` tile, hint `n 首 · 离线保留` when retained).

## Content pane

- `PaneHeader` title = current source (`media.content.title`), subtitle `n 首`; for a
  playlist: actions 分享 (`share`), retention control (keep the `离线保留 · 7 天 ▾` accessible
  name or update the scenario semantically), `Menu` ⋯ with 删除歌单 (danger, confirm says
  tracks are kept).
- Track rows (`media.track`, keep `data-device-cache`): 44 px single-line grid — index or
  playing indicator, title + artist (artist muted, same line on wide, second line on
  narrow), album muted (hidden below 1100 px), 已缓存/离线 `Tag`, duration tabular, trailing
  heart `IconButton` (`收藏<title>`), `Menu` ⋯ (加入队列 <title>, 添加到歌单, 移出歌单). Keep
  accessible names the scenario uses (`加入队列 晨光练习曲`, `收藏晨光练习曲`). Tapping the row
  plays it. The playing row shows the accent colour.
- Empty states per source (`StatePanel` compact); offline search → offline state.

## Player

- In the music area: a 72 px player bar as the content pane footer (`.pane-footer`):
  cover tile (or `media` icon), title/artist, centre controls (上一首, play/pause 48 px round
  accent, 下一首), a seek bar with times, right side: 播完即停 toggle (`IconButton` pressed),
  volume, 队列 (`queue`).
- Outside the music area: the rail mini player (`media.mini`, `media.mini.play` titled with
  the track, landmark `迷你播放器`): a 44 px round play/pause with a progress ring (SVG
  circle) and nothing else; it sits above the status entry in the rail.
- Queue: `Sheet` 播放队列 (`media.queue`) with track rows, 清空 in the header actions.
- Keep the single `media.audio` element.
