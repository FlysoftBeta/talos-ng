# Learning

Needs the learning gate. The whole word list (English, phonetic, definition) is kept on the
device, so practice works fully offline; progress merges across devices.

## Dashboard

Shows today's practised words (by Asia/Shanghai day), mastered, wrong and remaining counts
with true totals, and entries to practice, the wrong-word list and the mastered list.

## Practice

- Multiple choice: the word with up to three distractors, shuffled, always containing the
  correct answer. Feedback is immediate, the next word follows after a short delay.
- Word choice favours wrong words (about 30% of the time when any exist), otherwise
  unlearned words.
- Scoring: a correct answer adds one learned point and removes one recorded error; the
  user can instead mark a word as mastered, which adds two. Two learned points make a word
  mastered. A wrong answer adds an error and demotes mastery without erasing the learned
  total.
- Speed mode: five seconds per word; running out records exactly one wrong answer. It
  pauses when the app is hidden and asks whether to resume.
- A live practice round guards all navigation: leaving asks for confirmation (neutral
  wording), locking is still immediate, and the interrupted summary appears after unlock.
  Closing the browser uses the browser's own confirmation.

## Word lists

- Wrong words: ten per page with wrong counts and definitions; empty state; entry to clear
  them.
- Clearing wrong words: a drill with a five-second limit per answer; a wrong answer waits
  two seconds; each correct answer lowers the count by one; completion is celebrated.
- Mastered words: ten per page with learned count. Page position clamps after removals.

## Discipline mode

An app-wide mode in which a forced quiz appears after every five minutes of active use
(visible, unlocked time), whichever area the user is in. The quiz cannot be closed except by
answering, and shortly after a durable answer it closes. A user may enable it for themselves;
a feature manager may impose it on another user. Selection weighs the user's mistakes, then
unlearned words, then a review of mastered words. If the word list is empty or practice is
unavailable the overlay offers a safe return, so discipline never traps the user.

## Word import

Feature managers can import words through the server (there is no workbench page for it):
records are written "english#definition" and separated by ￥; malformed records and
duplicate English spellings are skipped, and a new word list version is published only if
words were added.
