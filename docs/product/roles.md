# Roles and permissions

## Users and administrators

Every account is a user. A user may additionally hold administrator roles. There is no
teacher/student type.

| Role | May |
|---|---|
| administrator (base) | open the administration workbench, list users; use backups, HTTPS status and document capture. Grants no other power by itself. |
| root | assign roles and feature gates, create invitations, read the audit log, use debug controls, change ops settings, run host tools, manage updates |
| access manager | create users and invitations, manage devices and the device policy |
| community manager | edit and mute/ban users, reset PINs, edit groups, set media policy, delete any chat post (audited) |
| advanced community manager | edit profiles, deactivate and purge users, manage group membership, publish announcements; implies community manager |
| feature manager | edit users' feature gates, manage AI credits and billing policy, import words, impose discipline mode |
| operations assistant | system lock and idle lock |
| operations | incident workbench |

Every specialist role requires the base administrator role (advanced community manager also
requires community manager); the editor shows these dependencies before saving. The last
active root cannot be removed.

## Feature gates

Per-user switches set by administrators: offline use, articles (library), reader for text
articles, reader for e-books/PDF, learning, article download (network novels), AI, media,
image posting. The reader, e-book and article-download gates also need the articles gate.
A gate that is off hides the area and is rejected by the server. A user without the offline
gate sees no cached content while disconnected.

## Access to resources

Roles and gates never imply access to a particular document, collection, playlist or
conversation, for root and administrators too. Access comes from:

- ownership (the uploader keeps ownership of a document);
- conversation membership;
- an explicit read, write or own grant on a collection or playlist, given to a user or a
  group.

Only owners, or holders of a grant marked delegable, can pass access on; a delegate cannot
weaken a stronger grant, change the owner's access or revoke without own authority. Adding
a received document to another collection needs a delegable path. A favourite or bookmark
never grants access. A music track reference is not a grant: each track operation needs the
user to have discovered the track or hold a current playlist grant. Removing a grant stops
downloads at once and removes the cached data from the device.

## Online enforcement

The server re-checks authority on every operation from current data; what the interface
hides is only a convenience. Role changes, gate changes and grants reach open devices
immediately. Banning a user ends their sign-ins at once.
