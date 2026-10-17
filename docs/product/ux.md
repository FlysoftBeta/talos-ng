# User experience

How the interface is organised and why. Feature behaviour is in the per-area documents; how
the design system is built is in `docs/impl/design-system.md`. This document is binding for
every screen: a new screen uses these patterns or the patterns change here first.

## Principles

1. **Calm, dense, legible.** The app is a working tool on shared tablets, used for hours.
   Content is the loudest thing on screen; chrome is quiet. No decoration that does not carry
   information, no cards inside cards, no shadows except on things that float.
2. **One pattern per job.** A list is always the same list, a sheet always the same sheet,
   a destructive action always confirms the same way. Users learn the app once.
3. **The user always knows what the system is doing.** Connection, synchronisation, queued
   and failed work, downloads and updates have one home (the status entry in the rail) and
   appear inline where they matter — never as surprise pop-ups.
4. **Local first.** Screens render at once from the device. Waiting for the network is never
   a precondition for showing known content; a spinner never replaces content that exists.
5. **A control that cannot act says why.** Unavailable actions stay visible and look
   disabled; touching one explains the reason in a short toast (需要连接服务器, 无权限 ...).
6. **Safe on shared devices.** Locking is one tap away at all times; nothing of another user
   survives a lock.

## Information architecture

The app is a set of **areas**, each owning one kind of work. What an area essentially is
decides its layout, not the other way round.

| Area | Essence | Layout |
|---|---|---|
| 对话 chat | conversations, each a time-ordered stream | collection list + stream |
| 最近 recent | what the user opened lately across chat, reading and music | one frecency-ranked list (conversations, books, booklists, songs, playlists; length follows the data; empty state when no history); unread messages lift a conversation the user engages with, never above their own usage pattern; selecting an item opens it in its own area |
| 阅读 library | collections of documents; reading is immersive | collection list + document list; reading is focus mode |
| 学习 learning | a dashboard and practice sessions | section nav + page; practice is focus mode |
| 音乐 music | browse, then play while doing other things | section nav + track list; player persists everywhere |
| AI | conversations with an assistant | collection list + stream |
| 管理 admin | many tables of records, online only | section nav + table |

Settings and the activity centre (sync, queued changes, transfers, background tasks) are **sheets**, not areas: they are visited
briefly over whatever the user is doing.

### The frame

```
┌────┬──────────────┬──────────────────────────────────────────┐
│rail│ list pane    │ content pane                             │
│    │ ┌──────────┐ │ ┌──────────────────────────────────────┐ │
│ 对 │ │ header   │ │ │ header: back · title · actions       │ │  56 px, aligned across panes
│ 阅 │ ├──────────┤ │ ├──────────────────────────────────────┤ │
│ 学 │ │ tools    │ │ │                                      │ │
│ 音 │ │ rows …   │ │ │ content                              │ │
│ AI │ │          │ │ │                                      │ │
│    │ │          │ │ │                                      │ │
│ ♪  │ │          │ │ ├──────────────────────────────────────┤ │
│ 状 │ │          │ │ │ footer (composer, player)            │ │
│ 任 │ │          │ │ └──────────────────────────────────────┘ │
│ 设 │ │          │ │                                          │
│ 管 │ │          │ │                                          │
│ 锁 │ └──────────┘ │                                          │
└────┴──────────────┴──────────────────────────────────────────┘
```

- **Rail** (always visible): the six areas on top; below a flexible space the compact player
  (only while a track is loaded), then 状态, 任务, 设置, 管理 (administrators), 锁定. Each
  entry is an icon with a short label. The current area has a tinted indicator. Unread
  counts appear as a badge on 对话. An area the user may not use is hidden.
- **悬浮启动器** (rail, above 设置; only where the browser supports video
  Picture-in-Picture and canvas capture): opens a small always-on-top window showing
  shortcut tiles for the reachable areas and the top recently used items. The window's
  previous/next-track buttons move the highlight and its play/pause (click) button opens the
  highlighted entry: the app window is focused and navigates to it. Pressing the rail
  entry again, or closing the window, ends it.
- **List pane**: what the area contains — conversations, collections, sections. Two widths
  only: *collection* (rows with a preview) and *nav* (short section names).
- **Content pane**: the selected thing. Its header has the same height as the list header,
  so one horizontal line runs across the window.
- **Focus mode**: reading a document and a practice round hide the list pane; the content
  header shows a back control. Leaving focus restores the list exactly as it was.
- **Narrow windows** (below 720 px): list and content stack; opening something shows the
  content with a back control. Overlays become full-width.

### Navigation model

