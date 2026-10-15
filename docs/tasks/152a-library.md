# 152a — Library, reader and network novels

Rules: `docs/tasks/152-ui-common.md`. Features: `library` (views + `library.css`),
`reader` (views, adapters only if a class name they query changes), `netbooks`
(`netbooks-dialog.tsx`, `netbooks.css`), and the sharing sheet if the library uses it
(`features/sharing/view.tsx` is shared with media: restyle it here once, generically).
e2e: `node tools/e2e/run.mjs library` and `node tools/e2e/run.mjs netbooks`.

## What the area essentially is

Collections of documents, and immersive reading. The list pane answers "where is my
document", the content pane lists a collection, and reading takes the whole window
(focus mode is already wired: an open document hides the list pane and `PaneHeader` shows
the back control automatically).

## List pane (collection width)

- `PaneHeader` title 阅读; actions: one `Menu` labelled 添加 (icon `plus`) with 导入文档,
  网络书籍 (the netbooks entry is injected through `toolbarExtra`; render it as a menu item or
  keep its own trigger as an `IconButton` next to the menu — choose what keeps it clean),
  新建书单.
- `PaneTools`: `Segmented` (block) 最近 · 收藏 · 书单.
- 最近 / 收藏: rows are documents (`ListRow`, leading `Icon` `document` in a 36 px tile or a
  progress ring if trivial, title, hint `作者 · 进度`), tapping opens the reader.
- 书单: a compact group filter picker (`SelectField` with `hideLabel`) above rows of
  booklists (leading `book` tile, title, hint `n 份文档`), tapping shows the booklist in the
  content pane. Each view keeps its own empty state (`StatePanel` compact).

## Content pane

- Nothing selected: `EmptyPane` icon `library`, hint 选择一个书单或文档.
- Booklist: `PaneHeader` title = name, subtitle `n 份文档`; actions `IconButton` 分享
  (`share`), `IconButton` 添加文档 (`plus`) if writable, `Menu` ⋯ with 删除书单 (danger,
  `ConfirmDialog` naming it; documents are not deleted). Body: document rows with hint
  `作者 · 大小 · 进度%`, trailing `Menu` ⋯ (上移, 下移, 移出). No visible per-row button strips.
- Retention and download state are inline `Tag`/`Mark`s on rows (已保留, 待下载, 下载中 n%).

## Reader (focus mode)

- `PaneHeader`: back, title (document title), subtitle (author · pages or characters);
  actions: `IconButton` 收藏 (`bookmark`, `pressed`), `IconButton` 离线保留 (opens the
  retention choice; keep the scenario's 离线保留 / 保存策略 flow working), `Menu` ⋯ with
  详情 (document metadata sheet using `Group`/`KeyValue`) and 删除 (danger, confirm).
- PDF: pages centred on a `--raised` canvas with a 1 px border and a soft shadow, 16 px apart;
  a compact floating control cluster at the bottom centre: zoom out / zoom in / page box
  `[ n ] / N` (keep `reader.position` and the page-jump behaviour). Text: a centred reading
  column (max ~720 px), 17 px type, `--lh-read`, generous paragraph spacing.
- Missing units offline: a calm placeholder band `未下载` the width of the page.
- Completion footer: a quiet centred block (check icon, 已读完, reading time).
- Keep `reader.scroll`, `reader.flow`, `data-reader-unit`, iframe titles and
  `data-page-ready` exactly.

## Dialogs

- 导入文档: `Dialog` md; `Segmented` 文本 · PDF; target booklist `SelectField`; title
  `Field`; body `TextArea` or `FileField`; footer 取消 / 开始导入 (primary). Explain that
  progress appears in 任务 with one muted line, not a paragraph.
- 网络书籍: `Dialog` lg; `SearchField` + 搜索 button in one row with the cooldown as a small
  `role=timer` text; results as rows (title, author, abstract clamped to two lines) with a
  trailing 下载 button that names the book (`下载 星河漫游` must remain the accessible name);
  destination booklist picker above the results; offline → `StatePanel` offline.
- Sharing sheet: `Sheet`; current grants as rows (avatar, name, role `Tag`, trailing ⋯ menu
  to change or revoke); an add section with candidate picker, role `Segmented` (读 · 写 ·
  管理), 可转授 `Checkbox`, primary 添加.
