# 152e — Settings, tasks

Rules: `docs/tasks/152-ui-common.md`. Features `settings` (sheet, profile, PIN replacement)
and `tasks` (`view.tsx`). e2e: `node tools/e2e/run.mjs identity` (settings, PINs, lock,
reset) and `library` (tasks).

## Settings sheet (`Sheet` 设置)

iOS-settings style `Group`s, each row a `GroupRow`:

- Account: avatar + display name + `@handle` as a header row; 编辑资料 row (opens the profile
  form inline or as a `Dialog` sm); 更换 PIN row (the PIN replacement flow in a `Dialog`
  with the gate-card PIN pad styling from `features/auth/view/auth.css` reused by class, or
  a local copy).
- 外观: 主题 `Segmented` 浅色 · 深色 · 跟随系统 (keep `role=group aria-label=主题`), 文字大小
  `Segmented` 标准 · 大字.
- 安全与提醒: 自动锁定 `Segmented` 关闭 · 1 分钟 · 5 分钟 · 15 分钟, 免打扰 `Switch`.
- Pending/failed preference writes: a `Mark` 待同步 / 同步失败 on the row.
- 关于: version, device ID (selectable, mono), server, storage, browser as `GroupRow`s.
- Bottom: 锁定 (secondary) and 退出登录 (danger-ghost, disabled with reason offline) side by
  side; 重置本机数据 as a separate danger-ghost row with its confirm dialog naming the count of
  pending and failed changes.

## Tasks sheet (`Sheet` 任务)

Rows per task: leading icon by kind, title, hint = state text (排队中, 进行中 · 剩余 n, 已完成,
失败: reason, 已取消) with `Progress` under running ones; trailing actions 重试 / 取消 as small
buttons. Group into 进行中 and 已结束 sections. Header action 清理历史 (ghost button). Empty →
`StatePanel` 没有后台任务. Offline: list stays, actions disabled with reason.
