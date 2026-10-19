# Operations: updates, backups, HTTPS, host tools

The operations panels live in the administration workbench and are online-only. Settings,
host tools and updates are for root; backups, HTTPS status and document capture are open to
administrators. Root-only actions have confirmation dialogs that name the action.

## Installing and running

A release is a folder with a bundled Node.js runtime, the server bundle, client assets, the
PDF renderer and music helper for the platform, licences and a single start script for its
platform (`start.cmd` on Windows, `start.sh` on Linux); autostart is left to the operator. Three release targets
exist: Windows x64, Debian-family Linux x64 and Red Hat-family Linux x64; an installation
keeps its target through updates and rollbacks, and an update for another target is refused.
The server can listen on several ports and an HTTPS listener.

## Updates (更新)

- Server update: root uploads an update package (up to 512 MiB, hashes verified), or enables
  a cloud manifest URL with automatic checking (at most every 15 minutes) and installs
  explicitly. Staging prepares a complete rollback snapshot (application and database) and
  does not touch the running server. Applying restarts the server into the new version.
- The new version must be confirmed in the workbench within three minutes; otherwise, or if
  it fails to start, the previous version and the database are restored. A staged update
  that was not applied is not applied by a restart.
- Client update: a released server accepts only clients of its own build. A client of any
  other build is refused when it connects, downloads the server's build in the background and
  asks 需要更新: 现在更新 applies it at once (downloading first if needed); 保持离线 keeps the
  app working offline on saved content, with 需要更新 · 现在更新 still offered in the activity centre
  (retrying a failed download) and a dot on the status entry.
  An update is never applied without that choice, nor by reload alone. The previous client version is kept until the new one has booted; two
  unconfirmed starts roll back. Navigating never applies an unconfirmed update.
- A first install needs HTTPS or localhost.

## Backups (备份)

Each backup is a complete, independent snapshot of the database and every file the data
refers to, with checksums. A backup that cannot be completed is never kept. Default
retention is the newest five (adjustable 1-100); a daily backup runs at Beijing midnight
(a missed day is made up after start-up); administrators can create, list, delete and
download backups (a streamed archive, no size cap). Configuration, TLS keys and logs are not
included.

Restore is a server command run while the server is stopped: it verifies every checksum, the
database integrity and that every referenced file exists before changing anything, keeps the
previous database as a copy, and never deletes unrelated files. It works offline.

## HTTPS

The panel reports the configured domain, listeners, certificate expiry, DNS and trust
guidance, and offers the root certificate download (also available over HTTP). TLS itself
is configured in the server configuration file, not in the panel. An operator-configured
HTTP-to-HTTPS redirect is not cached by browsers and only moves Chromium 80+ browsers; older
browsers keep using HTTP, where 现在更新 simply reloads the page from the server.

## Host tools (主机工具)

Root only, audited, fixed commands on the Windows computer running the server (unavailable
on Linux):

- **重置教学环境** (reset the teaching environment) prepares the classroom computer for the
  next lesson: it closes open folder windows (the desktop and taskbar stay), Microsoft
  Office (Word, PowerPoint, Excel), WPS, Seewo EasiNote (希沃白板) and the Seewo visualiser
  (视频展台). Unsaved work in those programs is lost; the confirmation says so.
- **立即关机** shuts the computer down after a ten-second grace.
- **定时关机** shuts it down after a chosen delay (presets or hours and minutes, up to 24
  hours) using the app's one duration control. The panel shows when the pending shutdown
  happens; a new schedule replaces the old one and **取消定时关机** cancels it. The server
  remembers only the schedule it set since it last started.

## Opened documents (已打开的文档)

On Windows only, the server captures saved copies of Word, PowerPoint, Excel (and WPS
equivalents) documents currently open on the host, for download. A document is found when
the program reports it through automation or when it was opened from a file (its path is on
the program's command line), so a document presented full screen straight after opening is
found too. Only what is saved to disk is captured; unsaved changes are not. A document that
cannot be read at the moment (locked, over 100 MiB, or changing while copied) is skipped and
tried again on the next refresh; it never hides the others. The list refreshes every four
seconds and can be refreshed manually. Clearing removes the captures and they are not
re-added automatically while still open; capturing again re-adds them. Elsewhere the panel
states it is unavailable. Capture works when the server runs in the signed-in teacher's
Windows session (the start script started from that session); a server started as a
background service cannot see that session's programs.
