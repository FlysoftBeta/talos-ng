# Identity, devices and onboarding

## Concealment

The app starts concealed: a blank screen. A hidden gesture reveals sign-in: up, up, down,
down, left, right, left, right, given as taps on the screen's edge zones (top third, bottom
third, left and right thirds of the middle) or arrow keys / WASD. Any wrong input resets the
sequence. Mouse events synthesised by a touch are ignored for 700 ms.

Locking conceals the app immediately and pauses music. Triggers: the lock button in the
rail, the browser Back button or hardware back (intentionally), and the idle timer. Locking
keeps the signed-in account; unlocking offline needs the PIN. Locking or logging out cancels
a track still being prepared, so a concealed app never starts audio.

## Signing in

- The credential is a six-digit PIN, unique across all users and live invitations, so
  there is no account name at sign-in. The sixth digit submits automatically. A touch
  keypad and the keyboard (digits, Backspace, Delete) both work.
- Successful online sign-in and onboarding open the app while data continues synchronizing
  in the background; incomplete synchronization does not hold the PIN screen open.
- A user has one or two PINs; the second is an equivalent credential for the same account,
  not a confirmation or duress code.
- A sign-in lasts 24 hours and slides with use. A device remembers at most two live accounts
  for quick switching; a third sign-in is refused until one logs out or expires.
- Wrong attempts: the fifth blocks the device for 15 minutes; the twentieth blocks the
  device's IP address for the same time (a larger allowance for a shared school address).
- Logging out needs the server, revokes the sign-in and removes the offline verifier, but
  keeps cached data and queued changes. Locking is not logging out.
- After a PIN change, a device keeps its offline verifier only while the account and PIN
  version match; a newer version clears older verifiers everywhere on the device.

## Invitations and onboarding

An access manager (or root) creates an invitation: a one-use PIN valid for seven days. The
latest generated PIN is shown once; pending invitations can be revoked singly or in bulk.
Signing in with an invitation starts onboarding on that device, which must finish within 15
minutes on the same device: choose one or two PINs, a handle (1-20 letters, digits or
underscores) and a display name (1-30 characters). Enter advances. A device already bound to
another user cannot onboard. Escape on a required step returns to the lock screen without
completing it.

## Devices and admission

A device is identified by a stable ID the browser stores; clearing browser data makes a
new device that is subject to admission policy again. The ID is shown on the sign-in
screens so administrators can identify the device. Administrators may additionally require
the User-Agent and/or IP address to match; the stored values are hashes, a changed required
signal is refused, and devices enrol a newly selected signal at their next sign-in.

Admission outcomes, each shown to the user as a distinct state: whitelist required, bound
to another user, banned, throttled (with the time to retry), invalid client, system lock,
idle lock. Administrators are exempt from system and idle lock. While the idle lock
applies, a correct PIN recovers it but a cached sign-in stays locked.

Device administration (access manager): remark, bound user, whitelist, lock/unlock, delete
(which ends its sign-ins), promote a temporary device to persistent, and the identity-signal
policy. Switching the whitelist on adds the administrator's own device first; the
administrator's current device cannot be locked, deleted or removed from the whitelist from
itself.

## Bans and mutes

A ban is permanent or ends at a deadline and applies from the moment it is set, also after
a server restart; an unban clears it. A ban ends the user's sign-ins. A mute stops posting
and editing; a muted user may still delete their own posts.

## First start

The first start creates the root account and prints its PIN once on the server console; it
is not stored in the log.
