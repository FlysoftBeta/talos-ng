# The activity centre

One place, opened from the status entry in the rail (已连接 / 连接中 / 离线 / 同步中 n, with a
badge counting queued, failed and running work), shows everything the app is doing in the
background: synchronisation, changes waiting to be sent, files moving to or from the device and
server-side tasks. It is a sheet over whatever the user is doing and stays readable offline.

## Layout

- Connection, last synchronisation and a one-line summary of queued changes
  ("N 项待同步 · M 项失败", or 所有更改已保存).
- **同步范围** while a synchronisation is paging: each scope (personal data, each conversation,
  each collection, learning corpus, AI sessions) shows 等待中, 正在同步 with the rows received
  so far, or 已可用. A scope marked 已可用 is complete and can be used at once while the others
  continue, so a large account becomes usable piecemeal.
- **需要处理** first: failed changes, failed transfers and failed tasks.
- **进行中**: running and queued tasks, downloads and uploads with a progress bar, and
  changes not yet sent. A burst of edits to the same value (drafts, read marks, reading
  position) waits briefly and is sent as one write; its row says how many changes were
  merged. Offline, queued changes say they send once connected.
- **最近完成** (collapsible, newest first): finished tasks and completed offline downloads.
- 本机与版本: storage use, build, update state with 应用新版本 (also offered by the 需要更新 dialog when the server refuses this version).

## Actions

Every row offers only what applies: **重试**, **取消** (a task or transfer asks for
confirmation; a queued change that was rejected is 放弃, which drops the change and rolls the
view back) and **查看错误**, which expands the plain-language reason in place. Task actions
need a connection and the matching right; otherwise they are disabled with the reason.

## Background tasks

Long-running server work runs as durable tasks, so it survives restarts and disconnections:
document conversion, network-novel downloads, AI runs, music preparation, user purge and
similar. Tasks show state (queued, running, done, failed, cancelled), progress, estimated
remaining time and errors, for the kinds the user may see; unknown kinds show as 后台任务.

- Retry is offered only for kinds that support it, for failed or cancelled work.
- 清理历史 removes older finished records and keeps the newest 100 plus all active work;
  it does not hide the newest failures.
- Task details never expose internal payloads.

Pending items elsewhere carry an amber clock mark, failed items a red mark with an action.
Every list and viewer uses the same set of states: loading, empty, offline and not cached,
error with retry, no permission.
