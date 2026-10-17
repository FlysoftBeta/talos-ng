# E2E hook contract

The end-to-end scenarios in `tools/e2e/scenarios/<feature>/` drive the production UI only
through the hooks below. A redesigned UI keeps every hook (same name, same meaning) or the
scenario is updated in the same change. Nothing else - class names, tag nesting,
`nth-child`, layout or position - may be relied on by a scenario.

Naming rule:

- `data-testid="<area>.<thing>[.<part>]"`, lower-case, dot-separated, hyphens inside a word.
- `<area>` is the product area or `ui` for shared primitives; the name says what the element
  *is*, never how it looks or where it sits.
- One element per hook in a view; repeated items (`chat.post`, `ui.row`, `media.track`) carry
  the same hook and are told apart by their text or a data attribute.

Scenarios also use ARIA roles and accessible names where they are product text that survives a
redesign (section 11); those are part of the contract as well.

## 1. App frame and gate screens (`app`, `auth`)

| hook | element | used by |
|---|---|---|
| `app.ready` | root of the signed-in application (gate passed, frame mounted) | identity, library, netbooks, media, chat, admin, ai, hardening, offline, package smoke |
| `auth.concealed` | the concealment screen shown before the PIN pad (reveal gesture target) | identity, library, netbooks, media, chat, admin, ai, hardening, offline, package smoke |
| `auth.login` | login screen (user not yet identified) | identity, offline |
| `auth.lock` | lock screen (identified user, locked) | identity, chat |
| `auth.numpad` | the numeric PIN pad; its buttons are named by their digit / 清除 / 退格 | identity, library, netbooks, media, chat, package smoke |
| `auth.device-locked` | screen shown when the device is locked/blocked by the server | identity, offline |
| `auth.onboarding` | first-sign-in onboarding (PIN replacement) screen | identity, offline |
| `auth.invitation.result` | result card after an invitation is created (invitation view) | offline |
| `auth.invitation.pin` | the one-time PIN text inside that card | - |

## 2. Shared primitives (`ui`)

| hook | element | used by |
|---|---|---|
| `ui.virtual-list` | scroll container of a virtualised list (chat history, data-grid body, gallery list) | chat, admin, hardening, offline, virtual |
| `ui.row` | one list row | chat, library, netbooks, media |
| `ui.row.action` | the row's primary action button | chat |
| `ui.row.title` | row title text | chat, library, netbooks, media |
| `ui.row.hint` | row secondary text (e.g. last-message preview) | chat |
| `ui.mark` | a pending / failed / confirmed operation mark | identity |
| `ui.keyvalue` | one label/value pair | library |
| `ui.keyvalue.label` | its label | library |
| `ui.keyvalue.value` | its value | library |
| `ui.status` | connection / pending-operations indicator; opens the activity centre | offline, package smoke |
| `ui.frame.back` | "back to list" control of the stacked (narrow) layout | offline |

## 3. Chat (`chat`)

| hook | element | used by |
|---|---|---|
| `chat.list` | conversation list pane | hardening |
| `chat.history` | scrolling history of the open conversation | hardening |
| `chat.loader` | history "loading" indicator (absent when loaded) | hardening |
| `chat.composer.input` | message text input | chat |
| `chat.post` | one post; `data-selected="true"` when selected, `data-seq` its sequence number | chat, hardening |
| `chat.post.text` | text body (preview) of a post | chat |
| `chat.post.sticker` | sticker body of a post | chat |
| `chat.post.full-text` | full text of a long post in the reader dialog | chat |
| `chat.sticker` | one sticker in the sticker picker | chat |
| `chat.banner` | in-app new-message banner | chat |
| `chat.banner.open` | banner main button (opens the conversation) | chat |
| `chat.banner.preview` | banner message preview text | chat |
| `chat.banner.dismiss` | banner close button | chat |

## 4. Library and reader (`library`, `reader`)

| hook | element | used by |
|---|---|---|
| `reader.scroll` | scroll viewport of the document reader | library, hardening |
| `reader.flow` | flowing text of a text/converted unit | hardening |
| `reader.position` | "/ N" unit-count label next to the page box | - |

Data attributes: `data-reader-unit="<n>"` on each mounted unit, `data-page-ready="true"` on a
rendered page iframe (iframe `title` is `文档第 N 页`).

## 5. Learning (`learning`)

| hook | element | used by |
|---|---|---|
| `learning.page` | content area of any learning screen | hardening |
| `learning.stats` | dashboard statistics block | learning |
| `learning.word` | the word being asked | learning |
| `learning.choice` | one answer choice (disabled once answered) | learning |

## 6. Media (`media`)

