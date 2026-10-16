# Library, reader and network novels

Needs the articles gate (reader types and downloads add their own gates; see roles.md).

## Library

The reading area has recent and booklist views (booklists can be filtered by group).
Every user has two private built-in booklists: 我的书架 and 我的收藏. Both are pinned at the
top of recent view, including when empty. Built-ins cannot be deleted, renamed, have their
information edited, or be shared. Their contents can be reordered or removed.

Every book belongs to at least one booklist. Removing a book from its last booklist, or
deleting its last booklist, permanently deletes the book, reading state, download checkpoints,
conversion tasks and unreferenced source/rendition objects. Books in another booklist survive.
The deletion confirmation explains this consequence. Removing a favourite removes its
membership in 我的收藏; the reader's favourite control and this booklist are the same feature.

New books enter from a source: the import entry, a network download, or a booklist which
permits transfer. A destination booklist has no “add document” control. At an authorized
source, choose a book's “转存到书单” action and a writable destination. Transfer adds a
membership without removing the source membership. Read access alone does not permit transfer
or favourites; an explicit delegable grant permits both. An authorized transfer preserves
access through the new booklist even if the original grant is later revoked.

Sharing sheet (ordinary booklists and playlists): grant read, write or own to users or groups
(candidates are the user's groups and DM peers), optionally delegable; the owner can revoke
all grants but their own. Booklist writers reorder and remove items, and can receive imports.
Owners can delete ordinary booklists after confirmation. Built-ins stay private even from
community managers and cannot receive grants through the library API.

Documents are accessible through their owner or a booklist which still lists them;
there is no token or link that grants access to whoever holds it.

## Importing

- Text: pasted title and body, or a text file (UTF-8 or GB18030, decoded automatically); an
  attachment locks the body and supplies the default title.
- PDF: needs the e-book gate; recognised by type or extension; up to 200 MiB. Password
  protected PDFs are rejected with 文档已加密，暂不支持; unreadable files with 文档无效.
- Importing needs write access to the target booklist and a connection. Without an explicit
  target it goes into 我的书架. The book and its first membership are committed together. The dialog closes
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

Each user can set offline retention independently for a document or an accessible booklist:
auto, or 1–365 days. Read access is sufficient to set one's own policy. Sharing or changing
a booklist never changes another user's retention settings; auto does not request a
background download or promise offline availability.

An explicit policy downloads whole renditions in the background (resumable). The retention
deadline uses that user's policy timestamp or latest use, whichever is later. A document
covered by several of the user's policies remains retained until the latest applicable
deadline. Clearing one policy does not cancel another applicable policy. Removed membership,
expired policies and lost access release ownership. Only complete, hash-verified documents
are readable offline.

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
