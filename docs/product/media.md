# Media

Needs the media gate. Music is searched and prepared on the server; the device plays audio
it can fetch live or keeps for offline use.

## Library and search

- Home shows the 12 most recent tracks, favourites and the playlists the user may use. A
  track shows 已缓存 when its audio is already prepared on the server.
- Search (Enter or button) returns bounded results with title, artist and, when the source
  provides it, album and cover. Search, playlist creation/deletion and sharing need a
  connection; preparing audio for a search result happens when it is played or retained.
- Tracks can be favourited (the newest write wins; works offline) and added to or removed
  from playlists by users with write access.

## Queue and playback

- The queue (播放队列) is per user, refreshed when opened: enqueue, remove, clear, replace.
  Queue, favourites and play preference work offline.
- A persistent player bar: play/pause, previous/next, seek, volume, queue, stop; it is
  compact outside the music area.
- At the end of a track the next one plays; an option 播完即停 stops instead. If stopping
  at the end fails, an error is shown.
- Volume is the lower of the user's setting and the administrator's cap, applied before
  audio starts and remembered for offline restart.
- Playback first tries a live stream and checks its length and checksum, then falls back to
  a complete verified copy on the device. Locking or logging out pauses playback and cancels
  a track still being prepared.
- System media keys work where the browser supports them.

## Playlists

- Create (a title), delete (confirmation says tracks are kept), share (read/write/own
  grants as for booklists, roles.md). Playlist members may not downgrade stronger grants or
  revoke without own authority.
- Retention for offline: the audio of a retained playlist is downloaded and kept. Retention
  starts when the playlist is created or retention is set and, once the playlist is played,
  extends to the last play plus 1-365 days. Deleting a playlist releases its retention; its
  tracks stay available to people who still reach them.
- The server drops audio that nothing has used for the administrator-set number of days
  (even for playlist members); the track stays listed and is prepared again on the next
  play.

## Limits

The administrator sets the volume cap and the audio eviction days (admin.md). Tracks found
by search are usable only by the people who found them or hold a playlist grant.
