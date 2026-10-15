# Operations: updates, backups, HTTPS, host tools

The operations panels live in the administration workbench and are online-only. Settings,
host tools and updates are for root; backups, HTTPS status and document capture are open to
administrators. Root-only actions have confirmation dialogs that name the action.

## Installing and running

A release is a folder with a bundled Node.js runtime, the server bundle, client assets, the
PDF renderer and music helper for the platform, a start script (`start.cmd` or `start.sh`),
autostart helpers (a Windows scheduled-start script, a systemd unit) and licences. Three release targets
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
- Client update: when the server announces a new build, the app downloads it in the
  background and offers 新版本已就绪; it is applied only after explicit confirmation, never by
  reload alone. The previous client version is kept until the new one has booted; two
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
HTTP-to-HTTPS redirect is not cached by browsers.

## Host tools (主机工具)

Root only, audited, fixed commands: close WPS (the host's Office suite, not a browser tab)
and shut down the computer (Windows, with a ten-second grace; unavailable on Linux).

## Opened documents (已打开的文档)

On Windows only, the server captures saved copies of Word, PowerPoint, Excel (and WPS
equivalents) documents currently open on the host, for download. Only what is saved to disk
is captured; unsaved changes are not. The list refreshes every four seconds and can be
refreshed manually. Clearing removes the captures and they are not re-added automatically
while still open; capturing again re-adds them. Elsewhere the panel states it is
unavailable.
