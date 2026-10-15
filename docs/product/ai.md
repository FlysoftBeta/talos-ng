# AI assistant

Needs the AI gate and a configured provider; without configuration sending is disabled while
history and drafts remain.

## Conversations

- A sidebar lists the user's AI conversations with unread and running indicators and the
  day and week credit percentages. Search covers the cached titles and tags and is free.
- Send: Enter sends, Shift+Enter inserts a line break. Input is up to 100,000 characters
  and up to four images (PNG, JPEG, WebP or GIF, 5 MiB each); an image alone cannot be
  sent. Answers stream in. Drafts are saved and survive restart; long text works like chat.
- The composer explains why it cannot send: offline, not configured, a run already active
  in the conversation, busy, empty, or insufficient credit.
- Stopping a run cancels it. A disconnect of the device never cancels a run; it continues
  on the server and the finished answer is there when the device returns. After a server
  restart queued runs resume; a run whose stream was interrupted fails and keeps its
  partial text (retrying is a new send).
- Fork: choose a message to create a separate conversation owned by the user containing
  history up to that message. Only a bounded part of the history is sent to the model; when
  a conversation outgrows it the user is told to start a new one.
- Answers render Markdown and mathematics (offline too), with links asking before leaving
  the app. Raw HTML and remote images are not shown, and Mermaid diagrams appear as labelled
  source. History is readable offline; opening a file not yet downloaded shows 离线未缓存.

## Credits

Each run reserves credits up front and settles once, capped at the reservation.
Credits come from plan allocations (a daily and a weekly allowance for a number of days,
windows by UTC day and Monday-start week) and top-ups. Usage in
interrupted runs is estimated from the visible text. Credit grants are idempotent.

## Writing workspace

The assistant can read and write the user's own workspace: text, Markdown and safe SVG
files, in up to two folder levels, at most 256 files and 10 MiB per user. It never touches
host files or runs code. The user browses it, with deletion confirming the path. Edits need
a connection. Workspace files are included in backups.

## Administration

Feature managers manage accounts (plan days, top-ups with a note; batch top-ups retry only
failures), the billing policy (daily and weekly allowance, default plan length) and see
totals and consumption in the workbench (admin.md).
