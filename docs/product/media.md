# Media

Needs the media gate. Music is searched and prepared on the server; the device plays audio
it can fetch live or keeps for offline use.

## Library and search

- Home shows the 12 most recent tracks, favourites and the playlists the user may use. A
  track shows 已缓存 when its audio is already prepared on the server.
- Search (Enter or button) returns bounded results with title, artist and, when the source
  provides it, album. Search, playlist creation/deletion and sharing need a
  connection; preparing audio for a search result happens when it is played or retained.
- Search does not create a playlist or save every result permanently. Save a song explicitly
  to a writable playlist, either from search results or from a playlist you can access. The
  add-song picker names that source; there is no all-system music catalog.
- Tracks can be favourited (the newest write wins; works offline) and added to or removed
  from playlists by users with write access. Favourites, recent plays and queues do not
  keep a song permanently or grant access on their own.

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

- Create (a title), delete with confirmation, share with read/write/own grants. There is no
  allow-transfer setting for music. Anyone who can access a playlist can copy its songs into
  another writable playlist and share the source playlist at their own grant level or below.
  Members may not downgrade stronger grants, change the original owner's access, or revoke
  without own authority. A saved copy remains accessible after the original grant is revoked.
- Each user can set offline retention for an individual song or an accessible playlist:
  auto, or 1–365 days. These are personal settings, including for read-only shared playlists.
  Creating or sharing a playlist never enables background downloads for another user.
  Auto requests no explicit retention. An explicit policy downloads the audio and expires
  after the selected duration from that user's policy change or latest use, whichever is
  later. Several applicable personal policies combine using the latest deadline. Clearing
  one policy does not cancel the user's other policies. Removing membership or losing access
  releases the affected ownership; other accessible copies and applicable policies survive.
- Songs without any playlist references are reclaimed **after a delay**, including search
  results that were never saved. The delay is fixed at 30 days, measured from discovery
  for never-saved songs or from the removal
  of the last playlist reference. Adding a playlist reference cancels reclamation; a later
  last removal starts a new period. Searching again, playing, favouriting and queueing do
  not extend this period. No built-in music collections are created.
- Scheduled reclamation removes the song's audio references, discovery access, favourites,
  queue entries and recent-play entries. Search can discover the song again afterwards.
- Separately, the server drops audio that nothing has used for 30 days
  (even for playlist members); the track stays listed and is prepared again on the next
  play.

## Limits

The administrator sets the volume cap (admin.md). Audio cache expiry and unreferenced-song
reclamation each have their own fixed 30-day period. Tracks found
by search are usable only by the people who found them or hold a current playlist grant.
Search discovery grants access while the track exists; it never prevents reclamation.
A provider identifier, favourite, queue entry or root role alone cannot reveal or open
someone else's private track. Expired search rows disappear when the device synchronises.
