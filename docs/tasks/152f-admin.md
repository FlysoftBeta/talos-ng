# 152f — Administration workbench and ops panels

Rules: `docs/tasks/152-ui-common.md`. Features `admin` (views + `admin.css`) and `ops`
(views + `ops.css`, the gallery in `features/ops/gallery.tsx`). e2e:
`node tools/e2e/run.mjs admin` and `node tools/e2e/run.mjs ops`.

## What the area essentially is

Many tables of records, online only. The workbench opens from the 管理 rail entry and uses
the frame with a nav-width list pane (`listKind="nav"` is already set by the app frame).

## List pane

`PaneHeader` 管理; the section list (landmark `aria-label=管理栏目`, current section
`aria-current=page`) as single-line rows with icons: 用户 `users`, 邀请 `ticket`, 设备
`device`, 群组 `hash`, 公告 `announce`, 系统 `sliders`, AI 额度与统计 `coins`, 运维 · …
`server`, 事件 `bug`, 审计 `audit`, 调试 `wrench`/`settings`. Group them with small muted
section labels (成员与设备 · 社区 · 系统 · 诊断) if the descriptors allow it cheaply.

## Section pane

- `PaneHeader` title = section, subtitle = total count; primary action of the section as a
  header button (创建用户, 创建邀请, 发布公告 …).
- The `DataGrid` fills the pane body (pass a height computed from the pane; avoid fixed
  432 px leaving empty space) inside `--gutter-content` padding; `SelectionActionBar` above
  it when rows are selected; row actions are `GridAction` icon buttons in the pinned end
  column (keep the `aria-label`s).
- Offline: one `StatePanel` offline (离线不可用) for the whole section.
- Editors (user, device, group, members, mute, discipline, credits): `Sheet` with `Group`s of
  fields and a sticky footer (取消 · 保存); destructive and bulk actions confirm with the
  count; bulk reports (`admin.users.bulk.report`) as a results list with `Mark`s per user.
- Invitation result: the same large one-time PIN block as `auth-invite` (`admin.invitations.pin`).
- System: `Group`s with `Switch`es and a volume-cap stepper/slider; 公告: composer `TextArea`
  + history rows with acknowledgement counts.
- Incidents: filter row (`SelectField hideLabel`s + search), grid, detail `Sheet` with
  monospace stack frames.
- Keep every `admin.*` and `ops.panel` hook and the ARIA names listed in `e2e-hooks.md`.

## Ops panels

Each panel (`ops.panel`): `Group`s of `GroupRow`s with values and actions; long operations
show `Progress` and `Mark`s; disabled actions carry `disabledReason`. The update upload shows
a file field, progress and the staged version.
