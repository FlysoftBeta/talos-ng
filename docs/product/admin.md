# Administration workbench

The 管理 area is for administrators and is online-only: every query pages on the server,
nothing is cached on the device, and every section shows 离线不可用 when disconnected. The
section list shows the sections the user's roles allow; the server rechecks each operation.
Roles and powers are in roles.md. Lists share a grid with paging, sorting, search, row
selection with bulk actions, hideable columns and expandable cells. Destructive and bulk
actions confirm, naming the object or the selected count, and bulk results stay visible
afterwards.

## Users

Search and page users; create a user (handle, display name, PIN; feature gates optional);
edit profile, reset PINs, roles (root; the editor shows dependencies before saving), feature
gates (feature managers), discipline mode and AI credits.

- Restrictions: mute (preset or custom hours/days, or permanent) and ban (preset, custom or
  permanent). A ban ends the user's sign-ins. Bulk enable does not extend an already active
  restriction; unban clears it.
- Deactivate keeps the historical identity; purge removes the account and all its data
  through a background task. Neither can be applied to oneself or the last root.
- Bulk operations apply to each selected user independently and report per user. Fields
  can be left unchanged, enabled or disabled.

## Invitations

Generate one-use invitation PINs (shown once), list pending and used, revoke singly or in
bulk. Revoked or expired PINs stop working.

## Devices

Search devices by ID, remark or bound user; edit remark, bound user and whitelist; promote,
lock, unlock, delete (with a warning that sign-ins end). Policy: whitelist on/off and the
identity signals required to match (browser ID always; User-Agent and IP optional). See
identity.md.

## Groups and announcements

Create and edit groups (type is fixed once created; system groups are protected and
skipped in batch deletes), hierarchy, handle, name, password, discoverability, members
hidden, admin-only, no-leave. Members are added by exact handle (case-insensitive) or
removed singly or in bulk; hidden members show as a read-only chip.

Announcements: publish text as a new revision that everyone must acknowledge again;
history shows each revision with its acknowledgement count.

## System settings

System lock and idle lock switches, the media volume cap (steps of 0.05) and the audio
eviction days. The system lock stops everyone but administrators from using the app; the
idle lock applies the five-minute inactivity policy to devices.

## AI billing

Plan and top-up totals, consumption chart, daily and weekly allowance and default plan
length (ai.md).

## Incidents

Client and server faults are recorded without their payloads: source, build, environment
and redacted stack frames only. The list has environment and build filters, grouping with
counts, details and related IDs, and a ZIP download of incidents, audit and the current
build's server logs. Self-tests trigger a real window error and a failing call to prove the
path works. Each browser keeps at most 20 reports and the server accepts 30 per user per
minute.

## Audit log

Root reads a paged audit log (100 per page) of administrative actions: actor, action,
target and full details. Records keep the actor's ID after a purge.

## Debug

Root only: a per-client force-offline switch that lasts until reload (never persisted).