- No URL; the address never changes. The app reopens where the user was, per user.
- Each area keeps its own stack, so switching areas loses nothing. Back closes the topmost
  overlay, then pops the area stack, else does nothing. The browser Back button conceals the
  app (identity.md).
- Gate order: boot, device locked, signed out or onboarding, app locked, app.
- With nothing selected, the content pane is quiet: a faint area mark and one short hint,
  no title and no actions.

## System state

One vocabulary, used everywhere:

| State | Colour | Where it shows |
|---|---|---|
| connected, idle | none (neutral) | rail status entry: 已连接 |
| connecting | neutral, spinning mark | rail: 连接中 |
| syncing | accent, spinning mark | rail: 同步中 n |
| offline | amber | rail: 离线; online-only controls disabled with reason |
| pending (queued) | amber clock | rail badge with count; inline mark 待发送 / 待同步 on the item |
| failed | red | rail badge (red wins); inline mark with 重试; the activity centre lists failed work with 重试 / 取消 / 查看错误 |
| progress | accent bar | activity centre, inline on the item |
| update ready | accent dot on the status entry | the activity centre offers 应用新版本 |

- The rail status entry is the single home; it opens the one activity centre.
- Badges carry a count or are hidden; never an empty dot (except update ready).
- Offline is normal for a local-first app: no global banner, no modal. Only things that
  cannot work offline change, and they say why.
- Every list and viewer uses the same five states: loading, empty, not cached offline
  (离线未缓存), error with retry (出错，可重试), no permission (无权限). Loading appears only
  after a short delay, so fast local reads never flash a spinner.
- Transient confirmations and disabled reasons appear as one toast at the bottom centre,
  one at a time, gone after a few seconds.

## Interaction patterns

- **Lists**: full-width rows inset in the pane, rounded hover/selected background, no
  dividers. Two heights: single-line 44 px, two-line 56 px (with a 36 px avatar or icon).
  Tapping a row opens it. A row's other actions live in a trailing ⋯ menu; the selected row
  may show one or two direct actions.
- **Pane headers**: title on the left (one line, ellipsis), at most three icon actions on
  the right, more go into a ⋯ menu. The list header holds the area's create action (+).
- **Pane tools**: a search field or a segmented switch directly under the list header; no
  extra borders.
- **Sheets** (side panels from the right) for settings, status, tasks, details, sharing,
  editors of one record. **Dialogs** (centred) for confirmations and short forms. **Menus**
  for row and overflow actions. Overlays never become full-page routes.
- **Buttons**: one primary action per surface (filled accent), secondary actions outlined,
  tertiary as plain text; destructive confirmations use a filled red button. Buttons carry
  verbs. Dialog actions sit bottom right: cancel, then the primary action.
- **Destructive actions** always confirm in a dialog that names the object or count.
- **Forms**: label above the field, hint or error below, fields stacked with even spacing,
  primary action at the end. Choices with two to four options are segmented controls;
  longer lists are pickers from the design system (no native select).
- **Composer** (chat, AI): one row that grows to five lines; Enter sends, Shift+Enter breaks.
- **Motion**: 120-180 ms, opacity and position only.
- **Touch**: targets at least 40 px; text selection and gestures are suppressed except in
  inputs and selectable content; pinch is cancelled except where the viewer zooms.

## Visual language

- **Colour**: neutral greys for structure; one accent (blue) for interaction — primary
  buttons, the current area, focus, links and progress; amber, red and green for state only.
  Light and dark themes use the same roles; dark is a true dark theme, not inverted.
- **Type**: the system CJK sans; a six-step scale (12, 13, 14, 16, 20, 28). Body 14 px;
  reading text (chat bodies, documents, AI answers) uses a taller line height. 大字 enlarges
  the text steps, not the layout.
- **Space**: a 4 px grid; pane gutters 16 px (24 px in wide content panes); 56 px headers.
- **Surfaces**: rail and list pane share a tinted sidebar surface; the content pane is the
  plain surface. Hairline borders separate panes. Shadows only on sheets, dialogs, menus
  and toasts. Radii: 8 px for controls and rows, 12 px for floating surfaces.

## Words

Short, concrete Chinese; buttons carry verbs; destructive actions name the object or count;
no blame and no jokes at the user's expense (learning exit dialogs use neutral wording).
Error messages are Chinese, come from the server and describe a business denial as what it
is, never as an internal error. Dates and times: zh-CN, Asia/Shanghai.

## Chat-specific requirements

Posts are rows, not bubbles: avatar, author and time head a group of consecutive posts by the
same author; date separators divide days; inline actions appear on the selected post. The
composer is one row that grows; history pages load at the scroll boundary.
