# Chat and community

## Conversations

Conversations are groups and direct messages (DMs). The list is ordered pinned first, then
latest activity, then name, with unread badges. With nothing selected the content pane shows
a welcome. Opening a conversation shows the position of the first unread post (marked
以下为未读消息), otherwise the latest; history loads in both directions as the user scrolls
and a floating "latest" control appears while reading older posts. Gaps in offline history
are stated explicitly. Fully visible posts mark the conversation read; live posts scroll
into view only when the reader is at the bottom.

Per conversation the user can: pin, mute notifications, and choose offline retention
(auto, one week, half a year). Pin, mute, draft and retention work offline. Week and
half-year retention are rolling windows from each post's send time, refreshed as posts
arrive and hourly, and download text, thumbnails, originals and stickers; auto keeps
nothing for offline use.

## Groups

- Two system groups, 广场 (the wild group) and 公告 (announcements), exist always; every
  active user belongs and cannot leave. Their type cannot be created, promoted or changed.
- A user can create a group: name, optional handle (letters, digits, underscore, hyphen,
  1-32 characters), optional password, discoverability and a parent group they have joined.
  The type of an ordinary group is fixed. Groups can be marked members-hidden, admin-only
  (only managers post) or no-leave by administrators.
- Finding groups: searching by name or handle shows only discoverable groups whose parent
  the user can see; a group's children can be listed from the parent. Joining asks for the
  password when one is set and is validated against how the group was found.
- Members: the member list can be hidden by the group (non-managers then see no list) and
  each member can hide themselves from it; hiding affects the directory, not the author name
  on existing posts. A member leaves via the member dialog unless the group is no-leave;
  leaving the last member of an ordinary group deletes it.
- DMs: started from a member row; require a shared group that both can see. One DM exists
  per pair. Existing DMs survive leaving the shared group.

Creating or joining, DMs, leaving and the member dialog need a connection.

## Posts

- Types: text (up to 5,000,000 UTF-16 units; long text is sent in chunks and the card shows
  a preview with 阅读全文), stickers (the shipped catalogue, 1,062; recent picks persist per
  user), images (PNG, JPEG, GIF or BMP up to 12 MiB; a preview of at most 480 px is
  generated on the server; animated images preview their first frame; 查看原图 opens the
  original). Image posting needs the image gate and a connection.
- Replies: a reply shows an 80-character preview of its target, tapping it jumps there, and
  the composer can cancel a reply. The target must be readable, not deleted and in the same
  conversation.
- Composer: one row growing to five lines; Enter sends and Shift+Enter inserts a line break;
  a fullscreen editor serves long text. Text is trimmed and must not be blank. Drafts are
  saved per conversation and survive restart; failed sends keep the draft and error.
- Text and stickers can be posted offline: shown as 待发送 and cancellable, failures remain
  retryable or discardable. Images, edits and deletions need a connection.
- Authors edit their own text posts (an edited marker is shown); the author and community
  managers (and root) delete. A deleted post keeps its place, its reply links and a deleted timestamp
  and loses its body and attachments; deletion is permanent. A muted user cannot post or
  edit but can delete their own posts.
- Cards show author and zh-CN date separators in Asia/Shanghai; a missing author shows
  无主内容.
- Admin-only groups hide the composer for non-managers; a mute shows its remaining time.

## Announcements

Announcements are published from the workbench by advanced community managers (and root);
posting in the 公告 group needs community manager or root. The newest announcement blocks
the screen until acknowledged (it cannot be dismissed with Escape or the backdrop). Each
publication is a new revision that must be acknowledged again; acknowledging an old revision
never covers a newer one. Acknowledgement works offline.

## Notifications

A new post from someone else outside the open conversation shows a banner (60-character
preview, 4.5 seconds). Tapping it opens the conversation; swiping up by 48 px dismisses it.
No banner appears for muted conversations, do-not-disturb, the user's own posts or the open
conversation.

## Access follows membership

Leaving or losing a conversation removes its cached posts and images from the device and
withdraws grants inherited through the group. Unsent drafts stay stored. Root and
administrators have management powers (mute, delete, announcements; all audited) but read
and post only in conversations they belong to.