| hook | element | used by |
|---|---|---|
| `media.audio` | the single `<audio>` element (state read: `currentTime`, `paused`, `volume`) | media |
| `media.content` | main content of the music area | media, hardening |
| `media.content.title` | heading of the shown list/playlist | media |
| `media.track` | one track row; `data-device-cache` tells whether it is cached on the device | media |
| `media.mini` | mini player | media |
| `media.mini.play` | its play/pause button (title names the track) | media |
| `media.queue` | play-queue sheet content | media |

## 7. AI (`ai`)

| hook | element | used by |
|---|---|---|
| `ai.list` | conversation list pane | ai, hardening |
| `ai.conversation` | open conversation | ai |
| `ai.conversation.title` | its title heading | ai |
| `ai.message` | one message; `data-role="user"` or `"assistant"` | ai |
| `ai.message.rich` | rendered rich text of a message (math renders as KaTeX, code as `<code>`) | ai |
| `ai.composer` | composer area (text, image button, image chips) | ai |
| `ai.composer.input` | message text input | ai |
| `ai.workspace.editor` | workspace file editor | ai |
| `ai.billing` | quota and statistics screen (scroll container) | ai |
| `ai.billing.chart` | daily consumption chart | ai |

## 8. Admin (`admin`)

| hook | element | used by |
|---|---|---|
| `admin.users` | users pane | admin, hardening, identity |
| `admin.users.grid` | users data grid (role `table`; body rows are `[role=row][aria-rowindex]`) | admin, hardening |
| `admin.users.bulk.field` | one field row of the bulk-edit dialog (label + tri-state control) | admin |
| `admin.users.bulk.report` | bulk operation result report | admin |
| `admin.invitations` | invitations pane | admin, identity |
| `admin.invitations.result` | created-invitation card | - |
| `admin.invitations.pin` | the one-time PIN text | identity |
| `admin.devices` | devices pane | admin |
| `admin.groups` | groups pane | admin |
| `admin.announcements` | announcements pane | admin |
| `admin.system` | system pane | admin |
| `admin.incidents` | incidents pane | admin |
| `admin.audit` | audit pane | admin |
| `admin.debug` | debug pane | admin |

## 9. Ops (`ops`)

| hook | element | used by |
|---|---|---|
| `ops.panel` | content of an operations panel (update, backup, https, host, office); absent while the panel frame is not mounted | ops |

## 10. Development gallery (`dev`, static feature `offline`)

| hook | element | used by |
|---|---|---|
| `dev.gallery` | root of the design-system gallery page | offline |
| `dev.nav-demo.open` / `.back` / `.state` | navigation demo: open control, back control, JSON state readout | offline |

## 11. ARIA contract (roles and accessible names)

Scenarios locate these by role and name; the names are product text.

- Dialogs and sheets: `role=dialog`; the close control is a button named `关闭`; the last dialog
  in the DOM is the topmost.
- Buttons are found by accessible name (or visible text) - e.g. `发送`, `设置`, `创建邀请`,
  `确认`, `放弃`, `重试`, rail entries named by area (`对话`, `阅读`, `学习`, `音乐`, `AI`,
  `管理`, `任务`); the current area has `aria-current`.
- Choice groups: `role=group` with an `aria-label` (`主题`, `自律模式`, `数字键盘`) containing
  buttons with `aria-pressed`.
- Pickers: a `button[aria-haspopup=listbox]` named by its label, opening `role=listbox` with
  `role=option` items carrying `data-value`.
- Form fields: `<label>` text or `aria-label` (`消息`, `群组名称`, `群组密码`, `搜索`, ...);
  the chat text input is a textbox named `消息`.
- Data grids: `role=table` with `aria-label` and `aria-rowcount`; rows `role=row` with
  `aria-rowindex` (header row has none); row actions are buttons with `aria-label`
  (`编辑用户`, `禁言`, `永久清除用户`, `查看事件`, `编辑设备`); selection checkboxes
  `aria-label="选择第N行"`; the search box is `input[type=search]`.
- Status and alerts: `role=status` / `role=alert` / `role=timer` for transient feedback and
  countdowns.
- Landmarks used for readiness: `aria-label=管理栏目` (admin sections), `迷你播放器`.

Other data attributes read by scenarios: `data-theme` on the app root (`light` / `dark`),
`data-virtual-id` on virtual-scroller items (the source id; gallery ids are row numbers), `data-build` (test fixture only).

The `dev.virtual-bench` gallery uses `data-bench-item` for its stable item id and
`data-virtual-edge` for leading/trailing slots. The `virtual` scenario reads DOM coordinates
relative to the inner border edge. AI scenarios identify replies with `data-message-id`;
mounted `ai.message` counts do not represent transcript history length.
