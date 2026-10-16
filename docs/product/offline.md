# Offline model

The interface renders from local data; the server only synchronises it. Connectivity means
the live connection to the server, not the browser's network flag.

## Starting and signing in offline

- An installed app starts without the server. A stalled network never blocks start-up.
- A user who has signed in on the device before can unlock offline with their PIN (checked
  against a locally stored verifier, never the PIN itself, with its own attempt limit).
  An account that never signed in on this device cannot be unlocked offline, and onboarding
  needs the server. Offline unlock is unavailable where the browser lacks the needed crypto
  (an insecure intranet address); online sign-in still works.
- A user without the offline gate sees no cached content while disconnected.

## Signing in while data is still arriving

Successful server sign-in opens the app without waiting for all data to synchronize. Cached
content is usable immediately; missing lists and items fill in as synchronization completes.
The connection status shows ongoing synchronization, and temporary failures retry in the
background. Available online actions can run after authentication; queued changes wait for
safe reconciliation before sending. A later session or admission refusal returns to sign-in
or the device lock screen. Locking remains effective while data arrives.

Missing data during recovery does not remove retained downloads. Cleanup waits until the
app has enough synchronized state to distinguish an absent item from an unfinished load.

## Two kinds of actions

- **Queued**: applied on the device at once and sent when connected. Queued: settings (theme,
  text size, idle lock, do not disturb), conversation state (read position, mute, pin, draft,
  retention), text and sticker posts (shown as 待发送 until acknowledged), announcement
  acknowledgement, reading progress, bookmarks and retention choices, learning answers, AI
  drafts, music favourites, queue and play preference.
- **Online-only**: anything that establishes shared facts the device cannot predict:
  joining or creating a group or direct message, editing or deleting posts, uploads and
  imports, sharing, creating or deleting playlists, music search, network-novel search and
  download, AI sending, every administration action, profile and PIN changes, invitations,
  logout. Their controls stay visible but disabled, and tapping shows the reason.

Transport errors never fail a queued change; it waits. A change the server rejects is listed
in the status centre with retry and discard. A revoked right turns pending changes for that
object dormant instead of sending them. Components never branch on "online"; a control asks
for permission and receives either permission or a reason string.

## Merge rules

Concurrent changes from several devices merge deterministically: settings and conversation
settings take the newest write; read position and furthest reading position take the
maximum; reading time sums per-device totals; learning counters merge per device by
maximum; deleted posts and removed items stay removed. Progress is never lost to an older
device writing later.

## Retained content

Content the user marks 离线保留 (documents, conversations, playlists) is downloaded and kept
until its retention policy expires; policies are listed per area. Only complete, verified
content is readable offline. Offline documents show 未下载 for missing pages. Losing access to
a conversation or collection removes its cached data from the device; gaining access
syncs it.

When device storage runs low, content is evicted in this order: files nobody owns, ordinary
caches by last use, expired retention. Drafts, the pending-change queue, sign-ins and
retention still in its window are never evicted. The status centre shows storage use.

## Updates while offline

A new version is downloaded in the background and applied only after the user confirms
(新版本已就绪); see ops.md.
