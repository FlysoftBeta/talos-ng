# Library, reader and network novels

Needs the articles gate (reader types and downloads add their own gates; see roles.md).

## Library

The reading area has three views: recent, favourites, and booklists (optionally filtered to
one group's booklists). Each has its own empty state. A booklist is a shared collection:
it lists documents, can be created by any user with the gate, and is shared by access grants
(roles.md). Writers add and remove documents; the owner deletes the booklist after a
confirmation naming it (documents are not deleted with it). Item removals reconcile after
a disconnection.

Sharing sheet (booklists and playlists): grant read, write or own to users or groups
(candidates are the user's groups and DM peers), optionally delegable; the owner can revoke
all grants but their own. A favourite or bookmark never grants access.

Documents the user may open are recoverable through any collection that still lists them;
there is no token or link that grants access to whoever holds it.

## Importing

- Text: pasted title and body, or a text file (UTF-8 or GB18030, decoded automatically); an
  attachment locks the body and supplies the default title.
- PDF: needs the e-book gate; recognised by type or extension; up to 200 MiB. Password
  protected PDFs are rejected with 文档已加密，暂不支持; unreadable files with 文档无效.
- Importing needs write access to the target booklist and a connection. The dialog closes
  at once; upload progress shows in the status centre and conversion runs as a background
  task shown in the task list, restartable after a server restart. A failed conversion keeps
  its source and can be retried from the task list.
- Every document ends as one rendition that is the same for all formats, so retention and
  offline reading work identically for text and PDF.

## Reader

- Document header: author, date, size (characters or pages) and progress. Controls: bookmark
  (favourite), offline retention, delete.
- Layout: a vertically scrolling list of units (pages of a PDF, segments of text). PDF pages
  fit the width by default, with pinch or step zoom, a page indicator and jump to a page.
  Plain text renders as plain typography and restores the same position at any width. PDF
  text is selectable.
- The end of a document shows a completion footer. In offline mode a unit that is not on
  the device shows 未下载 (for PDFs, above/below page gaps), and reconnecting loads them.
- PDF pages render in isolated frames that cannot reach the network or the app.
- Touch drag, wheel, arrow keys, PgUp/PgDn and Space scroll the document, including over a
  PDF page.
- Progress: the resume position (the exact place), the furthest position (by unit) and
  reading time. Time counts only while the page is visible and the app is unlocked.
  All three work offline and merge across devices (offline.md).
- Deleting a document: its author, or a community manager with access, after confirmation.

## Retention

Per document: auto, or keep 1, 7 or 180 days for offline use. Explicit policies download the
whole rendition in the background (resumable); only a complete, hash-verified document is
readable offline. Auto does not promise offline availability. Expired or revoked retention
is released and its files collected.

## Network novels

A dialog on the import action (needs the article-download gate and a writable booklist,
chosen before download).

- Search by book or author: at most one search every five seconds (the dialog shows a
  countdown based on the server's time), 20 results with abstracts. Failures from the
  upstream source (verification demanded, no connection) are shown as such.
- Download: chapters are fetched one by one from the official source, paced, and checkpointed
  so an interrupted download resumes after a restart. Chapters that are preview-only or
  need verification fail the download instead of producing an incomplete book. The same
  user, book and booklist share one running download. The result is a text document in the
  booklist. Progress is in the task list; closing the dialog does not cancel anything.
- Search and download need a connection.
