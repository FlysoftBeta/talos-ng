# Settings and the user's own account

The 设置 sheet, opened from the rail, contains:

- **Profile**: handle and display name, edited independently; online only.
- **PINs**: replace one or two PINs by entering a current PIN first; replacing the set
  signs out the account's other devices; collisions with any other PIN or invitation are
  refused. Online only.
- **Preferences** (work offline, shown as 待同步 or 同步失败 while unsent): theme (light, dark,
  follow system), text size (standard, large), auto-lock after 1, 5 or 15 minutes of
  inactivity or never, do not disturb.
- **About**: version, device ID, server address, storage use, browser. Usable offline.
- **Lock** and **log out** (online) — see identity.md.
- **Reset local data**: deletes the data held on this device and reloads. It keeps the
  device ID and the installed app. The confirmation states how many pending and failed
  changes across all accounts cached on the device would be lost. If other tabs block the
  deletion, the sheet asks to close them and completes afterwards.

Preferences follow the user to other devices; a newer write wins. Users cannot see or
revoke their own sign-ins on other devices.
