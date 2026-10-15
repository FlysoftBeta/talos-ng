# Tasks and the status centre

## Task list

Long-running server work runs as durable background tasks, so it survives restarts and
disconnections: document conversion, network-novel downloads, AI runs, music preparation,
user purge and similar. The 任务 sheet lists the user's own tasks (kinds the user can see)
with state (queued, running, done, failed, cancelled), progress, estimated remaining time and
errors; the list updates live and stays readable offline. Unknown kinds show as 后台任务.

- Retry is offered only for kinds that support it, for failed or cancelled work.
- 清理历史 removes older finished records and keeps the newest 100 plus all active work;
  it does not hide the newest failures.
- Task details never expose internal payloads.

## Status centre

Opened from the status pill in the rail (已连接 / 连接中 / 离线 / 同步中 n, with a badge for
pending or failed changes). It shows:

- connection state and last synchronisation;
- pending changes (amber) and failed changes (red) with retry or discard for each;
- uploads and downloads in progress;
- storage use on the device;
- build and update state.

Pending items elsewhere carry an amber clock mark, failed items a red mark with an action.
Every list and viewer uses the same set of states: loading, empty, offline and not cached,
error with retry, no permission.
