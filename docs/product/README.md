# Talos II — product description

Talos II is a school-community app for shared, managed tablets on a closed school network.
Members sign in with a six-digit PIN and use chat (groups and direct messages), a reader for
imported PDF/text books and downloaded network novels, vocabulary practice, music, an AI
assistant and, for administrators, an online workbench. One self-hosted server holds all
data. The app is local-first: the interface renders from data kept on the device and the
network only synchronises it, so it starts and stays useful when the server is unreachable.
The interface language is Simplified Chinese; dates use Asia/Shanghai.

These documents describe the product as it is: what users can do, the states and rules,
offline behaviour and limits. How it is built is in `docs/impl/README.md`; the history of
decisions is process material kept apart from these documents.

| Document | Covers |
|---|---|
| [goals.md](goals.md) | goals and the hard constraints stated as product facts |
| [roles.md](roles.md) | users, administrator roles, feature gates, resource access |
| [offline.md](offline.md) | the offline model: queued versus online-only, retention, eviction |
| [identity.md](identity.md) | concealment, PIN sign-in, onboarding, devices and admission |
| [chat.md](chat.md) | groups, direct messages, posts, announcements, notifications |
| [library.md](library.md) | booklists, import, reader, sharing, network novels |
| [learning.md](learning.md) | vocabulary practice, word lists, discipline mode |
| [media.md](media.md) | music search, queue, playlists, playback |
| [ai.md](ai.md) | AI conversations, credits, writing workspace |
| [activity.md](activity.md) | the activity centre: sync, queued changes, transfers and background tasks |
| [settings.md](settings.md) | the settings sheet, diagnostics, local reset |
| [admin.md](admin.md) | the online administration workbench |
| [ops.md](ops.md) | updates, backups, HTTPS, host tools, document capture |
| [ux.md](ux.md) | UX principles and layout requirements for the interface |
