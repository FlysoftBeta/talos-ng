# 152b — Learning

Rules: `docs/tasks/152-ui-common.md`. Feature `learning` (views + `learning.css`). The
learning scenarios run inside the identity feature: `node tools/e2e/run.mjs identity`
(alias `learning`). Discipline-mode overlays are app-wide (`LearningOverlays`).

## What the area essentially is

A small dashboard and focused practice. The list pane is a short section nav; practice is
focus mode (the frame hides the list pane and shows the back control while the top page is
`learning.normal|speed|clear|discipline`; `PaneHeader` renders the back automatically).

## List pane (nav width)

`PaneHeader` 学习; rows (single line, leading icon): 概览 (`target`), 错词本 (`xcircle`) with
a count `Tag`/badge, 已掌握 (`check-circle`) with count. Selected row = current page.

## Dashboard (概览)

- `PaneHeader` 概览, subtitle with the cache line (e.g. `16 词已缓存`).
- A stats strip: four equal tiles in a CSS grid (`grid-gap`) — 今日练习, 已掌握, 错词, 剩余 —
  number in `--fs-6` tabular, label `--fs-2` muted, on `--raised`, radius 12, no borders.
- Two action cards below: 开始练习 (primary button, short description, a 限时模式 `Switch`
  or `Segmented` 普通 · 限时 if the model has the choice) and 开始清错 (secondary; disabled
  with reason when there are no wrong words).
- 自律模式 as a `Group` with a `GroupRow` + `Switch`/`Segmented` (keep the `自律模式`
  `role=group` + `aria-pressed` contract if the scenario uses it).
- Keep `learning.page` and `learning.stats` hooks.

## Practice (focus)

- `PaneHeader`: back (guarded by the model's confirmation), title 练习 / 限时练习 / 清错,
  subtitle progress `已答 n · 正确 m`, action 结束练习 (ghost button).
- Centred column (max 560 px): the word (`learning.word`) at `--fs-6` with phonetic under it,
  a thin countdown `Progress` for timed modes (`role=timer`), then four answer choices
  (`learning.choice`) as full-width 56 px buttons with 1 px border, radius 12, left-aligned
  text; correct → confirmed-soft fill + check icon, wrong → failed-soft + x icon; others fade.
- 标记为已掌握 as a ghost text button under the choices.
- Summary (本次练习总结): `StatePanel`-like centred block with three stat tiles and actions
  再来一轮 (primary) / 返回概览.
- Exit and resume dialogs: `Dialog` sm with neutral wording, footer buttons (keep 结束并离开).

## Word lists

`PaneHeader` 错词本 / 已掌握 with count subtitle; rows (`ListRow`): word as title, definition
as hint, meta `错 n 次` / `掌握 n`; paging as a footer bar (`上一页`, `n / N`, `下一页`)
consistent with the data-grid pager; 开始清错 as the header primary action on 错词本.

## Discipline overlay

A non-dismissible `Dialog` md titled `自律时刻 · 练习一题` with the same choice styling;
the safe-return action when practice is unavailable.
