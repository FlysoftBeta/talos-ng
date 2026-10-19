# Goals and constraints

## Goals

- A community app for a school: talk in groups and direct messages, read books, listen to
  music, ask an AI assistant, administer all of it from the same app.
- Safe to put on shared tablets: the interface can be concealed, sign-in is by PIN, devices
  are admitted by policy, and administrators control who may do what.
- Useful with an unreliable network: everything already on the device keeps working, many
  actions are queued and sent later, and the user always sees what state the system is in.
- Operable by a small school: one server process on a Windows or Linux machine, updates
  that roll back on failure, complete backups, no host prerequisites.

## Hard constraints (product facts)

- **Clients are tablets running Chrome 70 to 80.** Every client feature works on Chrome 70:
  nothing newer (layout, script or browser API) is relied on, and the product is tested on a
  real Chrome 70.
- **The app works offline through a ServiceWorker.** Once installed, the app starts without
  the server and shows cached content. First installation needs a secure context (HTTPS or
  localhost) and the server.
- **All client data is stored locally in IndexedDB and never as Blob values.** Files are
  kept as ArrayBuffer chunks; there is no other persistent browser storage for user data.
- **Deployment targets** are Windows (x64) and Linux (Debian and Red Hat families, x64). A
  release is one folder: bundled Node.js runtime, server bundle, client assets, the PDF
  renderer for the platform, a start script and an autostart helper (Windows scheduled-start script
  or systemd unit), and licences. Server and tools work on both operating systems.
- **One self-hosted server** (Node.js with SQLite). The server needs no native addons and no
  external services except those a feature is configured to use (AI provider, music search,
  network-novel source).
- **Intranet only.** The product assumes a concealed school network; it is not hardened for
  the public internet.
- **Interface language is Simplified Chinese**; error messages shown to users are Chinese
  and produced by the server. A business denial is never presented as an internal error.

## Non-goals

- No teacher/student distinction: authority comes from administrator roles and feature
  gates, not from a user type.
- No native/kiosk shell; the launcher manages server processes and updates, not the browser.
- No multi-device conflict-resolution screens: concurrent changes merge by fixed rules.
