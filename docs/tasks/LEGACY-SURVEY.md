# Legacy survey — ClassApp / Talos II

Survey date: 2026-10-13. Source root: `/home/flysoft/projects/classapp-next`; observed HEAD `7c6e7ee` (2026-08-20).
This is a static implementation inventory for a rewrite, not a claim that every path currently works in production.
All paths below are relative to that source root; `path:line` points to the relevant declaration or implementation.
No legacy build, installation, test suite, or application was run. One permitted native renderer `--help` probe is identified below.
Excluded completely: `rewrite/`, `node_modules/`, `build/`, `backups/`, `worktree/`, `.cache/`, `docs/draft_dont_read_this/`.
References to excluded runtime paths describe source-code configuration only; their contents were not inspected.
Secrets are identified by location/purpose only. Documentation is evidence of intent; implementation discrepancies are explicit.

## 1. Product in one page

| Dimension | Actual product / deployment premise | Evidence |
|---|---|---|
| Product | School-community communication, reading, vocabulary practice, music, AI, and operational administration. Browser title is `Talos II`; project/package name is ClassApp. | `client/components/App.tsx:145`, `shell.html:13`, `package.json:2` |
| Architecture | React SPA with custom Node.js HTTP/WebSocket runtime and SQLite; the directory name does not imply Next.js. | `client/main.tsx:17`, `server/main.ts:16`, `server/infra/db.ts:13` |
| Intended environment | Small concealed school intranet, intermittent connectivity, managed/shared tablets and embedded Chrome 70–80 WebViews. This is documented product intent, corroborated by Chrome 70 build/test infrastructure. | `docs/product-context.md:5`, `vite.config.ts:70`, `scripts/tests/legacy-chrome.mts:1` |
| Deployment | One installed server, multiple LAN HTTP ports and HTTPS listener, external Node runtime, Windows or Linux; launcher manages processes/updates, not a kiosk browser. | `launcher/launcher.ts:29`, `launcher/launcher.ts:118`, `launcher/start.bat:1`, `launcher/start.sh:1` |
| Primary user | PIN-authenticated member who chats, joins groups, reads imported books/PDFs, practices words, listens to music, and uses AI when entitled. No teacher/student role distinction in the role enum. | `shared/authority.ts:3`, `shared/features.ts:3`, `client/interact/types.ts:28` |
| Shared device | Device admission, identity, lock, whitelist, bound-user restrictions, and multiple user sessions are explicit features. | `server/services/authService.ts:146`, `server/data/clients.ts:332` |
| Administrators | Base administrator plus responsibility roles: root, operations, feature manager, operations assistant, access manager, community manager, advanced community manager. | `shared/authority.ts:3` |
| Language | Simplified Chinese literals throughout; examples: “离线功能”, “电子书阅读器”, “AI 对话”, “图片上传”, “暂无任务”, “以上页面未下载”. | `shared/features.ts:17`, `client/components/tasks/TaskManagerPopover.tsx:99`, `client/components/articles/BundleArticleReader.tsx:329` |
| Offline promise | Previously installed shell/app, cached identities, downloaded content and selected pending user decisions survive outages; browser is a partial projection, not a full server replica. | `shell.html:198`, `client/interact/sync.ts:183`, `client/data/model.ts:14` |
| Compatibility priorities | Old-browser correctness, bounded memory/storage, reconnect repair, self-hosted rollback; giant monolithic client bundle is an intentional tradeoff. | `docs/product-context.md:17`, `vite.config.ts:64`, `scripts/builds/build-wasm.mjs:6` |
| Documents | Server-render PDF into immutable HTML/SVG/WebP bundles; text books use segmented text. Browser does not execute a PDF engine. | `server/infra/pdfRenderProcess.ts:43`, `lib/poppler/utils/pdfrender.cc:818`, `client/components/articles/ArticleReader.tsx:264` |

Main journeys, including their operational purpose:

1. Unlock the concealed interface using directional sequence, enter a six-digit PIN, or redeem invitation and choose credentials/profile; device policy may block admission. (`client/components/auth/LockScreen.tsx:8`, `client/components/auth/LoginScreen.tsx:19`, `client/components/auth/OnboardingFlow.tsx:35`)
2. Select a group/DM, resume unread history, send text/sticker/image, reply, edit/delete, mute or retain history; disconnected composition preserves a draft but cannot publish. (`client/components/chat/MessageComposeBar.tsx:97`, `client/hooks/useChatPosts.ts:296`)
3. Discover a child group through an accessible parent, supply its password if required, control member visibility, and start an authorized DM. (`client/components/sidebar/FindGroupDialog.tsx:44`, `client/components/chat/MembersDialog.tsx:47`)
4. Import text/PDF into a group's booklist or search network novels, read progressively, bookmark, save progress, and retain content for offline use. (`client/components/articles/ArticleImportFab.tsx:70`, `client/components/articles/NetworkArticleDialog.tsx:47`, `client/components/articles/ArticleReader.tsx:155`)
5. Practice multiple-choice vocabulary, review mistakes, explicitly mark mastery, or answer discipline prompts. (`client/components/learning/Learning.tsx:64`, `client/components/learning/WordLearningPage.tsx:86`)
6. Search music, enqueue/play it, favorite tracks, maintain/share playlists, and use cached audio when remote playback fails. (`client/components/media/MediaView.tsx:37`, `client/hooks/useMediaPlayer.ts:135`)
7. Ask AI with text/images, follow streaming replies, fork history, stop generation, and consume a plan/top-up credit balance; agent files remain server-owned. (`client/components/ai/AiView.tsx:135`, `server/services/ai/aiService.ts:381`)
8. Administer users/devices/groups/entitlements, diagnose incidents, capture opened Office files, manage HTTPS/backups, and stage/confirm/rollback releases. (`client/components/admin/AdminPanel.tsx:40`, `client/components/admin/ToolsTab.tsx:26`, `client/components/admin/MaintainTab.tsx:77`)

Role shorthand used below: U=authenticated user, A=base administrator, R=root, O=operations, F=feature_manager, OA=operations_assistant, AM=access_manager, CM=community_manager, ACM=advanced_community_manager.
`U+feature` means the corresponding enabled feature plus normal ban/access checks; client visibility is not sufficient authorization. (`shared/authority.ts:17`, `server/services/authorityService.ts:21`)

## 2. Feature inventory

Each F-number is a rewrite checklist item. Related implementation limits and exact wire fields are expanded in §§4–8.

| ID | Feature / behavior | Roles | UI location | Key behavior / edge cases | Legacy evidence |
|---|---|---|---|---|---|
| F-001 | Concealed unlock | Visitor/U | Blank lock screen | U,U,D,D,L,R,L,R; wrong/center input resets. | `client/components/auth/LockScreen.tsx:8` |
| F-002 | Touch unlock | Visitor/U | Screen edges | Top/bottom thirds and middle left/right thirds; suppress synthetic mouse for 700ms. | `client/components/auth/LockScreen.tsx:30` |
| F-003 | Keyboard unlock | Visitor/U | Lock screen | Arrow keys or WASD feed same sequence. | `client/components/auth/LockScreen.tsx:76` |
| F-004 | PIN login | Visitor | Login | Six digits, automatic submission on sixth; dots and loading/error presentation. | `client/components/auth/LoginScreen.tsx:19` |
| F-005 | Numeric keypad | Visitor/U | Credential dialogs | Touch digits plus keyboard digits/Backspace/Delete; live status accessibility. | `client/components/shared/NumPad.tsx:13` |
| F-006 | Invitation onboarding | Invitee | Onboarding | Choose one or two PINs, handle 1–20 alphanumeric/underscore, display name ≤30; Enter advances. | `client/components/auth/OnboardingFlow.tsx:35` |
| F-007 | Cached session restoration | U | Startup | Cached user/token/gates warm-start; initial connection fallback after 5s; late successful auto-login still applies. | `client/interact/sessionController.ts:35` |
| F-008 | Device/session admission errors | Visitor/U | Login/locked screen | Whitelist, binding, ban, throttle, invalid client, system/idle lock are distinct states. | `server/services/authService.ts:146`, `client/components/auth/AppLockedScreen.tsx:25` |
| F-009 | Device diagnostic ID | Visitor/U | Auth wrapper | Client ID badge supports admin identification. | `client/components/auth/ClientIdBadge.tsx:1`, `client/components/auth/AuthScreen.tsx:1` |
| F-010 | Manual lock/logout | U | Locked gear/settings; browser Back | Lock preserves identity; logout is separate, server-backed action. | `client/components/auth/AppLockedScreen.tsx:25`, `client/components/settings/Settings.tsx:432` |
| F-011 | Browser Back concealment | U | Whole app | Inserts ten same-URL history entries; popstate re-pushes and locks app. | `client/hooks/useAppLogic.ts:68` |
| F-012 | Responsive navigation | U | Sidebar/content | 260px desktop sidebar; mobile list/content replacement; desktop collapse transition 300ms. | `client/components/App.tsx:259` |
| F-013 | Four primary modes | U+feature | Sidebar | 对话 / AI / 阅读 / 音乐; feature flags hide unavailable areas. | `client/components/sidebar/SidebarNavigation.tsx:31`, `client/components/App.tsx:145` |
| F-014 | Offline indicator / denial | U | App overlay | Orange “离线”; disconnected user without offline entitlement gets blank white screen. | `client/components/App.tsx:397`, `client/components/App.tsx:766` |
| F-015 | Conversation ordering | U | Sidebar | Pinned first, then latest activity descending, then name; unread badges. | `client/interact/appStore.ts:63`, `client/components/sidebar/ConversationSection.tsx:19` |
| F-016 | Empty chat welcome | U | ChatView | No selected group/DM gives welcome instead of message list. | `client/components/chat/ChatView.tsx:59` |
| F-017 | Unread-first opening | U | Chat history | Opens around first unread, otherwise latest; fetches an additional newest slice. | `client/hooks/useChatPosts.ts:296` |
| F-018 | Bidirectional virtual history | U | Message list | 40-row requests, variable height, boundary retries and offline-gap explanations. | `client/hooks/useChatPosts.ts:70`, `client/components/shared/InfiniView.tsx:40` |
| F-019 | Read cursor / live scroll | U | Chat | Fully visible messages mark read; live auto-scroll only at bottom, 80ms scroll throttle. | `client/hooks/useChatPosts.ts:611` |
| F-020 | Text composition | U permitted to post | Composer | Trimmed send, Enter sends/Shift+Enter newline, fullscreen editor changes Enter behavior. | `client/components/chat/MessageComposeBar.tsx:147` |
| F-021 | Persistent drafts | U | Composer | Debounce 400ms and save previous conversation on switch; offline draft allowed. | `client/components/chat/MessageComposeBar.tsx:97` |
| F-022 | Reply/cancel/jump | U | Cards/composer | Preview truncated to 80 characters; click jumps; attachment/sticker sends retain reply reference. | `client/components/chat/ChatPostCard.tsx:397`, `client/components/chat/MessageComposeBar.tsx:147` |
| F-023 | Fullscreen editing | U | Compose dialog | Up to 5,000,000-character text; failed sends retain draft/error. | `client/components/chat/MessageComposeBar.tsx:420`, `shared/validation/posts.ts:6` |
| F-024 | Edit own text | Author | Card menu | Fetch full truncated body before edit; edited marker; non-text posts not text-editable. | `client/components/chat/ChatPostCard.tsx:325` |
| F-025 | Delete/tombstone post | Author/CM | Card menu | Preserve sequence/reply identity; show deleted timestamp rather than removing history slot. | `client/components/chat/ChatPostCard.tsx:325`, `server/infra/db.ts:1183` |
| F-026 | Long-text viewer | U | Card expansion dialog | UI threshold 500, server preview 1000; cannot fetch missing full text offline. | `shared/validation/posts.ts:6`, `client/components/chat/ChatPostCard.tsx:50` |
| F-027 | Author/date display | U | Cards | “无主内容” for missing author; zh-CN dates in Asia/Shanghai. | `client/components/chat/ChatPostCard.tsx:42` |
| F-028 | Stickers | U | StickerPicker | Pack tabs and recent list; four-column 72px virtual grid. | `client/components/chat/StickerPicker.tsx:31`, `client/components/chat/StickerPicker.tsx:386` |
| F-029 | Image posts | U+post_images | Composer | Multipart upload, max 12MiB; durable original with reconstructible WebP thumbnail. | `server/http/routes/postImageUpload.ts:7`, `server/services/postImagesService.ts:33` |
| F-030 | Original image viewer | U with chat access | Image dialog | Separate thumbnail/original cache; missing-online versus unavailable-offline errors. | `client/components/chat/ChatPostCard.tsx:152` |
| F-031 | Mute/posting restrictions | U | Composer | Muted-user expiry timer; admin-only group suppresses ordinary composer. | `client/components/chat/MessageComposeBar.tsx:270` |
| F-032 | Pin conversation | U | Conversation menu | UI requires online even though state uses versioned assignment mechanism. | `client/components/chat/ConversationSettingsMenu.tsx:118` |
| F-033 | Mute notifications | U | Conversation menu | Offline-writable per-conversation setting. | `client/components/chat/ConversationSettingsMenu.tsx:124` |
| F-034 | Retain conversation | U+offline | Conversation menu | Auto/week/half-year; disconnected request explains deferred download. | `client/components/chat/ConversationSettingsMenu.tsx:169` |
| F-035 | Create group | U permitted by server | Sidebar dialog | Name, optional handle/password, discoverability and joined-parent selection. | `client/components/sidebar/CreateGroupDialog.tsx:35` |
| F-036 | Find groups | U | Sidebar search dialog | Button/Enter search name/handle; sections by accessible parent; explicit no-parent/no-match states. | `client/components/sidebar/FindGroupDialog.tsx:44` |
| F-037 | Discover subgroups | U | Current-group dialog | Lists selected parent’s children (no search field) and password-protected join. | `client/components/chat/DiscoverGroupsDialog.tsx:27` |
| F-038 | Join with provenance | U | Search result | Supplies search/group source; server validates discoverability and parent access. | `client/components/sidebar/FindGroupDialog.tsx:79`, `shared/protocol/actions.ts:859` |
| F-039 | Members / hide self | Member | MembersDialog | Snapshot list, hidden-members explanation, own hide-self toggle. | `client/components/chat/MembersDialog.tsx:47` |
| F-040 | Start DM | U | Member row | Non-self target; shared-group proof controls creation. | `client/components/chat/MembersDialog.tsx:101`, `server/services/conversationsService.ts:1` |
| F-041 | Leave group | Member | MembersDialog | Absent when no_leave; failures shown; membership removal changes access. | `client/components/chat/MembersDialog.tsx:76` |
| F-042 | New-message banners | U | In-app overlay | Other-user message outside active chat; skips mute/DND; 60-char preview; 4.5s expiry. | `client/hooks/useMessageBanner.ts:79` |
| F-043 | Banner interaction | U | Banner | Click navigates; upward swipe ≥48px dismisses; bounded dedup set. | `client/components/notifications/MessageBanner.tsx:20`, `client/hooks/useMessageBanner.ts:29` |
| F-044 | Announcements | U | Blocking modal | Revision acknowledgment; newer announcement replaces stale acknowledgment; no Escape/backdrop close. | `client/components/App.tsx:309`, `client/components/App.tsx:740` |
| F-045 | Profile editing | U | Settings | Handle/display name independent edits; disabled offline. | `client/components/settings/Settings.tsx:89` |
| F-046 | PIN replacement | U | Settings credential flow | Current PIN then one/two replacement PINs; server rejects collisions. | `client/components/settings/Settings.tsx:129`, `server/services/authService.ts:86` |
| F-047 | Light/dark theme | U | Settings | Per-user persisted setting, works offline. | `client/components/settings/Settings.tsx:280`, `shared/userConfig/keys.ts:1` |
| F-048 | Do not disturb | U | Settings | Data supports offline proposals, but switch is disabled offline. | `client/components/settings/Settings.tsx:296`, `shared/userConfig/keys.ts:1` |
| F-049 | About diagnostics | U | Native alert from Settings | Build, browser, IP and client ID. | `client/components/settings/Settings.tsx:40` |
| F-050 | Reset local data | U | Settings confirmation | Rebuild app stores/reload; preserves installed shell/bundle and SW shell cache. | `client/components/settings/Settings.tsx:89`, `client/interact/resetClientData.ts:5` |
| F-051 | Article library | U+articles | Reading mode | Recent/favorites/accessible booklists; selected-group list; area-specific empties. | `client/components/articles/ArticleList.tsx:142` |
| F-052 | Create booklist | U+articles | Library dialog | Title; new access-controlled collection. | `client/components/articles/ArticleList.tsx:211`, `shared/protocol/actions.ts:657` |
| F-053 | Booklist browsing/removal | Authorized reader/writer | BooklistPage | List articles, remove if write; no visible add/reorder UI here. | `client/components/articles/BooklistPage.tsx:26`, `client/components/articles/BooklistPage.tsx:183` |
| F-054 | Booklist deletion | Owner | Booklist header | Immediate button action; unlike article/playlist deletion, no confirmation. | `client/components/articles/BooklistPage.tsx:126` |
| F-055 | Collection sharing | Issuable grant holder | ShareAccessDialog | User/group read/write/own and delegation; candidates existing groups/DM peers; owner revokes except self. | `client/components/library/ShareAccessDialog.tsx:28` |
| F-056 | Text article import | U+articles with group write | Import FAB | Title/body or text attachment; attachment locks body, defaults filename title; decode UTF-8/GBK. | `client/components/articles/ArticleImportFab.tsx:70`, `client/lib/textEncoding.ts:1` |
| F-057 | PDF import | U+ebook_reader with group write | Import FAB | MIME/extension detection; close dialog immediately, async task progress/errors; server max 200MiB. | `client/components/articles/ArticleImportFab.tsx:101`, `server/services/articlesService.ts:73` |
| F-058 | Network book search | U+article_download | NetworkArticleDialog | Book/author query, abstracts truncated 80 chars, busy countdown tick 250ms. | `client/components/articles/NetworkArticleDialog.tsx:47` |
| F-059 | Network book download | U+article_download | Search result/task list | Deduplicate active same user/book/group; sequential chapters, eventual text article. | `server/runtime/articleImportRuntime.ts:85` |
| F-060 | Reader metadata | U with article access | ArticleReader header | Author/date/word or page count/progress; online revalidation keeps reader mounted. | `client/components/articles/ArticleReader.tsx:81` |
| F-061 | Bookmark article | U | Reader toolbar | UI online-only; versioned favorite record, no ownership conveyed. | `client/components/articles/ArticleReader.tsx:155`, `server/infra/db.ts:548` |
| F-062 | Reading position/time | U | Reader | Resume and furthest offsets; 15s online time heartbeat; background visibility not checked. | `client/hooks/useArticleReading.ts:6`, `shared/types/api/article.ts:66` |
| F-063 | Article retention | U+offline | Reader menu | Auto or 1/7/180 days; complete text/bundle downloads; explicit missing-body state. | `client/components/articles/ArticleReader.tsx:377` |
| F-064 | Delete article | Author/CM with access | Reader confirmation | UI offers author/any admin; server capability/authority remains decisive. | `client/components/articles/ArticleReader.tsx:264`, `server/domain/facade/articles.ts:1` |
| F-065 | Long-text virtual reading | U+article_reader | TextArticleReader | Progressive segmented text, position restore, offline boundaries; details §7. | `client/components/articles/TextArticleReader.tsx:20` |
| F-066 | PDF/bundle reading | U+ebook_reader | BundleArticleReader | Fit-width vertically scrolling pages, selectable text, iframe sandbox; no ink/zoom toolbar. | `client/components/articles/BundleArticleReader.tsx:24` |
| F-067 | PDF keyboard/touch | U | Embedded page | Wheel, one-finger drag, arrows, PgUp/PgDn/Space forwarded to outer scroller. | `client/lib/bundleFrame.ts:6` |
| F-068 | Download/task manager | U+relevant feature | Sidebar popover | Queued/running/completed/failed, progress/ETA/errors; server tasks poll 2s while open. | `client/components/tasks/TaskManagerPopover.tsx:28` |
| F-069 | Clear task history | U | Task popover | Clear completed also clears failures; retain newest 100. | `client/hooks/useTaskStore.ts:32` |
| F-070 | Learning dashboard | U+learning | Learning | Today/mastered/wrong/remaining counts; fallback total 3500. | `client/components/learning/Learning.tsx:64` |
| F-071 | Multiple-choice practice | U+learning | WordLearningPage | Three distractors when available, shuffled choices, correct/error feedback and delayed next. | `server/services/wordsService.ts:36`, `client/components/learning/WordLearningPage.tsx:86` |
| F-072 | Speed practice | U+learning | Quiz toggle | 5s timeout marks wrong; hidden tab disables speed and prompts exit. | `client/components/learning/WordLearningPage.tsx:130` |
| F-073 | Explicit mastery | U+learning | Quiz | Adds two learned counts; ordinary correct adds one; mastery threshold two. | `server/data/words.ts:165` |
| F-074 | Wrong-word list | U+learning | WrongWordsPage | Ten/page, wrong counts, definitions, empty state, clear-wrong entry. | `client/components/learning/WrongWordsPage.tsx:27` |
| F-075 | Clear wrong words | U+learning | ClearWrongWordsPage | 5s answer timeout, wrong waits 2s; correct reduces count by one; completion celebration. | `client/components/learning/ClearWrongWordsPage.tsx:85`, `server/data/words.ts:187` |
| F-076 | Mastered-word list | U+learning | MasteredWordsPage | Ten/page with learned count and empty state. | `client/components/learning/MasteredWordsPage.tsx:23` |
| F-077 | Learning exit protection | U+learning | Exit/beforeunload dialogs | Session summary; some direct navigation bypasses App-level confirmation. | `client/components/learning/WordLearningPage.tsx:186`, `client/components/App.tsx:170` |
| F-078 | Discipline mode | U/F | Learning/settings admin | Forced quiz every 5min while dashboard mounted, not application-wide; duplicate initial timers. | `client/components/learning/Learning.tsx:83`, `client/components/learning/Learning.tsx:106` |
| F-079 | Discipline answer overlay | U+learning | SelfDisciplineModal | No close except answer; closes 500ms after practice; no-word state lacks exit. | `client/components/learning/SelfDisciplineModal.tsx:70` |
| F-080 | Word import API | Authorized admin | No dedicated current import page found | `english#definition` records separated by `￥`; skip malformed/existing English, UUID IDs. | `server/services/wordsService.ts:79`, `shared/protocol/actions.ts:1023` |
| F-081 | Music search | U+media | MediaSearchPopover | Enter/button, bounded results, covers/artist/album/status, busy/errors. | `client/components/media/MediaSearchPopover.tsx:15` |
| F-082 | Music library | U+media | MediaView | First 12 recents, favorites, granted playlists; “已缓存” reflects server asset state. | `client/components/media/MediaView.tsx:37`, `client/components/media/TrackRow.tsx:25` |
| F-083 | Favorite tracks | U+media | TrackRow | Versioned favorite separate from access/ownership. | `shared/protocol/actions.ts:1266`, `client/components/media/TrackRow.tsx:56` |
| F-084 | Queue editing | U+media | QueueDrawer | Refresh on open, enqueue/remove/clear, empty state; right drawer 320/360px. | `client/components/media/QueueDrawer.tsx:18` |
| F-085 | Playback controls | U+media | Persistent NowPlayingBar | Play/pause, previous/next, seek, volume, queue, stop; compact outside music. | `client/components/media/NowPlayingBar.tsx:31` |
| F-086 | Volume cap | U/CM | Player/global admin | Actual gain is minimum of user setting and server cap. | `client/hooks/useMediaPlayer.ts:48`, `client/components/admin/GlobalTab.tsx:112` |
| F-087 | Offline audio fallback | U+media/offline | Player | Try live grant, on any failure try cached audio; length validates cache, materialization verifies hash. | `client/hooks/useMediaPlayer.ts:135` |
| F-088 | Queue end behavior | U+media | Player | Ended sets playing=false; does not automatically advance; prev/next use adjacent queue positions. | `client/hooks/useMediaPlayer.ts:278` |
| F-089 | Create/delete playlist | U/owner | PlaylistDialogs | Title dialog; delete confirmation explicitly retains tracks. | `client/components/media/PlaylistDialogs.tsx:20` |
| F-090 | Playlist membership | Authorized writer | Track menu/playlist page | Add/remove tracks; page has loading/unavailable/empty states. | `client/components/media/AddToPlaylistButton.tsx:1`, `client/components/media/MediaPlaylistPage.tsx:42` |
| F-091 | Playlist retention | Authorized writer | Retention dialog | 1–365 days from last play; controls retention/expiry. | `client/components/media/PlaylistDialogs.tsx:75` |
| F-092 | Playlist sharing | Issuable grant holder | Playlist share dialog | Same principal/grant UI as booklists. | `client/components/media/MediaPlaylistPage.tsx:140`, `client/components/library/ShareAccessDialog.tsx:28` |
| F-093 | AI sidebar/search | U+ai | AiSection | Title/tag search debounce 350ms, unread/running indicators, day/week credit percentages. | `client/components/sidebar/AiSection.tsx:43` |
| F-094 | AI text conversation | U+ai | AiView | New/existing, Enter send, Shift+Enter newline, stream updates and smooth scrolling. | `client/components/ai/AiView.tsx:135` |
| F-095 | AI images | U+ai | Composer chips | Up to four PNG/JPEG/WebP/GIF, ≤5MiB each; images alone cannot send. | `client/components/ai/AiView.tsx:465` |
| F-096 | AI failure/availability | U+ai | AiView | Offline/unconfigured/running disable send; busy and insufficient credit explicit. | `client/components/ai/AiView.tsx:268` |
| F-097 | Stop AI run | U+ai | Active run control | Durable cancellation plus live abort signal. | `client/components/ai/AiView.tsx:279`, `server/runtime/aiExecutionRuntime.ts:1` |
| F-098 | Fork AI conversation | U+ai | Message menu | Select nonstreaming message; branch id submitted with next message; router may choose new conversation. | `client/components/ai/AiView.tsx:391`, `server/services/ai/aiService.ts:427` |
| F-099 | AI rich rendering | U+ai | Assistant message | Streamdown CJK/math/Mermaid/linkSafety; inline dollar math supported. | `client/components/ai/markdown.ts:1`, `client/components/ai/AiView.tsx:329` |
| F-100 | Agent workspace | U+ai indirectly | AI file tools | TXT/MD/safe SVG, image inputs, per-user 10MiB/256-file tree; not arbitrary host file access. | `server/services/ai/aiWorkspace.ts:22`, `server/services/ai/fileTools.ts:19` |
| F-101 | AI drafts | U+ai | AiView | React state only, unlike durable chat draft. | `client/components/ai/AiView.tsx:103` |
| F-102 | Admin entry/role overview | A | AdminOverview | Base entry permission alone does not grant privileged operations. | `client/components/admin/AdminOverview.tsx:9`, `shared/authority.ts:28` |
| F-103 | Admin grid | Specialist roles | Users/groups/clients/etc. | Virtual rows 44px, overscan six, sticky columns/actions, selection, column hiding, cell expansion. | `client/components/admin/AdminDataGrid.tsx:52` |
| F-104 | User search/list | R/F/AM/CM | UsersTab | Query/pagination, selected-row bulk actions. | `client/components/admin/UsersTab.tsx:75` |
| F-105 | Create full user | AM (+F custom gates) | User dialog | Handle/name/PIN; name can default handle; optional feature controls. | `client/components/admin/UsersTab.tsx:188`, `server/domain/facade/users.ts:50` |
| F-106 | Admin profile/credential edit | ACM/CM | User dialog | Profile edit advanced role, PIN reset community role. | `server/domain/facade/users.ts:50` |
| F-107 | Product entitlements | F | FeatureGatesPanel | Nine gates including offline, reader types, download, media, AI, image upload. | `client/components/admin/FeatureGatesPanel.tsx:1`, `shared/features.ts:3` |
| F-108 | Admin role assignment | R | RoleManagementFields | Dependencies enforced; last root protected. | `client/components/admin/RoleManagementFields.tsx:1`, `server/services/roleService.ts:26` |
| F-109 | Mute/unmute users | CM | User operations | Hours/days duration; bulk skips already-effective restriction rather than extending. | `client/components/admin/UsersTab.tsx:302` |
| F-110 | Ban/unban users | CM | User operations | Ban revokes sessions; timed restriction with reasonless generic state. | `server/domain/facade/users.ts:50`, `client/components/admin/UsersTab.tsx:226` |
| F-111 | Deactivate versus purge | ACM | User confirmation | Deactivate preserves historical identity; purge domain data then identity; cannot remove self. | `server/domain/facade/users.ts:150` |
| F-112 | Bulk user operations | Specialist roles | SelectionActionBar | Tri-state unchanged/enabled/disabled; batch credits applied per user; not all-or-nothing batch. | `client/components/admin/UsersTab.tsx:302`, `server/actions/admin.ts:50` |
| F-113 | Invitation/ghost users | AM | GhostUsersTab | Generate one-time PIN, latest PIN shown only; pending/unused status; revoke single/bulk. | `client/components/admin/GhostUsersTab.tsx:22` |
| F-114 | Client search/edit | AM | ClientsTab | Client ID, remark, bound-user autocomplete, whitelist state. | `client/components/admin/ClientsTab.tsx:48` |
| F-115 | Identity policy | AM | ClientsTab | MAC/IP/UA selection, at least one; changing identity rules changes matching. | `client/components/admin/ClientsTab.tsx:101` |
| F-116 | Whitelist activation safety | AM | ClientsTab | First promotes and whitelists current client; keep-current shortcut. | `client/components/admin/ClientsTab.tsx:112` |
| F-117 | Client operations | AM | Grid/bulk toolbar | Promote temporary→persistent; lock/unlock; delete warns sessions removed. | `client/components/admin/ClientsTab.tsx:146` |
| F-118 | Full group administration | CM/ACM | GroupsTab | Type, hierarchy, handle/name/password, discovery, hidden members, admin-only, no-leave. | `client/components/admin/GroupsTab.tsx:60` |
| F-119 | System group protection | CM/ACM | GroupsTab | Wild/announcement cannot type-change/reparent; batch delete skips protected groups. | `client/components/admin/GroupsTab.tsx:155` |
| F-120 | Admin membership | ACM | GroupMembersDialog | Add by exact case-insensitive handle, kick single/bulk; hidden-member chip is read-only. | `client/components/admin/GroupMembersDialog.tsx:60`, `client/components/admin/GroupMembersDialog.tsx:119` |
| F-121 | System and idle locks | OA | GlobalTab | Global lock and idle-lock switches; server inactivity threshold five minutes. | `client/components/admin/GlobalTab.tsx:35`, `server/services/maintenance.ts:22` |
| F-122 | Publish announcement | ACM | GlobalTab | New revision requires everyone to acknowledge again. | `client/components/admin/GlobalTab.tsx:112` |
| F-123 | Media server policy | CM | GlobalTab | Maximum volume step .05 and eviction days. | `client/components/admin/GlobalTab.tsx:112` |
| F-124 | AI account management | F | User credit dialog | Plan days/top-up amount/note; idempotency key per target. | `shared/protocol/actions.ts:1126`, `client/components/admin/UsersTab.tsx:188` |
| F-125 | AI billing policy/statistics | F | AiBillingTab | System/plan/top-up totals, consumption chart, daily/weekly allowance/default duration. | `client/components/admin/AiBillingTab.tsx:40` |
| F-126 | HTTPS status | O | MaintainTab | Domain/listeners/certificate expiry, root certificate download, DNS guidance. | `client/components/admin/MaintainTab.tsx:396` |
| F-127 | Permanent HTTPS redirect | O | MaintainTab confirmation | Durable HTTP root redirect; browser caches for ten years. | `server/http/handler.ts:192`, `client/components/admin/MaintainTab.tsx:225` |
| F-128 | SQLite backups | O | MaintainTab | Create/list/download/delete selected; five retained; excludes blob files. | `client/components/admin/MaintainTab.tsx:396`, `server/infra/dbBackup.ts:59` |
| F-129 | Upload update package | O | MaintainTab | ZIP staging, progress/restart status; flush accepted response before apply. | `server/http/routes/deploy.ts:4`, `server/runtime/update/runtime.ts:194` |
| F-130 | Cloud update controls | O | MaintainTab | Manifest URL, enable/autocheck, manual check/install; current install guard bug in §13. | `client/components/admin/MaintainTab.tsx:540`, `server/runtime/update/runtime.ts:297` |
| F-131 | Confirm/rollback release | O | MaintainTab | Three-minute confirmation deadline; launcher rolls back unconfirmed release. | `launcher/launcher.ts:240`, `server/runtime/update/contract.ts:2` |
| F-132 | Kill WPS | OA | ToolsTab | Host-side operation, not browser tab closure. | `client/components/admin/ToolsTab.tsx:46`, `shared/protocol/actions.ts:451` |
| F-133 | Shutdown computer | OA | ToolsTab confirmation | Server host shutdown tool; dangerous operation deliberately exposed. | `client/components/admin/ToolsTab.tsx:46`, `server/services/adminSystemService.ts:1` |
| F-134 | Opened Office file capture | OA | ToolsTab | Windows Word/PowerPoint/Excel/WPS capture, list/download/refresh; polling four seconds. | `client/components/admin/ToolsTab.tsx:109`, `server/runtime/teachDocumentsRuntime.ts:1` |
| F-135 | Clear captured documents | OA | ToolsTab confirmation | Clear-all; non-Windows unavailable and empty captured-list messages. | `client/components/admin/ToolsTab.tsx:153` |
| F-136 | Incident workbench | O | IncidentsTab | Environment/build filters, grouped counts, detail/stack/related IDs, current logs ZIP. | `client/components/admin/IncidentsTab.tsx:27` |
| F-137 | Incident self-tests | O | IncidentsTab | Intentionally trigger client/server errors to verify diagnostics. | `client/components/admin/IncidentsTab.tsx:120` |
| F-138 | Audit log | R | AuditTab | 100/page, actor/action/target/full JSON details, next/previous. | `client/components/admin/AuditTab.tsx:9` |
| F-139 | Debug controls | Debug-enabled deployment | DebugMenu | Force offline, Infini IDs/logs; not normally visible. | `client/components/debug/DebugMenu.tsx:13` |
| F-140 | Gesture/selection suppression | All | App shell | Disable pinch gestures/callout/global selection except inputs and .app-selectable. | `client/components/AppInteractionGuard.tsx:3`, `client/global.css:7` |
| F-141 | Help and bulk UI | Admin roles | Forms/toolbars | Tooltips/help sections, duration days0–30/hours0–23, selection count/clear. | `client/components/shared/HelpTip.tsx:1`, `client/components/admin/MultiSectionDurationPicker.tsx:137`, `client/components/admin/SelectionActionBar.tsx:14` |
| F-142 | Application auto-update | U | Startup/background | Check build every five minutes/remote hello/update signal; stage shell+bundle and reload. | `client/lib/bundle.ts:16` |
| F-143 | Multi-port resource distribution | All | Transparent network layer | Round-robin APIs, stable hashed asset origin, WebSocket stays page origin. | `client/lib/loadBalancer.ts:15` |
| F-144 | Recoverable access to articles/tracks | U | Collections/reader/player | Ownerless capability token and possession recovery; favorite itself grants no access. | `server/services/ownerlessCapability.ts:44` |

## 3. Screens and navigation

Routing is an in-memory discriminated union, not URL routing: initial `{view:'chat', conversation:null}`; navigation sets Zustand state; logout/lost access resets it.
No route is serialized to history/localStorage. Article resume/active article is separately persisted. (`client/interact/types.ts:28`, `client/interact/appStore.ts:140`, `client/interact/appStore.ts:179`)

| Screen / component path | Entry / route | Screen-owned state and exit behavior |
|---|---|---|
| `client/components/App.tsx:105` | Root switch | Auth/lock/app gates, desktop/mobile split, announcement, leave-learning confirmation. |
| `client/components/auth/LockScreen.tsx:8` | Locked client | Sequence accumulator; success unlocks, mistakes reset. |
| `client/components/auth/AppLockedScreen.tsx:25` | System/ban/idle lock | Bottom-left gear, reason, manual lock/logout, 30s lock timing polled 250ms. |
| `client/components/auth/LoginScreen.tsx:19` | No current user | PIN/loading/error; successful invitation opens onboarding. |
| `client/components/auth/OnboardingFlow.tsx:35` | Ghost PIN redemption | PIN1/PIN2/handle/name steps and submission. |
| `client/components/auth/AuthScreen.tsx:1` | Auth wrapper | Branding/auth layout; `client/components/auth/ClientIdBadge.tsx:1` diagnostics. |
| `client/components/chat/ChatView.tsx:59` | `chat` | Nullable group/DM key; toolbar, message list, composer, menus. |
| `client/components/articles/ArticleList.tsx:105` | `articles` | Global/group library, refresh-key remount on article.list_updated. |
| `client/components/articles/BooklistPage.tsx:26` | `booklist` | ID/context, snapshot/error, share state, writer removal. |
| `client/components/articles/ArticleReader.tsx:81` | `reader` | Article ID/from/context, metadata, menu/bookmark/retention; desktop Back returns library. |
| `client/components/articles/TextArticleReader.tsx:20` | Text provider inside reader | Segment window, anchor offset, local/remote boundary status. |
| `client/components/articles/BundleArticleReader.tsx:24` | Bundle provider inside reader | Page ordinal window, frame state, loading/error, geometry. |
| `client/components/media/MediaView.tsx:37` | `media` | Search/results, library, create playlist. |
| `client/components/media/MediaPlaylistPage.tsx:42` | `media-playlist` | Playlist ID, snapshot, share/delete/retention dialogs. |
| `client/components/ai/AiView.tsx:103` | `ai` | Nullable conversation ID, unsaved input/images/fork selection, current run/error. |
| `client/components/settings/Settings.tsx:37` | `settings` | Edit dialogs, profile/PIN stages, reset confirmation. |
| `client/components/learning/Learning.tsx:64` | `learning` | Stats, discipline timer/modal. |
| `client/components/learning/WordLearningPage.tsx:86` | `word-learning` | Quiz/choice/result, speed timer, session totals, exit dialog. |
| `client/components/learning/WrongWordsPage.tsx:27` | `wrong-words` | Page index, total/list/loading; no explicit error view. |
| `client/components/learning/ClearWrongWordsPage.tsx:85` | `clear-wrong` | Quiz countdown, success/exit summary. |
| `client/components/learning/MasteredWordsPage.tsx:23` | `mastered-words` | Page index/list/count/empty state. |
| `client/components/admin/AdminPanel.tsx:40` | `admin` | Local page default overview; md+ vertical 260px nav, mobile horizontal buttons. |
| `client/components/admin/AdminOverview.tsx:9` | Admin overview | Assigned-role summary. |
| `client/components/admin/UsersTab.tsx:75` | Admin users | Query/offset/selection/editor/bulk/restriction/credit/removal dialogs. |
| `client/components/admin/GhostUsersTab.tsx:22` | Admin invitations | Selection, latest generated PIN, bulk confirmation. |
| `client/components/admin/ClientsTab.tsx:48` | Admin clients | Query/paging/selection, edit binding, identity/whitelist config. |
| `client/components/admin/GroupsTab.tsx:60` | Admin groups | Paging/selection/editor, member dialog, destructive confirms. |
| `client/components/admin/AiBillingTab.tsx:40` | Admin AI billing | Policy fields, totals/chart and response status. |
| `client/components/admin/GlobalTab.tsx:35` | Admin global | Lock/announcement/media settings. |
| `client/components/admin/MaintainTab.tsx:77` | Admin maintenance | HTTPS/backups/cloud/update/confirm/rollback, restart polling. |
| `client/components/admin/ToolsTab.tsx:26` | Admin tools | Host action confirmations, document list and polling. |
| `client/components/admin/IncidentsTab.tsx:27` | Admin incidents | Filters, group detail dialog, test/download actions. |
| `client/components/admin/AuditTab.tsx:9` | Admin audit | Offset, entries and users. |

Dialogs, overlays and reusable screen surfaces (including components which are not standalone routes):

| Component path | Reachability / local state |
|---|---|
| `client/components/sidebar/CreateGroupDialog.tsx:35` | Sidebar create; form, parent selection, password/error. |
| `client/components/sidebar/FindGroupDialog.tsx:44` | Sidebar find; query/results/join password. |
| `client/components/chat/DiscoverGroupsDialog.tsx:27` | Chat menu; parent-scoped results/join state. |
| `client/components/chat/MembersDialog.tsx:47` | Chat menu; members/hidden-self/leave/DM controls. |
| `client/components/chat/ConversationSettingsMenu.tsx:118` | Chat toolbar; pin/mute/offline policy dialog. |
| `client/components/chat/MessageComposeBar.tsx:97` | Chat bottom; reply, fullscreen editor, image chooser, errors. |
| `client/components/chat/StickerPicker.tsx:31` | Composer; recent/pack tabs and virtual sticker grid. |
| `client/components/chat/ChatPostCard.tsx:88` | Message row; reply, edit, delete, full text, original-image dialogs. |
| `client/components/chat/ChatMessageList.tsx:34` | Chat content; unread divider and Infini host. |
| `client/components/articles/ArticleImportFab.tsx:70` | Group reading; import form, text/file states. |
| `client/components/articles/NetworkArticleDialog.tsx:47` | Import action; network search/cooldown/results. |
| `client/components/library/ShareAccessDialog.tsx:28` | Booklist/playlist; principal/grant editing and removal. |
| `client/components/media/PlaylistDialogs.tsx:20` | CreatePlaylistDialog, PlaylistRetentionDialog, DeletePlaylistDialog. |
| `client/components/media/MediaSearchPopover.tsx:15` | Music search; results/errors/busy. |
| `client/components/media/QueueDrawer.tsx:18` | Player; queue and clear/remove actions. |
| `client/components/media/NowPlayingBar.tsx:31` | App-wide persistent player; expanded in media route. |
| `client/components/media/AddToPlaylistButton.tsx:1` | Track row menu, playlist choice. |
| `client/components/media/TrackRow.tsx:25` | Search/library/queue/playlist row controls. |
| `client/components/learning/SelfDisciplineModal.tsx:70` | Learning timer; forced quiz overlay. |
| `client/components/admin/GroupMembersDialog.tsx:35` | Admin group row; add by handle/kick selection. |
| `client/components/admin/AdminDataGrid.tsx:52` | Admin tables; column menu and expanded-cell dialog. |
| `client/components/admin/FeatureGatesPanel.tsx:1` | User/bulk editor; feature controls. |
| `client/components/admin/RoleManagementFields.tsx:1` | User/bulk editor; dependent role selection. |
| `client/components/admin/UserOperationFields.tsx:1` | Restriction fields. |
| `client/components/admin/IncrementalField.tsx:1` | Bulk unchanged/change selection. |
| `client/components/admin/MultiSectionDurationPicker.tsx:137` | Restriction duration sections. |
| `client/components/admin/SelectionActionBar.tsx:14` | Selected rows and bulk action commands. |
| `client/components/tasks/TaskManagerPopover.tsx:28` | Sidebar/task affordance; progress/history. |
| `client/components/notifications/MessageBanner.tsx:20` | New post/AI completion transient notification. |
| `client/components/debug/DebugMenu.tsx:13` | Debug-gated app controls. |
| `client/components/debug/InfiniId.tsx:1` | Debug ID overlay in virtual lists. |
| `client/components/shared/HelpTip.tsx:1` | Form help/tooltip/dialog sections. |
| `client/components/shared/NumPad.tsx:13` | Auth and credential entry. |
| `client/components/shared/InfiniView.tsx:40` | Shared bidirectional loading/empty/error/offline boundary UI. |
| `client/components/library/LibrarySection.tsx:1` | Library section heading/empty wrapper. |
| `client/components/library/AccessibleListRow.tsx:1` | Accessible collection row. |
| `client/components/EndfieldLogo.tsx:1` | Shared branding graphic. |
| `client/components/AppInteractionGuard.tsx:3` | Global gesture guards. |
| `client/components/sidebar/Sidebar.tsx:109` | Ephemeral mode/expanded/dialog state. |
| `client/components/sidebar/SidebarTop.tsx:1` | Sidebar header controls. |
| `client/components/sidebar/SidebarBottom.tsx:1` | Settings/admin/learning/tasks/lock controls. |
| `client/components/sidebar/SidebarSection.tsx:1` | Collapsible section wrapper. |
| `client/components/sidebar/SidebarNavigation.tsx:31` | Four-mode navigation. |
| `client/components/sidebar/ConversationSection.tsx:19` | Conversation sorting/unread/pins. |
| `client/components/sidebar/ArticleSection.tsx:1` | Reading sidebar projection. |
| `client/components/sidebar/MediaSection.tsx:1` | Music sidebar projection. |
| `client/components/sidebar/AiSection.tsx:43` | AI search/list/credit status. |

State boundary: dialog fields, admin current page, sidebar expansion and AI draft disappear on remount/reload; user theme, chat drafts, reading state and retention live in the persistence systems below.
Evidence: `client/components/admin/AdminPanel.tsx:40`, `client/components/sidebar/Sidebar.tsx:109`, `client/data/model.ts:117`, `client/components/ai/AiView.tsx:103`.

## 4. Data model

Server schema notation: T=TEXT, I=INTEGER, R=REAL; `!`=NOT NULL, `?`=nullable, `=x`=default; PK/UK=primary/unique key; FK arrows name referenced table and delete action.
Unless otherwise shown, `created_at`/`updated_at` are `T! DEFAULT datetime('now')`; JSON is TEXT with `json_valid` checks where stated; booleans remain INTEGER, not native Boolean types.
Ordinary UUID identifiers have no SQL UUID type; SQLite TEXT PRIMARY KEY is reported literally and not silently strengthened to NOT NULL.
Database is `<DATA_ROOT>/data.db`, better-sqlite3, WAL, foreign_keys ON, busy_timeout 5000ms; coordinator initializes/migrates, executor connections do not. (`server/infra/db.ts:13`)

Identifiers: most entities use random UUID; clients use `C-` plus eight uppercase hex digits with collision retry; incidents expose `I_` plus a 22-character public ID; conversation IDs are deterministic group/dm strings. SQL timestamps are generally UTC datetime text,while proposal/grant/expiry/quota ordering uses explicit epoch milliseconds. (`server/data/clients.ts:59`, `scripts/tests/test-e2e.mts:420`, `shared/conversations/id.ts:1`, `shared/time.ts:1`)

### 4.1 Current SQL tables: identity, community and content

| Table | Every current column / type / default | Constraints, indexes, relationships | Definition |
|---|---|---|---|
| config | key T PK; value T! | String configuration/schema ledger; secrets also stored here. | `server/infra/db.ts:1044` |
| users | id T PK; handle T!; username T!; profile_revision I!=0; feature_bitset I!=DEFAULT_FEATURE_BITSET; is_muted I!=0; muted_until T?; banned_until T?; created_at | UK(handle); feature bits map nine gates. | `server/infra/db.ts:1049` |
| user_admin_roles | user_id T!; role T!; granted_by T?; granted_at T!=now | PK(user_id,role); eight-role CHECK; user→users CASCADE, grantor→users SET NULL; index(role,user_id). | `server/infra/db.ts:1061` |
| admin_audit_log | id T PK; actor_id T?; action T!; target_kind T!; target_id T?; details_json T!='{}'; created_at | Actor→users SET NULL; JSON valid; index(created_at DESC,id DESC). | `server/infra/db.ts:1071` |
| deleted_users | id T PK; username T!; deleted_at T!=now | id→users CASCADE; soft-deactivated identity marker. | `server/infra/db.ts:1083` |
| user_pins | id T PK; user_id T!; pin_hash T!; created_at | User→users CASCADE; UK(pin_hash), globally exclusive login PIN hash. | `server/infra/db.ts:1089` |
| clients | id T PK; konami_locked I!=1; persistent I!=0; remark T!=''; whitelisted I!=0; bound_user_id T?; created_at | Bound user→users SET NULL; index(bound_user_id). | `server/infra/db.ts:1096`, `server/infra/db.ts:1759` |
| client_ips | client_id T!; ip T!; first_seen T!=now; last_seen T!=now | PK(client_id,ip); client→clients CASCADE; index(ip). | `server/infra/db.ts:1106` |
| client_associations | id I PK AUTOINCREMENT; client_id T!; mac T?; ip T!; user_agent T!=''; first_seen/last_seen T!=now | Client→clients CASCADE; indexes(client_id,last_seen DESC),(ip,last_seen DESC). | `server/infra/db.ts:1115` |
| client_attempts | client_id T PK; attempts I!=0; throttled_until T? | Client→clients CASCADE. | `server/infra/db.ts:1129` |
| sessions | token T PK; user_id T!; client_id T!; created_at | Both FKs CASCADE; index(client_id); expiry imposed by queries/maintenance. | `server/infra/db.ts:1135` |
| groups | id T PK; conv_id T!; revision I!=0; handle T!; name T!; discoverable I!=0; password_hash T?; type T!='normal'; members_hidden/admin_only/no_leave I!=0; parent_group_id T?; created_at | UK(conv_id),UK(handle),index(handle); conv_id equals concatenation of 'group:' and id; boolean CHECKs; parent→groups SET NULL. | `server/infra/db.ts:1143` |
| group_members | group_id/user_id T!; joined_at T!=now; hide_self I!=0 | PK(group_id,user_id); both FKs CASCADE; bool CHECK; index(user_id,group_id). | `server/infra/db.ts:1160`, `server/infra/db.ts:1323` |
| dms | id T PK; conv_id T!; revision I!=0; peer_a/peer_b T!; proof_group_id T?; created_at | UK(conv_id),UK(peer_a,peer_b); peer_a<peer_b, no colons; id=a:b, conv_id=dm:a:b; peers deliberately not FKs; proof→groups SET NULL; per-peer created_at DESC indexes. | `server/infra/db.ts:1168`, `server/infra/db.ts:1324` |
| posts | sequence I PK AUTOINCREMENT; id T!; conv_id T!; revision I!=0; author_id T?; brief T!=''; content_json T!; reply_to T?; deleted_at/edited_at T?; created_at | UK(id); author→users SET NULL, reply→posts(id) SET NULL; JSON valid; exact deleted/text payload checks; indexes(conv_id,sequence DESC),(author_id,sequence DESC),(brief). | `server/infra/db.ts:1183`, `server/infra/db.ts:1326` |
| user_config | user_id T!; key T!; value T!; updated_at; updated_at_ms I!=0 | PK(user_id,key); user→users CASCADE; scalar JSON/string conventions in service. | `server/infra/db.ts:1201` |
| ghost_users | id T PK; pin_hash T!; oobe_token T?; oobe_expires T?; created_at | UK(pin_hash),UK(oobe_token); invitation becomes real account through onboarding. | `server/infra/db.ts:1210` |
| articles | id T PK; user_id T?; title T!; provider_json T!; created_at | User→users SET NULL; JSON discriminated text/bundle shape CHECK; indexes(user_id,created_at DESC),(created_at DESC,id DESC). | `server/infra/db.ts:1218` |
| text_article_segments | article_id T!; segment_index/start_offset I!; char_count I!; content T! | PK(article_id,segment_index),UK(article_id,start_offset), index same; article FK CASCADE; offsets≥0, char_count1..10000. | `server/infra/db.ts:1242`, `server/infra/db.ts:1412` |
| teach_documents | id T PK; application/document_type/name/blob_id T!; file_size I!=0; status T!='ready'; created_at | UK(blob_id); type word/powerpoint/excel; status capturing/ready; index(created_at DESC). | `server/infra/db.ts:1255` |
| article_read_progress | user_id/article_id T!; offset I!=0; locator T?; total_read_seconds I!=0; updated_at; updated_at_ms I!=0 | PK(user_id,article_id); both FKs CASCADE. | `server/infra/db.ts:1268` |
| client_last_active | client_id T PK; last_at T!=now | Client→clients CASCADE. | `server/infra/db.ts:1279` |
| convs_user | user_id/conv_id T!; last_read_post_id T?; pinned_at T?; pinned_updated_at_ms I!=0; compose_draft T?; compose_draft_updated_at I!=0; muted I!=0; read_updated_at_ms/muted_updated_at_ms I!=0; updated_at | PK(user_id,conv_id); user→users CASCADE; last-read→posts SET NULL + index; muted boolean CHECK. | `server/infra/db.ts:1284` |
| words | id T PK; english T!; phonetic T!=''; definition T!; created_at | Index(english), not UNIQUE; service skips duplicate English on import. | `server/data/words.ts:13` |
| user_word_progress | user_id/word_id T!; learned_count/wrong_count I!=0; status T!='unlearned'; last_practiced_at T?; created_at/updated_at | PK(user_id,word_id); both FKs CASCADE; status unlearned/learning/mastered; indexes(user_id),(user_id,status),(user_id,wrong_count DESC). | `server/data/words.ts:22` |

Article provider payload: text `{type:'text',words,chunks}` with nonnegative integer counts; bundle includes source_file/archive_file/source_mime strings and source_bytes/archive_bytes/items nonnegative integers.
`words`/text `content_length` count UTF-16 code units, not words; bundle length counts pages. (`server/infra/db.ts:1218`, `server/data/articles.ts:104`, `shared/articles/segments.ts:17`)
Post text is stored in `brief`; text `content_json` is exactly `{type:'text',text_same_as_brief:true}`; deleted JSON is exactly `{type:'deleted'}` and deleted_at must agree. (`server/infra/db.ts:1183`)
Triggers reject nonexistent conversation refs on posts/convs_user, bump conversation revision on post changes, prevent identity mutation, cascade conversation deletion into posts/state, and reject article/segment UPDATE. (`server/infra/db.ts:1331`)

### 4.2 Current SQL tables: AI, diagnostics, assets and access

| Table | Every current column / type / default | Constraints / indexes | Definition |
|---|---|---|---|
| incident_groups | id I PK AUTOINCREMENT; environment/build_id/fingerprint/top_frame T!; occurrence_count/stored_detail_count I!=0; first_at/last_at T! | Environment server/client; UK(environment,build_id,fingerprint); indexes(last_at DESC),(environment,build_id,last_at DESC). | `server/infra/db.ts:68` |
| incidents | id I PK AUTOINCREMENT; public_id T?; group_id I!; occurred_at T!; error_name/message/stack/context_json/related_incident_ids_json T? | UK(public_id); group FK CASCADE; nullable JSON checked; index(group_id,id DESC). | `server/infra/db.ts:85` |
| ai_conversations | id T PK; user_id T!; title/title_norm T!; active_leaf_message_id T?; forked_from_conversation_id/forked_from_message_id T?; last_assistant_sequence/last_read_assistant_sequence I!=0; archived_at T?; created_at/updated_at | User FK CASCADE; fork conversation self FK SET NULL; indexes(user_id,archived_at,updated_at DESC),(user_id,title_norm). | `server/infra/db.ts:103` |
| ai_messages | sequence I PK AUTOINCREMENT; id T!; conversation_id T!; parent_message_id T?; role T!; content T!=''; attachments_json T!='[]'; status T!; run_id T?; created_at/updated_at | UK(id); conversation CASCADE; parent self(id) RESTRICT; role user/assistant; status pending/streaming/completed/failed/cancelled; JSON valid; indexes(conversation_id,sequence),(parent_message_id). | `server/infra/db.ts:122` |
| ai_runs | id T PK; user_id/conversation_id/input_message_id/output_message_id T!; status T!; revision I!=0; model_placeholder/provider_model/reasoning_effort T?; reserved_credit_micros/charged_credit_micros/input_tokens/cached_input_tokens/output_tokens I!=0; cancel_requested I!=0; error T?; created_at/updated_at | Four FKs CASCADE; status queued/routing/running/completed/failed/cancelled; bool cancel; partial UK(conversation_id) on active statuses; index(user_id,updated_at DESC). | `server/infra/db.ts:142` |
| ai_run_attempts | id T PK; run_id T!; attempt I!; provider_model T!; provider_request_id T?; status T!; visible_output I!=0; input_tokens/cached_input_tokens/output_tokens I!=0; error T?; created_at/updated_at | Run FK CASCADE; UK(run_id,attempt); running/completed/failed; visible bool. | `server/infra/db.ts:171` |
| ai_conversation_tags | conversation_id/normalized_tag/display_tag T!; prompt_version I!; created_at | PK(conversation_id,normalized_tag); conversation CASCADE; index(normalized_tag,conversation_id). | `server/infra/db.ts:188` |
| ai_context_snapshots | id T PK; conversation_id/through_message_id/summary_json T!; prompt_version I!; created_at | Conversation/message CASCADE; valid JSON; UK(conversation_id,through_message_id,prompt_version). | `server/infra/db.ts:199` |
| ai_credit_accounts | user_id T PK; top_up_credit_micros/reserved_credit_micros I!=0; updated_at | User CASCADE; both amounts≥0. | `server/infra/db.ts:209` |
| ai_credit_ledger | id T PK; user_id T!; kind T!; delta_credit_micros I!; top_up_after_credit_micros I!; run_id/admin_id T?; idempotency_key T!; note T!=''; created_at | User CASCADE; run/admin SET NULL; kind top_up/reserve/settle/release; after≥0; UK(idempotency_key); index(user_id,created_at DESC). | `server/infra/db.ts:216` |
| ai_billing_policy | id I PK; daily_credit_micros/weekly_credit_micros/default_plan_duration_days I!; updated_by T?; updated_at | id=1; allowances≥0,days>0; updater→users SET NULL; seeded 100000000/300000000/30. | `server/infra/db.ts:231` |
| ai_plan_enrollments | user_id T PK; starts_at/ends_at T!; assigned_by T?; updated_at | User CASCADE; assigner SET NULL; ends_at>starts_at. | `server/infra/db.ts:243` |
| ai_credit_reservations | operation_id T PK; user_id T!; run_id T?; amount_credit_micros I!; status T!; created_at/updated_at | User CASCADE; run SET NULL; amount≥0; active/settled/released; index(user_id,status). | `server/infra/db.ts:252` |
| ai_credit_usage | id T PK; operation_id/user_id T!; run_id T?; day_key/week_key T!; charged_credit_micros/plan_credit_micros/top_up_credit_micros I!; created_at | UK(operation_id); user CASCADE/run SET NULL; nonnegative amounts and charged=plan+top_up; indexes(user_id,day_key),(week_key). | `server/infra/db.ts:264` |
| ai_file_operations | id T PK; user_id T!; run_id T?; call_id T!; before_revision/after_revision I!; status T!; result_json/error T?; created_at/updated_at | User CASCADE/run SET NULL; UK(user_id,call_id); planned/committed/failed; nullable JSON valid. | `server/infra/db.ts:282` |
| ai_workspaces | user_id T PK; blob_id/staging_blob_id T?; updated_at | User CASCADE; durable/staging publication pointers. | `server/infra/db.ts:297` |
| media_tracks | id T PK; source/provider_id/canonical_url/title T!; artists_json T!='[]'; album T?; duration_ms I!; thumbnail_url T?; metadata_revision/ref_count I!=0; last_used_at T?; created_at/updated_at | UK(source,provider_id); valid JSON; duration/refcount≥0; index(ref_count,last_used_at). | `server/infra/db.ts:306` |
| media_assets | track_id/kind/state T!; blob_id/mime T?; bytes I!=0; sha256/failed_code/downloaded_at T?; updated_at | PK(track_id,kind); track CASCADE; UK(blob_id); audio/cover; queued/downloading/ready/failed; bytes≥0; index(kind,state,downloaded_at). | `server/infra/db.ts:326` |
| media_lists | id T PK; kind/title T!; revision I!=0; retention_days I!=7; expires_at T?; created_at/updated_at | Kind playlist/queue; retention1..365; index(kind,updated_at DESC); ownership is in access bindings. | `server/infra/db.ts:342` |
| media_list_items | list_id T!; position I!; track_id T!; added_at T!=now | PK(list_id,position); list/track CASCADE; position≥0; index(track_id,list_id). | `server/infra/db.ts:355` |
| media_stream_grants | token T PK; track_id T!; user_id T?; expires_at/created_at I! | Track/user CASCADE; index(track_id,expires_at); epoch-ms times. | `server/infra/db.ts:365` |
| user_queues | user_id T PK; list_id T! | Both FKs CASCADE; UK(list_id). | `server/infra/db.ts:392` |
| storage_quota_pools | name T PK; max_weight I!=0; target_ratio R!=0.8; half_life_ms I!; updated_at | max≥0,0<ratio≤1,half-life>0. | `server/infra/db.ts:399` |
| storage_quota_items | pool/item_id/class T!; weight I!=0; heat R!=0; touched_at_ms I!; pin_until_ms I!=0; created_at_ms I! | PK(pool,item_id); pool CASCADE; cache/durable; weight/heat/pin≥0; index(pool,class,weight). | `server/infra/db.ts:407` |
| post_images | id T PK; post_id T?; blob_id/mime T!; bytes/width/height I!; sha256 T!; created_at | UK(post_id),post FK default NO ACTION; dimensions/bytes>0; index(post_id),partial index(created_at) WHERE post_id IS NULL. | `server/infra/db.ts:423` |
| post_image_thumbs | image_id T PK; blob_id/mime T?; bytes/width/height I!=0; sha256 T?; state T!; generation I!=0; updated_at | Image CASCADE; nonnegative metrics; absent/staging/ready/failed. | `server/infra/db.ts:438` |
| article_uploads | id T PK; user_id/booklist_id/status/source_blob_id/archive_blob_id T!; source_bytes/archive_bytes I!=0; created_at/updated_at | User/booklist CASCADE; staging/published/abandoned; bytes≥0; index(status,created_at). | `server/infra/db.ts:453` |
| booklists | id T PK; title T!; revision I!=0; created_at/updated_at | Index(updated_at DESC). | `server/infra/db.ts:470` |
| booklist_items | booklist_id T!; position I!; article_id T!; added_at T!=now | PK(booklist_id,position); both FKs CASCADE; position≥0; index(article_id,booklist_id). | `server/infra/db.ts:480` |
| group_booklists | group_id T PK; booklist_id T! | Both FKs CASCADE; UK(booklist_id). | `server/infra/db.ts:490` |
| access_bindings | resource_kind/resource_id/principal_kind/principal_id/grants_json T!; created_at/updated_at | PK(first four); principal user/group; valid JSON; indexes(principal_kind,principal_id,resource_kind),(resource_kind,resource_id); polymorphic IDs lack resource FKs. | `server/infra/db.ts:498` |
| access_effective | user_id/resource_kind/resource_id T!; can_read/can_write/can_own/can_share_read/can_share_write/can_share_own I!; provenance_json T!; updated_at | PK(first three); user CASCADE; six bool CHECKs; valid JSON; indexes(user_id,resource_kind,can_read),(resource_kind,resource_id). | `server/infra/db.ts:513` |
| resource_possession | user_id/resource_kind/resource_id/capability/source_kind T!; source_id T?; expires_at_ms I!; updated_at | PK(first three); user CASCADE; index(expires_at_ms); held tokens, not access binding. | `server/infra/db.ts:533` |
| user_favorites | user_id/resource_kind/resource_id T!; favorited I!=1; updated_at_ms I!=0; created_at | PK(first three); user CASCADE; bool; index(user_id,resource_kind,favorited,updated_at_ms DESC). | `server/infra/db.ts:548` |
| user_recents | user_id/resource_kind/resource_id/last_used_at T!; last_used_at_ms I! | PK(first three); user CASCADE; index(user_id,resource_kind,last_used_at_ms DESC). | `server/infra/db.ts:560` |

Media item INSERT/DELETE triggers adjust track ref_count/last_used_at and abort refcount underflow. (`server/infra/db.ts:375`)
Migrations use string `config.schema_version`; fresh schema 28, implemented transitions 17→18→25→26→27→28, each migration+ledger transactional; unsupported intermediate versions error. (`server/infra/db.ts:982`)
v18→25 introduces roles/billing/profile/media/storage changes and clears some bundle/teach/import data; v25→26 deletes bundle articles/assets/workspaces/captures and recursively removes storage; this is destructive, not a preserving migration. (`server/infra/db.ts:586`, `server/infra/db.ts:708`)
v26→27 splits owned collection bindings from ownerless capabilities, adds booklists/favorites/recents; article_bookmarks is migrated then dropped; v27→28 adds images and gate. (`server/infra/db.ts:747`, `server/infra/db.ts:957`, `server/infra/db.ts:974`)
Names ending `_v27`, `_split`, `_generic`, `_hold` and `storage_eviction_groups` are historical migration scaffolding, not current tables. (`server/infra/db.ts:708`, `server/infra/db.ts:747`)
Defaults include lock/idle/whitelist off, identity methods MAC+UA, blank announcement revision zero, volume one; secrets randomly generated, initial root/groups/word list seeded. (`server/infra/db.ts:1751`)

### 4.3 IndexedDB, local settings and cache storage

Database `classapp-runtime`; semantic app schema 5 is independent of physical IDB version. Nineteen application stores plus two shell-owned stores; no current client/bootstrap localStorage or sessionStorage usage found by source grep. (`client/data/schema.ts:1`, `client/data/migration.ts:105`, `client/data/shellSchema.ts:1`)
Notation below: `[...]` composite key/index, U=unique index; cached records include only the described projection, not necessarily full server rows.

| Store | Key / indexes | Value shape / meaning | Evidence |
|---|---|---|---|
| files | Out-of-line `[physical_id,extent]` | ArrayBuffer extent bytes. | `client/data/schema.ts:120`, `client/data/files.ts:5` |
| file_heads | id; by-state-created `[state,created_at]` | physical_id,size,state complete/mutating,created_at,checksum,optional grow/shrink target. | `client/data/schema.ts:121`, `client/data/files.ts:5` |
| globals | key | `active-me` user pointer and `app-schema-version` marker plus global runtime values. | `client/data/schema.ts:124`, `client/data/model.ts:14` |
| domain_groups | id; U conv_id | Group metadata/revision/latest activity. | `client/data/schema.ts:35`, `client/data/model.ts:34` |
| domain_dms | conv_id; peer_a,peer_b | Peer IDs/revision/latest activity. | `client/data/schema.ts:38`, `client/data/model.ts:59` |
| domain_posts | id; U `[conv_id,sequence]`; `[conv_id,revision]`; `[eviction_tier,touched_at]` | Canonical PostEntity, sequence,size,touched_at,eviction_tier. | `client/data/schema.ts:42`, `client/data/model.ts:14` |
| domain_articles | id; `[group_id,created_at,id]`; eviction pair | Article metadata/provider/content kind/MIME/filename/size/length, cached size/touch/tier. | `client/data/schema.ts:49`, `client/data/model.ts:69` |
| domain_article_segments | `[article_id,start_offset]`; article_id; U article/start; eviction pair | Segment value and size/touch/tier. | `client/data/schema.ts:53`, `client/data/model.ts:21` |
| domain_users | id | id,revision,handle,username. | `client/data/schema.ts:62`, `client/data/model.ts:94` |
| domain_media_tracks | id; U `[source,provider_id]` | MediaTrack plus touched_at. | `client/data/schema.ts:64`, `client/data/media.ts:12` |
| domain_media_lists | id; `[owner_user_id,kind]` | Caching actor,kind,title,revision,retention_days,timestamps,expiry,cover,last_played. owner_user_id is cache actor, not server owner. | `client/data/schema.ts:71`, `client/data/media.ts:12` |
| domain_media_list_items | `[list_id,position]` | list_id,position,track_id,added_at. | `client/data/schema.ts:76`, `client/data/media.ts:12` |
| domain_me | me_id | User/session token, konami-lock Assignment, app_disable/system_locked,updated_at. | `client/data/schema.ts:82`, `client/data/model.ts:101` |
| domain_me_access | `[me_id,kind,object_id]`; `[me_id,kind]`; `[kind,object_id]` | Conversation rights; article view memberships; group-member visibility projection. | `client/data/schema.ts:84`, `client/data/model.ts:111` |
| domain_me_conv_state | `[me_id,conv_id]`; me_id; `[me_id,pending]` | read/pinned/muted/draft Assignments and canonical unread projection. | `client/data/schema.ts:90`, `client/data/model.ts:159` |
| domain_me_article_state | `[me_id,article_id]`; me_id; `[me_id,pending]` | bookmark/resume/furthest Assignments,read seconds,last_read_at. | `client/data/schema.ts:96`, `client/data/model.ts:175` |
| domain_me_state | `[me_id,key]`; me_id; `[me_id,pending]` | Arbitrary versioned user-setting Assignment. | `client/data/schema.ts:102`, `client/data/model.ts:186` |
| domain_save | `[claimant,kind,object_id]`; `[kind,object_id]`; `[kind,protected_until]` | mode,keep_after_ms,protected_until,materialized,bytes,last_touched_at,missing_reason never-downloaded/evicted/failed. | `client/data/schema.ts:108`, `client/data/model.ts:227` |
| domain_sync | scope; kind | Post coverage/revisions/range boundaries or authoritative list/member completeness. | `client/data/schema.ts:114`, `client/data/model.ts:193` |
| shell_bundles | build_id | entrypoint_code ArrayBuffer,installed_at. | `shell.html:55`, `client/lib/bundle.ts:77` |
| shell_kv | key | `active-bundle`, `schema-version` pointers/markers. | `shell.html:55`, `client/lib/bundle.ts:77` |

Assignment holds canonical base plus at most one pending local proposal with operation_id and ordering timestamp; later proposal survives older remote base, ties favor canonical. (`client/repo/assignment.ts:45`)
File engine: 4MiB extents, four extents per transaction, 256KiB stream chunks, physical generation `logical-id@base36-time-random`, atomic head publication, five-minute orphan grace. (`client/data/files.ts:5`)
File locks prefer Web Locks, fall back to page-local serialization; old-browser multi-tab guarantees are correspondingly weaker. (`client/data/files.ts:68`)
Logical file IDs: `article:{id}:bundle:catalog`, `article:{id}:bundle:resource:{contentId}`, `post-image:{id}:thumb|original`, `media:{trackId}:audio`. (`client/data/fileIds.ts:1`, `client/hooks/useMediaPlayer.ts:135`)
App migration knows historical stores bundles/groups/dms/posts/articles/article_segments/users/me/me_access/me_conv_state/me_article_state/me_state/save/sync; destructive app rebuild preserves shell stores. (`client/data/migration.ts:9`)
Special v2/v3 migrations change indexes then set semantic version directly to 5; unlike v4 path they do not explicitly create media stores—potential compatibility inconsistency. (`client/data/migration.ts:105`)
IDB upgrade blocking errors after 5s; idle connection leases close after 250ms and on pagehide/versionchange. (`client/data/migration.ts:188`, `client/data/idb.ts:21`)
Cache Storage contains `classapp-runtime-meta` with `/__classapp_shell_build__` plus `classapp-shell-{build}` with `/` shell HTML; activated version removes older shell caches. (`server/http/serviceWorker.ts:3`)
Cache Storage does not hold document/music/API bodies; those caches use IDB. No claim of guaranteed browser persistence: requestPersistentStorage exists but has no call sites. (`server/http/serviceWorker.ts:111`, `client/interact/quota.ts:102`)

### 4.4 On-disk objects and lifecycle

- Blob ID is opaque UUID, not content hash; path `<DATA_ROOT>/storage/objects/<first2hex>/<next2hex>/<uuid>`, with sibling `staging/<uuid>` and `trash/<uuid>`. (`server/storage/paths.ts:3`)
- Stage files use exclusive creation and mode 0600; writes stream SHA-256, fsync, rename; metadata hash does not create global deduplication. (`server/storage/blobStore.ts:152`, `server/storage/blobStore.ts:250`)
- Retirement renames into trash; same open descriptor is statted/read for stream/range consistency; leases prevent eviction during reads. (`server/storage/blobStore.ts:337`, `server/http/routes/mediaAudio.ts:29`)
- GC scans staging after default one hour and trash after one minute; mtime checked twice under keyed lock; never scans all published objects for reachability. Domain intent rows must reconcile orphan publications. (`server/storage/gc.ts:54`, `server/storage/blobStore.ts:82`)
- PDF has durable source blob plus reconstructible archive blob; upload intents record both IDs before processing. Within the render archive, raw SHA-256 content IDs deduplicate resources (§7). (`server/services/articlesService.ts:250`, `lib/poppler/utils/PdfRenderBundle.cc:340`)
- AI TreeStore is ZIP with `manifest.json` format `classapp-object-tree` v1 and revision; entries carry UUID,path,MIME,size,SHA256,ISO updatedAt; payloads `objects/<entryUUID>`. (`server/storage/treeStore.ts:8`)
- Generic tree limits: manifest2MiB, entries10000, entry512MiB, path1024/depth16; normalized paths reject traversal/backslash/control characters; validate size/hash and unexpected ZIP members. AI narrows limits further. (`server/storage/treeStore.ts:62`, `server/storage/paths.ts:14`)
- SQL quota pools track decaying heat, weight, durable/cache class and pin time; durable never automatically evicted; above max target floor(max×0.8), default50 candidates/20 sweeps/max200 evictions. (`server/storage/quotaService.ts:27`, `server/data/quota.ts:175`)
- Image originals durable/unlimited pool; thumbnails cache pool512MiB, target.8,half-life7d,pin10min,stageTTL30min. Captured Office pool max0 disables size sweeping; half-life7d is not a retention deadline. (`server/services/postImagesService.ts:33`, `server/runtime/teachDocumentsRuntime.ts:113`)

## 5. Server

### 5.1 Process, configuration and authority

- `server/boot.ts` CJS entry sends `classapp:ready`, waits ≤5s for launcher `classapp:boot`, validates runtime config, imports `server/main.mjs`; SIGINT/SIGTERM allow 10s shutdown. (`server/boot.ts:35`)
- Main configures update IPC, DB/coordinator, storage/upload/image/AI reconciliation, media/teach/WS/maintenance, then each HTTP/HTTPS listener; configured HTTPS ports require certificate files. (`server/main.ts:16`)
- Coordinator owns process-lifetime sticky runtimes: AI, imports, staged uploads, events, media, images, storage, teach capture, updates. HTTP processing is coordinator-side. (`server/runtime/coordinator.ts:40`)
- Action work uses worker_threads, default CPU-clamped 2..8 executors or positive CLASSAPP_EXECUTORS; each worker owns SQLite/BlobStore and processes queued jobs. Long-lived operations proxy through sticky RPC. (`server/runtime/executorPool.ts:47`, `server/runtime/executorWorkerMain.ts:24`)
- Scope captures actor/request graph; facade authorizes, service implements domain policy, data module owns SQL. UnitOfWork defers events/effects until transaction commit; rollback discards callbacks; one failed postcommit callback does not skip others. (`server/runtime/scope.ts:81`, `server/runtime/unitOfWork.ts:7`)
- Runtime fields: appDir,dataRoot,buildId,ports,securePorts,bindHost,trustedProxyIps,nodeEnv,debugOverride,initialAdminPin,platform renderer/media,HTTPS paths/domain/redirect override,update staging/backup dirs. (`server/infra/runtimeConfig.ts:33`)

| Configuration source | Meaning / default | Evidence |
|---|---|---|
| NODE_ENV | Production paths and boot mode; launcher sets production. | `launcher/launcher.ts:290`, `server/infra/runtimeConfig.ts:152` |
| CLASSAPP_PORTS / CLASSAPP_SECURE_PORTS | Launcher comma-separated HTTP/HTTPS ports; defaults80,81,82,83,84,85,86,88 /443. | `launcher/launcher.ts:48` |
| CLASSAPP_DEBUG_OVERRIDE / CLASSAPP_HTTPS_REDIRECT_OVERRIDE | 1/true/0/false override flags. | `launcher/launcher.ts:52` |
| CLASSAPP_EXECUTORS | Positive pool size override; default CPU clamp2..8. | `server/runtime/executorPool.ts:47` |
| CLASSAPP_PDFRENDER_PATH | Native renderer override; otherwise platform-specific bundled path. | `server/infra/runtimeConfig.ts:152` |
| CLASSAPP_MEDIA_YTDLP_PATH / CLASSAPP_MEDIA_POT_ENTRY / CLASSAPP_MEDIA_PLUGIN_DIR | Development media executable/server/plugin roots; plugin roots split by OS path delimiter. | `server/infra/runtimeConfig.ts:139` |
| CLASSAPP_BUILD_CACHE | Reconstructible build/cache location selector, also used resolving development media paths. | `server/infra/runtimeConfig.ts:102`, `scripts/builds/build-cache.mjs:1` |
| TOMATO_CLIENT_POOL_SIZE | Network novel pool, default two. | `server/runtime/articleImportRuntime.ts:48` |
| CLASSAPP_BUILD_ID / CLASSAPP_RUST_TOOLCHAIN | Build identity override / Rust nightly override. | `scripts/builds/build.mjs:42`, `scripts/builds/build-wasm.mjs:6` |
| CLASSAPP_REQUIRE_HTTPS | Build fails if required HTTPS inputs absent. | `scripts/builds/build.mjs:60` |
| models.json | Production appDir model/provider credentials; dev source refers to excluded worktree/secrets/models.json; mtime-cached validation, unavailable AI on missing/invalid config. | `server/infra/aiModels.ts:145` |
| https/config.json | Domain/certificate/privateKey/rootCertificate paths in installed current version. Secret key file exists by configuration, contents not inspected. | `launcher/launcher.ts:74` |
| SQL config | Whitelist, identity methods, locks, announcement, cloud update settings, generated PIN/capability secrets and feature/media policy. | `server/infra/db.ts:1751`, `shared/protocol/actions.ts:403` |

Authentication and permission behavior:

- Login is globally unique six-digit PIN, HMAC-SHA256 with database pin_secret, not username+password; one/two distinct replacement PINs; sessions use 32 random bytes encoded hex. (`server/infra/credentials.ts:5`, `server/services/authService.ts:86`)
- Five failed attempts throttle that client for 15 minutes; whitelist/bound-user/ban gates apply; max two live users per device; success unlocks and replaces that user's device session. (`server/services/authService.ts:146`, `server/data/clients.ts:332`)
- SQL session lookup accepts only last24h; auto-login retrieves most recent eligible stored session/token; maintenance expires old rows. (`server/data/auth.ts:118`, `server/services/authService.ts:146`)
- HTTP token comes from Bearer Authorization or `?token`; no cookie-session flow. WS authenticates a user/token binding, and can bind multiple users on one connection. (`server/http/handler.ts:141`, `server/protocol/WebSocketProtocol.ts:83`)
- Client identity consults local interfaces/Linux ARP then `arp -a <ip>` with1s timeout; UA capped1000; selected identity columns combined AND. Only trustedProxyIps authorize forwarded IP. (`server/infra/clientIdentity.ts:27`, `server/data/clients.ts:1`)
- Base administrator opens workbench and, despite its role description, also bypasses group membership/admin-only posting checks (`server/domain/facade/posts.ts:30`). R assigns roles; O incidents/HTTPS/updates/backups; F gates/AI policy/credits; OA locks/tools; AM admission/invites; CM moderation/credential reset/group creation; ACM adds profile/deletion/membership/announcement powers. (`shared/authority.ts:28`)
- Specialist roles depend on administrator; ACM also depends on CM; last root cannot be removed; self-delete rejected. (`shared/authority.ts:49`, `server/services/roleService.ts:26`, `server/domain/facade/users.ts:150`)
- Resource bindings target user/group principals and grant read/write/own/delegation; effective rights/provenance recomputed when group/access changes. Articles/tracks instead use held ownerless read capabilities. (`server/services/accessService.ts:1`, `server/services/ownerlessCapability.ts:44`)
- Capability format `c1.<base64url JSON>.<HMAC>`, constant-time signature compare; search lifetime24h, collection/recovery30d; held valid token can outlive source-list access; favorites/recents alone cannot recover access. (`server/services/capabilityService.ts:64`, `shared/access/capability.ts:40`)

### 5.2 HTTP / WebSocket route table

Auth column uses §1 role shorthand. Non-banned authenticated actor and resource checks apply in addition to named gates. Shared HTTP catch returns500 `{error,incidentId}`, including many permission PublicErrors, unless route explicitly sets another status. (`server/http/errorResponse.ts:10`)

| Method | Path | Auth | Request | Response / purpose | Route implementation |
|---|---|---|---|---|---|
| GET | /api/endpoints | Public | Host/origin | `{origins}` for multi-port clients | `server/http/routes/endpoints.ts:3` |
| POST | /api/articles | U+articles+ebook_reader, target write | Multipart file,title?,group_id; PDF≤200MiB | 201 `{article,users,capability}`;400 missing,410 nonmultipart,413 declared oversize | `server/http/routes/articleUpload.ts:8` |
| GET | /api/articles/:id/source | Same features + article capability/recovery | capability?,single Range | PDF200/206,416 invalid range; private immutable1yr | `server/http/routes/articleSource.ts:8` |
| POST | /api/articles/:id/bundle/resources | Same bundle read rights | JSON content_ids,capability? | Binary bundle stream, no-store; unique1..64 IDs, ≤513MiB framed batch | `server/http/routes/articleBundleResources.ts:11` |
| POST | /api/posts/images | U+post_images + post permission | Multipart file,conv_id,reply_to?;≤12MiB | 201 post;400 invalid/missing,413 declared oversize | `server/http/routes/postImageUpload.ts:7` |
| GET | /api/posts/images/:id/original | U + conversation read | Image id | Image200,private immutable1yr; lease held | `server/http/routes/postImage.ts:5` |
| GET | /api/posts/images/:id/thumb | U + conversation read | Image id | Image200,wait for thumbnail; same caching; not-ready error | `server/http/routes/postImage.ts:5` |
| GET | /api/media/tracks/:id/audio | Stream grant | ?grant,single Range | Live chunked audio/webm no-store or cached200/206 immutable;416 invalid | `server/http/routes/mediaAudio.ts:11` |
| GET | /api/media/tracks/:id/cover | U+media + track capability | token,capability? | Wait≤60s for image,private immutable1yr,lease | `server/http/routes/mediaCover.ts:7` |
| POST | /api/admin/system/deploy | O | Multipart ZIP≤512MiB | 202 staged result;413 oversize; reads bytes before facade auth | `server/http/routes/deploy.ts:4` |
| GET | /api/admin/system/backups/:name | O | Filename | ZIP attachment/length, no explicit cache policy | `server/http/routes/backupDownload.ts:4` |
| GET | /api/admin/teach-documents/:id/download | OA | Document id | Original Office attachment,UTF8 name,no-store | `server/http/routes/teachDocumentDownload.ts:5` |
| GET | /api/admin/incidents/logs | O | None | Current-build diagnostic ZIP attachment,no-store | `server/http/routes/incidentLogsDownload.ts:4` |
| GET | / | Public | None | Stable shell,no-store,max-age0 | `server/http/handler.ts:230` |
| GET | /service-worker.js | Public | None | Generated JS,no-cache/must-revalidate,Service-Worker-Allowed:/ | `server/http/handler.ts:230` |
| GET | /manifest.webmanifest | Public | None | PWA manifest,no-cache | `server/http/handler.ts:230` |
| GET | /app/manifest.json | Public | None | Build/shell/bundle manifest,no-store | `server/http/handler.ts:230` |
| GET | /app/app.js, /app/shell.html | Public | None | Runtime assets,immutable1yr | `server/http/handler.ts:230` |
| GET | Public asset path | Public | Safe contained path | Static file,immutable1yr; unmatched404 JSON | `server/http/handler.ts:402` |
| GET/HEAD | /client-lzysso/h5-sso | Public | None | 301 to /,ten-year immutable redirect | `server/http/handler.ts:192` |
| GET/HEAD | HTTP / when enabled | Public | HTTP origin | 301 configured HTTPS domain/first secure port; ten-year cache | `server/http/handler.ts:192` |
| OPTIONS | Any path | Public | CORS preflight | 204; same-hostname cross-port origin allowance | `server/http/handler.ts:161` |
| Upgrade GET | /ws | Per-user token binding | JSON protocol v3 | OneShot responses and user-targeted events | `server/protocol/WebSocketProtocol.ts:33`, `shared/protocol/wire.ts:6` |

### 5.3 Named OneShot API contract

All rows below have transport **WS /ws**, JSON `request.action`, positional `args` array. Object fields below are the sole object argument unless stated scalar/none.
Response notation `OK` means `{ok:true}` domain result inside transport success; transport errors use §6 envelope. IDs are strings unless the schema explicitly says UUID/integer.
Auth policies are established by `server/domain/facade/{users,groups,administration,articles,posts,media,ai,words,authentication,conversations,incidents,versionedUserConfig,notificationConfig,stickers,announcement,app}.ts:1` and AuthorityService.
All booklist operations additionally require articles; all playlist operations require media. Static shell/asset handler branches are intended for GET but do not explicitly restrict method. (`server/http/handler.ts:230`)
Table evidence cites the authoritative input/output Zod declarations in `shared/protocol/actions.ts`; this prevents inventing REST endpoints for these operations.

| Action | Auth / policy | Request | Response / purpose | Schema citation |
|---|---|---|---|---|
| adminFetchUsersAction | Admin user-list roles | q?,offset? | users,total | `shared/protocol/actions.ts:259` |
| adminCreateUserAction | AM; F if custom gates | ghost?,handle?,username?,pin?,features? | user or pin+ghost_id | `shared/protocol/actions.ts:271` |
| adminMutateUsersAction | Per-field R/F/CM/ACM | changes1..500: userId,profile/features/roles/PIN/restrictions/removal | OK; purge/deactivate distinguished | `shared/protocol/actions.ts:286` |
| adminFetchAuditLogAction | R | offset? | entries,users | `shared/protocol/actions.ts:311` |
| adminFetchGhostUsersAction | AM | none | ghosts | `shared/protocol/actions.ts:318` |
| adminDeleteGhostUserAction | AM | scalar id | OK | `shared/protocol/actions.ts:322` |
| adminFetchGroupsAction | CM | offset? | groups,total | `shared/protocol/actions.ts:323` |
| adminCreateGroupAction | CM | group-create fields | group | `shared/protocol/actions.ts:332` |
| adminMutateGroupsAction | ACM for edit/member/delete | changes1..500: groupId,fields,memberAction?,userId?,delete? | OK | `shared/protocol/actions.ts:336` |
| adminFetchClientsAction | AM | q?,offset? | clients,users,total | `shared/protocol/actions.ts:364` |
| adminMutateClientsAction | AM | changes1..500: id,promote?,locked?,remark≤100?,whitelisted?,bound_user_id?,delete? | OK | `shared/protocol/actions.ts:377` |
| adminWhitelistCurrentClientAction | AM | none | OK,client_id | `shared/protocol/actions.ts:398` |
| adminFetchConfigAction | Relevant admin config roles | none | config | `shared/protocol/actions.ts:402` |
| adminUpdateConfigAction | Field-specific O/OA/AM/ACM | lock/whitelist/identity/announcement/cloud/HTTPS fields | OK,config; announcement≤10000,URL≤2048 | `shared/protocol/actions.ts:403` |
| fetchAnnouncementAction | U | none | announcement | `shared/protocol/actions.ts:422` |
| acknowledgeAnnouncementAction | U | scalar revision≥0 | OK,acknowledged | `shared/protocol/actions.ts:423` |
| adminFetchBackupsAction | O | none | backups | `shared/protocol/actions.ts:427` |
| adminCreateBackupAction | O | none | OK,backups | `shared/protocol/actions.ts:431` |
| adminDeleteBackupAction | O | scalar name | OK | `shared/protocol/actions.ts:435` |
| adminFetchUpdateStatusAction | O | none | update status | `shared/protocol/actions.ts:436` |
| adminCheckCloudUpdateAction | O | none | build_id,update_available | `shared/protocol/actions.ts:437` |
| adminInstallCloudUpdateAction | O | none | OK,message | `shared/protocol/actions.ts:441` |
| adminFetchHttpsStatusAction | O | none | HTTPS/cert status | `shared/protocol/actions.ts:445` |
| adminConfirmUpdateAction | O | none | OK | `shared/protocol/actions.ts:446` |
| adminRollbackAction | O | none | OK,message | `shared/protocol/actions.ts:447` |
| adminRunToolAction | OA | scalar kill-wps or shutdown | OK,message | `shared/protocol/actions.ts:451` |
| adminFetchTeachDocumentsAction | OA | none | documents,monitor_available | `shared/protocol/actions.ts:455` |
| adminCleanupTeachDocumentsAction | OA | none | OK,deleted count | `shared/protocol/actions.ts:462` |
| adminFetchIncidentGroupsAction | O | environment?,buildId?,offset? | groups | `shared/protocol/actions.ts:466` |
| adminFetchIncidentDetailsAction | O | scalar positive group integer | incidents | `shared/protocol/actions.ts:476` |
| adminTestIncidentAction | O | none | Declared OK, deliberately throws | `shared/protocol/actions.ts:480` |
| reportClientIncidentAction | Anonymous allowed; current identity captured | buildId≤256,errorName≤200,message≤4000,stack≤32000,operation≤256,operationId hex24,relatedIDs≤32 | incidentId | `shared/protocol/actions.ts:482` |
| probeAppStateAction | Current client/session context | touch? | app state | `shared/protocol/actions.ts:497` |
| getClientMeAction | Client identity context | none | client_id/null,ip,client_invalid? | `shared/protocol/actions.ts:501` |
| patchClientMeAction | Current client admission | scalar lock boolean | OK+konami_locked or client_invalid/access_required | `shared/protocol/actions.ts:509` |
| autoLoginAction | Current device/session eligibility | none | user/null,token?,lock,ban details? | `shared/protocol/actions.ts:522` |
| loginPinAction | Device admission/throttle | scalar six-digit PIN | user+token / OOBE token / banned / error | `shared/protocol/actions.ts:533` |
| completeOobeAction | Valid invitation token | oobe_token,handle1..20,username1..30,new_pins1..2 | user+token or error | `shared/protocol/actions.ts:546` |
| logoutAction | Current session | none | OK | `shared/protocol/actions.ts:563` |
| updateMeAction | U; current PIN for reset | handle?,username?,resetPins? | OK or user | `shared/protocol/actions.ts:564` |
| listArticlesAction | U+articles | view all/bookmarked/recent?,cursor sortAt/id?,direction?,group_id? | articles,users,hasMore | `shared/protocol/actions.ts:578` |
| fetchArticleSidebarAction | U+articles | none | sidebar | `shared/protocol/actions.ts:596` |
| createArticleAction | U+articles+article_reader,group-booklist write | title,content,group_id nonempty | article,users,capability | `shared/protocol/actions.ts:597` |
| searchNetworkArticlesAction | U+articles+article_download | query | ready+results or busy+retry_after_ms+ready_at | `shared/protocol/actions.ts:611` |
| startNetworkArticleDownloadAction | U+article_download+article_reader + target write | book_id,title?,group_id | task | `shared/protocol/actions.ts:625` |
| listNetworkArticleDownloadsAction | U+article_download | none | own tasks | `shared/protocol/actions.ts:635` |
| articlesLibraryAction | U+articles | none | recents,favorites,booklists,users | `shared/protocol/actions.ts:639` |
| booklistListAction | U+articles | none | accessible booklists | `shared/protocol/actions.ts:648` |
| booklistFetchAction | Collection read | scalar id | snapshot | `shared/protocol/actions.ts:652` |
| booklistForGroupAction | Group access | {groupId} | snapshot/null | `shared/protocol/actions.ts:653` |
| booklistCreateAction | U+articles | title1..80 | snapshot | `shared/protocol/actions.ts:657` |
| booklistDeleteAction | Collection own | scalar id | OK | `shared/protocol/actions.ts:661` |
| booklistAddArticleAction | Collection write + article capability | booklistId,articleId,capability? | snapshot | `shared/protocol/actions.ts:662` |
| booklistRemoveArticleAction | Collection write | booklistId,articleId | snapshot | `shared/protocol/actions.ts:672` |
| booklistGrantAccessAction | Issuable requested grant | booklistId,principal,grant | snapshot | `shared/protocol/actions.ts:681` |
| booklistRevokeAccessAction | Collection own | booklistId,principal | snapshot | `shared/protocol/actions.ts:691` |
| booklistListBindingsAction | Collection read | booklistId | bindings | `shared/protocol/actions.ts:700` |
| fetchArticleAction | U+articles+kind-specific reader + capability/recovery | articleId,capability? | article,users | `shared/protocol/actions.ts:704` |
| fetchArticleSegmentAction | Text-reader entitlement + article read | articleId,offset≥0,capability? | content,offset,has_more,content_length | `shared/protocol/actions.ts:716` |
| openArticleBundleAction | Ebook entitlement + article read | articleId,cursor:null/integer≥0,before0..32,after1..64,capability? | bundleSlice | `shared/protocol/actions.ts:731`, `shared/bundles/protocol.ts:56` |
| fetchArticleBundleItemsAction | Same | articleId,cursor integer≥0,direction before/after,limit1..64,capability? | bundleSlice | `shared/protocol/actions.ts:735`, `shared/bundles/protocol.ts:56` |
| setArticleBookmarkAction | Article read | articleId,bookmarked,updatedAt,capability? | versioned boolean | `shared/protocol/actions.ts:739` |
| saveArticleProgressAction | Article read | articleId,offset,updatedAt,merge override/furthest,capability? | offset,updatedAt | `shared/protocol/actions.ts:750` |
| reportArticleReadingAction | Article read | articleId,seconds≥0,active,capability? | OK | `shared/protocol/actions.ts:762` |
| deleteArticleAction | Author/CM + articles + read capability | articleId,capability? | OK | `shared/protocol/actions.ts:773` |
| fetchConversationsAction | U | none | entries,users | `shared/protocol/actions.ts:783` |
| fetchConversationRevisionsAction | U | none | conv_id,revision,revision_sum decimal-string tuples | `shared/protocol/actions.ts:790` |
| markConversationReadAction | Conversation read | conv ref,post_id,updatedAt,merge override/furthest | postId/null,sequence,updatedAt | `shared/protocol/actions.ts:802` |
| setConversationPinnedAction | Conversation access | conv ref,pinned,updatedAt | versioned boolean | `shared/protocol/actions.ts:818` |
| setConversationMutedAction | Conversation access | conv ref,muted,updatedAt | versioned boolean | `shared/protocol/actions.ts:826` |
| fetchConversationDraftAction | Conversation access | conv ref | draft,updatedAt | `shared/protocol/actions.ts:834` |
| saveConversationDraftAction | Conversation access | conv ref,draft,updatedAt | draft,updatedAt | `shared/protocol/actions.ts:838` |
| createGroupAction | U | groupCreateInput | group | `shared/protocol/actions.ts:847` |
| discoverGroupsAction | U | query? | sections | `shared/protocol/actions.ts:851` |
| discoverSubgroupsAction | U with parent access | groupId,query? | groups | `shared/protocol/actions.ts:855` |
| joinGroupAction | U + discovery/password policy | groupId,source search/group,password? | OK+group or error+needs_password | `shared/protocol/actions.ts:859` |
| leaveGroupAction | Member, leave allowed | scalar id | OK | `shared/protocol/actions.ts:879` |
| fetchGroupMembersAction | Member/moderator | scalar id | members,users,hidden,no_leave,self_hide_self | `shared/protocol/actions.ts:880` |
| patchMyGroupMembershipAction | Member | groupId,hide_self | OK,hide_self | `shared/protocol/actions.ts:890` |
| fetchNotificationConfigAction | U | none | doNotDisturb | `shared/protocol/actions.ts:895` |
| updateDoNotDisturbAction | U | {enabled} | doNotDisturb | `shared/protocol/actions.ts:899` |
| fetchPostsAction | U + feed/conversation access | type?,conv_id?,ID/sequence cursors?,revision bounds?,limit/offset strings? | posts,users | `shared/protocol/actions.ts:904` |
| fetchPostAction | Post read | scalar id | post,users | `shared/protocol/actions.ts:921` |
| createPostAction | Conversation posting authority | content string/payload?,conv_id,reply_to? | post,users | `shared/protocol/actions.ts:925` |
| updatePostAction | Author text-edit rights | postId,text | post,users | `shared/protocol/actions.ts:935` |
| deletePostAction | Author/CM | scalar id | post,users | `shared/protocol/actions.ts:939` |
| fetchStickerPacksAction | Public | none | packs | `shared/protocol/actions.ts:944` |
| fetchStickerPackAction | Public | scalar id | pack | `shared/protocol/actions.ts:948` |
| fetchRecentStickersAction | U | none | recent | `shared/protocol/actions.ts:952` |
| touchRecentStickerAction | U | pack,id | recent | `shared/protocol/actions.ts:956` |
| sendStickerPostAction | Post permission | content?,conv_id,reply_to? | post,users | `shared/protocol/actions.ts:960` |
| fetchVersionedUserConfigAction | U | {keys: string[]} | key→version record | `shared/protocol/actions.ts:971` |
| patchVersionedUserConfigAction | U; no server key allowlist | key,value string,updatedAt | version | `shared/protocol/actions.ts:975` |
| fetchWordStatsAction | U+learning | timezoneOffset? | stats | `shared/protocol/actions.ts:982` |
| fetchNextWordAction | U+learning | none | quiz | `shared/protocol/actions.ts:986` |
| fetchNextWrongWordAction | U+learning | none | quiz | `shared/protocol/actions.ts:987` |
| fetchSelfDisciplineWordAction | U+learning | none | quiz | `shared/protocol/actions.ts:988` |
| recordWordPracticeAction | U+learning | wordId,correct,mastered? | progress | `shared/protocol/actions.ts:989` |
| fetchWrongWordsAction | U+learning | offset?,limit? | words,total | `shared/protocol/actions.ts:999` |
| fetchMasteredWordsAction | U+learning | offset?,limit? | words,total | `shared/protocol/actions.ts:1011` |
| importWordsAction | F | {text} | imported count | `shared/protocol/actions.ts:1023` |
| fetchSelfDisciplineModeAction | U+learning | none | enabled | `shared/protocol/actions.ts:1027` |
| updateSelfDisciplineModeAction | U+learning | {enabled} | enabled | `shared/protocol/actions.ts:1031` |
| adminFetchSelfDisciplineModeAction | F | {userId} | enabled | `shared/protocol/actions.ts:1035` |
| adminUpdateSelfDisciplineModeAction | F | userId,enabled | enabled | `shared/protocol/actions.ts:1039` |
| fetchAiSidebarAction | U+ai | none | conversations,credits,status | `shared/protocol/actions.ts:1043` |
| fetchAiConversationAction | U+ai, own conversation | {conversationId: UUID} | detail | `shared/protocol/actions.ts:1054` |
| searchAiConversationsAction | U+ai | query≤500 | conversations | `shared/protocol/actions.ts:1058` |
| startAiRunAction | U+ai,own conversation,credits | conversationId?,content1..100000,images≤4{name≤200,mime,data≤7000000},forkFromMessageId? | started / insufficient_credits / busy / unavailable | `shared/protocol/actions.ts:1062` |
| cancelAiRunAction | Own run | {runId} | cancelled | `shared/protocol/actions.ts:1100` |
| markAiConversationReadAction | Own conversation | {conversationId} | OK | `shared/protocol/actions.ts:1104` |
| adminFetchAiCreditsAction | F | {userId} | credits,ledger | `shared/protocol/actions.ts:1108` |
| adminFetchAiBillingAction | F | none | summary | `shared/protocol/actions.ts:1115` |
| adminUpdateAiBillingPolicyAction | F | daily/weekly allowance0..1e9,default days1..3650 | policy | `shared/protocol/actions.ts:1116` |
| adminAssignAiCreditsAction | F | targets1..500{userId,idempotencyKey UUID},days?,amount1..1e9?,note≤200 | OK | `shared/protocol/actions.ts:1126` |
| mediaSearchAction | U+media | query,limit1..50? | signed tracks | `shared/protocol/actions.ts:1147` |
| mediaEnsureTrackAction | U+media | source,providerId,canonicalUrl? | track,capability | `shared/protocol/actions.ts:1156` |
| mediaFetchQueueAction | U+media | none | own queue | `shared/protocol/actions.ts:1166` |
| mediaAddToQueueAction | U+media + track read | trackId,capability? | queue | `shared/protocol/actions.ts:1167` |
| mediaRemoveFromQueueAction | U+media | {trackId} | queue | `shared/protocol/actions.ts:1176` |
| mediaClearQueueAction | U+media | none | queue | `shared/protocol/actions.ts:1180` |
| mediaPlayAction | U+media + track read | trackId,capability? | grant_token,url,expires_at | `shared/protocol/actions.ts:1181` |
| mediaListPlaylistsAction | U+media | none | playlists | `shared/protocol/actions.ts:1194` |
| mediaFetchPlaylistAction | Playlist read | scalar id | snapshot | `shared/protocol/actions.ts:1198` |
| mediaCreatePlaylistAction | U+media | title1..80 | snapshot | `shared/protocol/actions.ts:1202` |
| mediaDeletePlaylistAction | Playlist own | scalar id | OK | `shared/protocol/actions.ts:1206` |
| mediaAddToPlaylistAction | Playlist write + track read | playlistId,trackId,capability? | snapshot | `shared/protocol/actions.ts:1207` |
| mediaRemoveFromPlaylistAction | Playlist write | playlistId,trackId | snapshot | `shared/protocol/actions.ts:1217` |
| mediaUpdatePlaylistRetentionAction | Playlist write | playlistId,days1..365 | snapshot | `shared/protocol/actions.ts:1226` |
| mediaGrantPlaylistAccessAction | Issuable requested grant | playlistId,principal,grant | snapshot | `shared/protocol/actions.ts:1235` |
| mediaRevokePlaylistAccessAction | Playlist own | playlistId,principal | snapshot | `shared/protocol/actions.ts:1245` |
| mediaListPlaylistBindingsAction | Playlist read | playlistId | bindings | `shared/protocol/actions.ts:1254` |
| mediaLibraryAction | U+media | none | recents,favorites,playlists | `shared/protocol/actions.ts:1258` |
| mediaSetTrackFavoriteAction | U+media + track read | trackId,favorited,updatedAt,capability? | versioned boolean | `shared/protocol/actions.ts:1266` |
| mediaFetchConfigAction | U+media | none | media config | `shared/protocol/actions.ts:1277` |
| mediaAdminUpdateConfigAction | CM | max_volume0..1?,eviction_days1..3650?,storage_limit_bytes1..2^48? | config | `shared/protocol/actions.ts:1278` |

Action-adapter file coverage: `server/actions/_base.ts:4`, `server/actions/admin.ts:26`, `server/actions/ai.ts:1`, `server/actions/announcement.ts:1`, `server/actions/app.ts:1`, `server/actions/articles.ts:1`, `server/actions/auth.ts:1`, `server/actions/conversations.ts:1`.
Remaining adapter coverage: `server/actions/groups.ts:1`, `server/actions/incidents.ts:1`, `server/actions/media.ts:1`, `server/actions/notification-config.ts:1`, `server/actions/posts.ts:1`, `server/actions/stickers.ts:1`, `server/actions/user-config.ts:1`, `server/actions/words.ts:1`.

### 5.4 Jobs, observability and failure handling

- Maintenance starts immediately then every60s: expire sessions, remove nonpersistent inactive clients after one day if no active session, publish idle lock after five minutes when enabled, reconcile temporary storage/media/uploads/images/AI. No overlapping-run guard. (`server/services/maintenance.ts:22`, `server/data/maintenance.ts:3`)
- PDF import stays attached to upload request; novel downloads are in-memory background tasks; AI and workspace publication have durable recovery rows. These are different recovery guarantees. (`server/http/routes/articleUpload.ts:36`, `server/runtime/articleImportRuntime.ts:50`, `server/runtime/aiExecutionRuntime.ts:1`)
- Incident fingerprint SHA256(environment NUL build NUL topFrame); source maps symbolize; message4000/stack32000/context16000/related32 bounded; first ten/group retain full detail, every occurrence gets row/public ID. (`server/services/incidentService.ts:16`, `server/data/incidents.ts:54`)
- Local incident logs/audit are operational telemetry; no third-party analytics SDK found in package dependencies. AI/media/novel providers do receive their required upstream requests (§11). (`package.json:35`, `server/services/incidentLogArchiveService.ts:1`)
- Normal logs go to inherited console/stdout/stderr, including first-run admin PIN (value intentionally omitted); incidents persist DB/build identity. (`server/infra/db.ts:1751`, `launcher/launcher.ts:290`)
- Public/domain errors and contract failures are encoded centrally; input and output validation catches adapter/result drift. (`server/protocol/errorCodec.ts:1`, `server/protocol/registry.ts:54`)

## 6. Transport and API contract

- Main application API is typed OneShot request/response over a persistent WebSocket, plus unsolicited events; raw HTTP handles multipart uploads, byte streams, runtime assets and downloads. (`server/protocol/WebSocketProtocol.ts:33`, `server/http/handler.ts:275`)
- Wire version is integer3; server hello `{v,kind:'hello',buildId}`; authenticate `{v,kind:'authenticate',user,token}`. User binding is independent of physical socket. (`shared/protocol/wire.ts:6`, `server/protocol/WebSocketProtocol.ts:83`)
- Request `{v,kind:'request',id,user:null|string,action,args}`: id/action length1..128, args array≤8. Response `{v,kind:'response',id,user,result:{ok:true,data}|{ok:false,error}}`. (`shared/protocol/wire.ts:6`)
- Event `{v,kind:'event',user,event,data}` is validated by shared schemas; per-user routing prevents presentation mixing; server event bus is in-memory, not durable replay log. (`shared/protocol/events.ts:1`, `server/runtime/eventBus.ts:100`)
- Serialization is JSON.stringify/parse, strict Zod wire/action inputs and action outputs; revision sums use decimal strings to preserve precision. No application MessagePack/protobuf transport. (`server/protocol/registry.ts:54`, `shared/protocol/actions.ts:790`)
- Invalid JSON closes1003; structurally invalid frames close1008; no explicit permessageDeflate option in WebSocketServer construction, and zstd is not general RPC compression. (`server/protocol/WebSocketProtocol.ts:33`, `server/protocol/WebSocketProtocol.ts:225`)
- Ordinary endpoint bodies use UTF-8 JSON; images in AI requests are base64 strings, whereas image/PDF upload uses multipart file bytes. (`shared/protocol/actions.ts:1062`, `server/http/routes/postImageUpload.ts:7`)
- Bundle metadata travels via OneShot; resource bytes travel by POST stream, preserving native Zstd compression. `lib/zstd-web` decompresses those document resources in browser WASM. (`client/interact/bundles.ts:29`, `server/http/routes/articleBundleResources.ts:11`)
- Bundle stream format: 12-byte header ASCII `CABSTRM1`, uint16LE version1,count; each record raw-hash32 bytes, uint32LE stored size, then stored body. (`shared/bundles/protocol.ts:4`, `server/http/routes/articleBundleResources.ts:13`)
- Client verifies record order/hash ID/declared sizes/count/trailing bytes; decoded resource SHA256 must match content ID. Corrupt local resource deletes/refetches once online. (`client/interact/bundles.ts:314`, `client/interact/bundles.ts:492`)
- PDF source and completed audio accept one byte range, including Content-Range/Accept-Ranges; malformed or unsatisfiable range returns416. Live audio prefix probes differ from mid-file/suffix requests, which wait up to120s for completion. (`server/http/routes/articleSource.ts:8`, `server/http/routes/mediaAudio.ts:11`)
- Same-hostname cross-port CORS allows Authorization/Content-Type/Range, exposes range/length headers, methods GET/POST/OPTIONS. It is not the authorization mechanism. (`server/http/handler.ts:161`)
- HTTP helpers honor x-forwarded-proto without the explicit IP trust filter used for x-forwarded-for; deployment assumes controlled proxy topology. (`server/http/handler.ts:44`, `server/infra/endpoints.ts:13`)
- `/api/endpoints` origins are fetched once; apiFetch round-robins origins, static assets use stable character-sum origin hash; fallback page origin; WS always page origin with ws/wss matching page scheme. (`client/lib/loadBalancer.ts:15`, `client/interact/remote/transport.ts:115`)
- Client socket connect timeout5s and reconnect cooldown5s; forced-offline debug state stops connectivity; active user heartbeat every2min probes app state and flushes pending settings. (`client/interact/remote/transport.ts:11`, `client/interact/remoteLifecycle.ts:348`)
- Reconnect retries connectivity and re-establishes bindings; it does not blindly replay failed post creation. Pending Assignments are reconciled separately using timestamp/operation identity. (`client/interact/remoteLifecycle.ts:79`, `client/interact/sync.ts:183`)
- Cache headers: shell/manifest and streamed bundle/live audio no-store; SW/manifest.webmanifest revalidate; build assets/public assets immutable1yr; authorized source/images/completed music private immutable1yr. (`server/http/handler.ts:230`, `server/http/routes/mediaAudio.ts:11`)
- Build identity is versioning for launcher/server/client/shell/SW; wire version3, bundle protocol1, app semantic IDB5, DB28 are separate compatibility domains. (`shared/protocol/wire.ts:6`, `shared/bundles/protocol.ts:4`, `client/data/schema.ts:1`, `server/infra/db.ts:982`)
- Error contract is not uniform HTTP status semantics: domain denial often becomes500 with incident ID, whereas login/join can return explicit domain failure unions inside successful RPC envelope. (`server/http/errorResponse.ts:10`, `shared/protocol/actions.ts:533`, `shared/protocol/actions.ts:859`)
- Native/render errors are translated to Chinese public messages; diagnostics retain bounded stderr/incident context rather than expose arbitrary server stack. (`server/infra/pdfRenderProcess.ts:68`, `server/protocol/errorCodec.ts:1`)

Server event catalog (recovery consumes these after snapshots; event names are part of the rewrite compatibility inventory):

| Events | Payload / purpose | Evidence |
|---|---|---|
| post.created,post.updated,post.deleted,conv.updated | Post/revision/tombstone or conversation projection changes. | `shared/protocol/events.ts:26`, `shared/types/events/conversations.ts:1` |
| client.lock_changed,client.deleted,client.idle_locked | konami_locked boolean or empty invalidation/idle signal. | `shared/protocol/events.ts:30` |
| user.banned,user.unbanned,user.muted_changed,user.profile_changed | banned_until,empty unban,is_muted/muted_until,or full user projection. | `shared/protocol/events.ts:33` |
| system.lock_changed,system.announcement_changed | Optional idle/system lock flags or announcement revision. | `shared/protocol/events.ts:42` |
| article.created,article.deleted | article_id and nullable group_id. | `shared/protocol/events.ts:51` |
| article.bookmark_changed,article.reading_changed | Article/user identifiers,bookmark boolean for bookmark change. | `shared/protocol/events.ts:63` |
| article.sidebar_updated,article.list_updated,user.config_changed | Projection/list invalidation or versioned configuration update. | `shared/protocol/events.ts:76` |
| ai.run.updated,ai.sidebar.updated | Run/conversation streaming projection and sidebar/credit refresh. | `shared/protocol/events.ts:79`, `shared/types/events/ai.ts:1` |
| media.track.changed,media.playlist.changed,media.queue.changed,media.config.changed,media.materialization.changed | Track/list/queue/config/asset-state change signals. | `shared/protocol/events.ts:81` |
| remote.resubscribe,remote.hello | reason / buildId; hello is client-side contract event synthesized from wire hello. | `shared/protocol/events.ts:86` |

Authentication reply is `{v,kind:'authenticated',user:claimedUserId,result:{ok:true}|{ok:false,error}}`; failed binding does not silently authenticate. (`server/protocol/WebSocketProtocol.ts:62`)
The application sets no explicit maxPayload in WebSocketServer; manual large text limits therefore also depend on ws runtime defaults,not a documented application transport constant. (`server/protocol/WebSocketProtocol.ts:237`)

## 7. Document / PDF pipeline

### 7.1 Import and publication

1. UI accepts TXT/PDF; PDF MIME OR filename extension chooses multipart path; text bytes use fatal UTF-8 then GBK fallback, trim; attachment clears textarea and supplies default filename title. (`client/components/articles/ArticleImportFab.tsx:70`, `client/lib/textEncoding.ts:14`)
2. HTTP requires multipart file+group_id; nonmultipart returns410 with instruction to use text OneShot; missing fields400; declared length above200MiB+1MiB413. (`server/http/routes/articleUpload.ts:8`)
3. Facade authorizes articles+ebook_reader and writable group booklist before rendering. Source must be nonempty and≤200MiB; MIME/extension accepted, no initial PDF magic sniff. (`server/domain/facade/articles.ts:228`, `server/services/articlesService.ts:104`, `server/services/articlesService.ts:242`)
4. Allocate separate source/archive BlobStore slots and UUID upload intent before streaming. Commit source, run renderer into archive staging, validate archive, commit archive, transactionally publish article and claim intent. (`server/services/articlesService.ts:250`)
5. Source pool durable; archive reconstructible cache; article provider stores blob IDs, source MIME/size, archive size and page count. (`server/services/articlesService.ts:250`)
6. Failure compensation discards slots/drops committed blobs/releases quota/abandons intent; final-insertion failure also compensated by HTTP adapter. (`server/services/articlesService.ts:293`, `server/http/routes/articleUpload.ts:53`)
7. Stale upload intents older30min drop source/archive and quota. This equals renderer execution timeout but excludes time spent waiting for renderer slot, creating a timing risk. (`server/runtime/articleUploadRuntime.ts:15`, `server/infra/pdfRenderProcess.ts:7`)
8. Upload is not resumable and render is not a detached durable job; client task UI observes a request-scoped operation. (`server/http/routes/articleUpload.ts:36`, `client/components/articles/ArticleImportFab.tsx:101`)

### 7.2 Native invocation, layout and resource generation

Exact application command (array arguments, no shell):

```text
<resolved-pdfrender> --resolution 96 --webp-quality 80 --jobs N <sourcePath> <outputPath>
N = max(1, min(4, ceil(availableParallelism() / 2)))
```

- Application invokes only this custom `pdfrender`, not pdfinfo/pdftoppm/pdftotext. cwd=source directory, windowsHide=true, stdin/stdout ignored, stderr piped, renderer environment merged. (`server/infra/pdfRenderProcess.ts:43`)
- FIFO semaphore permits two children in this module/process; wait queue unbounded and uncancelled; started child timeout30min→SIGKILL; finally releases slot. Normal article upload executes on coordinator, so cap is shared for that path, not a universal cross-process lock. (`server/infra/pdfRenderProcess.ts:7`, `server/http/routes/articleUpload.ts:36`)
- Stderr retains approximately last64K string units despite BYTES constant naming; launch error “无法启动文档渲染器”, nonzero exit “文档渲染失败”. (`server/infra/pdfRenderProcess.ts:68`)
- Native CLI supports page range,DPI36..600,WebP quality0..100,jobs1..256,owner/user passwords; app passes neither passwords nor page range and always renders all pages at96DPI. (`lib/poppler/utils/pdfrender.cc:190`, `lib/poppler/utils/pdfrender.cc:254`)
- Bad PDF/copy-prohibited PDF/zero pages exit1; invalid args exit2. Password-protected document UX is rejection, not a password prompt. (`lib/poppler/utils/pdfrender.cc:972`)
- Render consists of positioned selectable HTML words over Cairo SVG graphics. Text generally suppressed in SVG; math-font heuristic preserves SVG glyphs with transparent selectable HTML; Type3 glyph programs kept in SVG without duplicate HTML. (`lib/poppler/utils/pdfrender.cc:55`, `lib/poppler/utils/pdfrender.cc:818`)
- Paragraph recovery groups visual lines then nearby horizontally aligned lines; font fallback Arial/Times/Consolas/math families; browser fit script measures word ranges and clamps horizontal scale .5..2. (`lib/poppler/utils/pdfrender.cc:439`, `lib/poppler/utils/pdfrender.cc:917`)
- SVG white background, scale96/72; embedded PNG/JPEG data URIs converted to WebP quality80; dependencies replaced by content references and SVG IDs normalized. (`lib/poppler/utils/pdfrender.cc:715`)
- There is no raster tile pyramid, native page-thumbnail pass, separate outline extraction, OCR, ink, or annotation pipeline in this path. Output comprises pages/shared CSS+JS/HTML/graphics dependencies. (`lib/poppler/utils/pdfrender.cc:1090`, `client/components/articles/BundleArticleReader.tsx:347`)
- Native jthread count=min(pageCount,requestedJobs); independently opened PDFDoc per worker, atomic page allocation, shared failure flag and resource-spool mutex; any page failure prevents final archive publication. (`lib/poppler/utils/pdfrender.cc:1012`)
- Page id=`page:<one-based-source-page>`; ordinal contiguous zero-based; dimensions ceil(mediaBox×96/72). (`lib/poppler/utils/pdfrender.cc:1071`)
- Spool under OS temp `pdfrender-<steadyClock>-<random>` bounds active-page memory; destructor removes it. SIGKILL bypasses destructor, so timed-out runs may leave OS-temp debris (inference). (`lib/poppler/utils/PdfRenderBundle.cc:325`, `server/infra/pdfRenderProcess.ts:68`)

### 7.3 Archive, hashing, compression and delivery

- Output ZIP64 uses ZIP STORED members: manifest.json, optional dictionary.zdict, objects/<sha256>[.zst]; content ID hashes raw bytes. (`lib/poppler/utils/PdfRenderBundle.cc:133`, `lib/poppler/utils/PdfRenderBundle.cc:449`)
- Raw-byte hash deduplicates within one archive; same bytes claimed with different MIME rejected. This is distinct from UUID-addressed server BlobStore. (`lib/poppler/utils/PdfRenderBundle.cc:340`, `server/storage/paths.ts:3`)
- Binary resources identity-encoded; text/* Zstd level8; dictionary train only≥4 samples and≥4096 bytes, sample≤128KiB,total≤8MiB,dictionary min64KiB/max1KiB-or-samples/8; training failure falls back plain Zstd. (`lib/poppler/utils/PdfRenderBundle.cc:21`, `lib/poppler/utils/PdfRenderBundle.cc:399`)
- Semantic files include assets/<hash>.<extension>,page HTML,style.css,pdfrender.js; manifest stores encoding,raw/stored sizes,hashes,stored offsets,page dependencies. (`lib/poppler/utils/PdfRenderBundle.cc:340`, `lib/poppler/utils/pdfrender.cc:954`)
- Server manifest validation: strict v1,max32MiB manifest,200k resources,512MiB/resource,1MiB dictionary,4096 shared/deps; allowed entries/STORED/no descriptors; no duplicate names. (`server/storage/renderArchive.ts:14`, `server/storage/renderArchive.ts:105`)
- Also validates reference existence,page IDs/ordinals uniqueness and contiguity,dictionary agreement,semantic path traversal. (`server/storage/renderArchive.ts:276`)
- Limitation: declared offset+size checked against archive bounds and resource name/size against entries; actual ZIP payload offset is not compared, despite renderer docs requiring it. (`server/storage/renderArchive.ts:228`, `lib/poppler/utils/pdfrender.md:133`)
- Archive index promise cached per immutable blob ID; failures evict cache; warm resources read byte ranges without extracting all files; deletion drops index. (`server/storage/renderArchive.ts:389`, `server/services/articlesService.ts:579`)
- Metadata open max before32/after64; subsequent fetch max64; metadata references immutable content IDs. (`shared/bundles/protocol.ts:56`, `server/services/articlesService.ts:409`)
- Binary resources accepts1..64 unique IDs, max513MiB framed bytes; opens ranges lazily and streams unchanged stored encoding; protocol header described in §6. (`server/http/routes/articleBundleResources.ts:11`)
- Client typically batches≤128MiB and≤64 resources, writes≤256KiB chunks into IDB extents; per-article promise tails serialize catalog/resource changes. (`client/interact/bundles.ts:39`, `client/interact/bundles.ts:252`)
- First visible page+shared+dictionary prioritized, remaining slice prefetch scheduled at zero delay; initial window4 before/target/6 after, later12 each direction. (`client/interact/bundles.ts:386`, `client/interact/bundles.ts:437`)
- Local stored-size check finds absent resources; decompression checks expected raw size and SHA256; corrupt bytes removed and retried once online; quota recovery allows up to three missing-resource attempts. (`client/interact/bundles.ts:346`, `client/interact/bundles.ts:492`)
- Full offline retention walks entire catalog and ensures all resources; completeness requires contiguous ordinal coverage; purging cancels prefetch and deletes article file prefix. (`client/interact/bundles.ts:611`)

### 7.4 PDF viewer behavior and memory

- Fit-width scale=min(availableWidth,intrinsicWidth)/intrinsicWidth,24px page gaps,white shadowed pages on grey background; ResizeObserver recalculates; no dedicated zoom/pan/page-turn toolbar. (`client/components/articles/BundleArticleReader.tsx:24`)
- Vertical Infini virtualization: clamped saved ordinal,estimated900px width,8% visible anchor,layout buffer300,rendered InfiniView buffer8000. Debounce progress1500ms and flush last visible ordinal on unmount. (`client/components/articles/BundleArticleReader.tsx:198`, `client/components/articles/BundleArticleReader.tsx:258`)
- Per-page iframe sandbox only allow-scripts gives opaque origin; event.source checked; scroll deltas clamped±2000; content errors capped500 chars; loading message identifies page. (`client/components/articles/BundleArticleReader.tsx:91`)
- Frame forwards wheel (line16px,page innerHeight),single-touch movement,arrows40px,PgUp/PgDn/Space85%height (Shift reverses); multi-touch does not implement pinch zoom. (`client/lib/bundleFrame.ts:6`)
- Sanitizer strips forms,nested frames,object/embed,unsolicited scripts,event handlers,srcdoc,nonce,srcset and unsafe links; validates resource MIME. (`client/lib/bundleFrame.ts:27`)
- CSP default-src none; images blob/data,styles blob/inline,scripts blob/nonce,font/media blob; connect/base/form none. This is a meaningful reusable security boundary. (`client/lib/bundleFrame.ts:4`)
- Transferable ArrayBuffers cross postMessage; opaque frame creates its own blob URLs for Chrome70; unloading revokes URLs/releases dependencies and pending payload. (`client/lib/bundleFrame.ts:8`, `client/interact/bundles.ts:583`)
- Offline page gaps explicitly say “以上页面未下载”/“以下页面未下载”; reconnect reopens both ends; completed footer “文档完（共 N 页）”. (`client/components/articles/BundleArticleReader.tsx:235`, `client/components/articles/BundleArticleReader.tsx:329`)

### 7.5 Poppler source, prebuilts and runtime resolution

| Item | Verified inventory / behavior | Evidence |
|---|---|---|
| Source | `lib/poppler` git submodule FlysoftBeta/pdf-render; custom pdfrender GPL-2.0-or-later; Poppler version26.08.90. | `.gitmodules:4`, `lib/poppler/utils/pdfrender.cc:1`, `lib/poppler/CMakeLists.txt:43` |
| Provenance | Submodule/prebuilt declared source ae0a0dad,2026-08-09; manifest workflow run31309289423 plus per-target artifact/hash metadata. Declared provenance, not reproduced build. | `lib/poppler-prebuilt/manifest.json:3` |
| Targets | linux-debian,linux-redhat,windows, all x86_64; Ubuntu24.04/Fedora44/MSYS2 UCRT64 build environments. | `lib/poppler/.github/workflows/pdfrender.yml:25` |
| Build choices | Release static Poppler; disable CPP/GLib/Qt/boost/LCMS/curl/TIFF/NSS/GPGME/tests; enable JPEG/OpenJPEG; link Cairo/font/image platform libraries. | `lib/poppler/.github/workflows/pdfrender.yml:25` |
| Linux contents | pdfrender + share/poppler + parser/docs/licenses; system cairo/fontconfig/freetype/jpeg/openjp2/webp/zstd/zlib/png/stdc++/libc still required. | `lib/poppler/utils/pdfrender.md:66` |
| Windows contents | pdfrender.exe and non-system UCRT DLLs captured through ldd, Poppler data and licenses. | `lib/poppler/.github/workflows/pdfrender.yml:156` |
| Production path | appDir/server/pdfrender/windows/pdfrender.exe or linux/pdfrender. | `server/infra/runtimeConfig.ts:152` |
| Development path | Prebuilt Windows; Linux ID/ID_LIKE Debian/Ubuntu→linux-debian, otherwise linux-redhat; env override allowed. | `server/infra/runtimeConfig.ts:51` |
| Data lookup | Native executable-relative share/poppler; requires nameToUnicode,cidToUnicode,unicodeMap,cMap; UTF-8 text output; Linux prepends executable dir to LD_LIBRARY_PATH. | `lib/poppler/utils/pdfrender.cc:80`, `server/infra/runtimeConfig.ts:189` |

Windows DLL filenames (all under `lib/poppler-prebuilt/windows/`, `.dll` suffix): libbrotlicommon,libbrotlidec,libbz2-1,libcairo-2,libexpat-1,libfontconfig-1,libfreetype-6,libgcc_s_seh-1,libglib-2.0-0,libgraphite2,libharfbuzz-0,libiconv-2,libintl-8,libjpeg-8,libopenjp2-7,libpcre2-8-0,libpixman-1-0,libpng16-16,libsharpyuv-0,libstdc++-6,libwebp-7,libwinpthread-1,libzstd,zlib1.
Inventory is filesystem-observed; packaging mechanism: `lib/poppler/.github/workflows/pdfrender.yml:165`.
Allowed probe observation: invoking bundled Debian pdfrender `--help` on survey host failed before main with missing `libjpeg.so.8`; binaries are not Linux-ABI-independent. No PDF was processed.

### 7.6 Other document/media paths

- Text action requires nonempty title/content/group, no domain-specific maximum beyond transport/resource constraints; service trims. Segments are10000 UTF-16 units, boundary backs off one unit to preserve surrogate pairs. (`shared/protocol/actions.ts:597`, `shared/articles/segments.ts:17`)
- Text viewer renders plain selectable whitespace-preserving typography, not Markdown: .95rem,line-height1.9,10px paragraph padding,word-break. (`client/components/articles/TextArticleReader.tsx:64`)
- Reader chunks paragraph-first; skip whitespace-only; long paragraph split newline→sentence boundary→hard split, excluding numbered-list periods; target10k/hard100k code units. (`client/lib/reader/textChunks.ts:4`)
- Chunk cursors start/end offsets, stable bootstrap clamped once; dynamic total only grows; fetch12..64 chunks for viewport, bootstrap includes40% prior context. (`client/components/articles/TextArticleReader.tsx:115`)
- Text Infini keeps three residents per side and10,000px render window each side; estimate28chars/line,15.2×1.9px; centered saved offset,first-visible waterline. (`client/components/articles/TextArticleReader.tsx:279`)
- Text progress debounce1500ms; unmount mistakenly re-submits lastSavedId, immediately ignored as unchanged, so final sub1.5s movement can be lost. (`client/components/articles/TextArticleReader.tsx:150`, `client/components/articles/TextArticleReader.tsx:325`)
- Novel importer fetches catalog then sequential chapters, combines title/author/chapter headings/plain text in memory; single chapter failure aborts entire publication; no partial article. (`server/runtime/articleImportRuntime.ts:129`)
- Novel task Map is ephemeral, newest50/user, duplicate active user/book/group reused; old completed/failed24h cleanup only when starting another task; restart loses task state. (`server/runtime/articleImportRuntime.ts:85`, `server/runtime/articleImportRuntime.ts:175`)
- Windows capture polls saved open Word/PowerPoint/Excel/WPS via COM GetActiveObject every2s; unsaved-without-directory skipped; case-insensitive path dedup captures once while path stays open. (`server/runtime/teachDocumentsRuntime.ts:31`, `server/runtime/teachDocumentsRuntime.ts:250`)
- Capture copies on-disk original, not unsaved in-memory edits; source size+mtime must remain unchanged across copy, else discard; captures ready blob after durable intent/fsync. Close/reopen or restart can recapture. (`server/runtime/teachDocumentsRuntime.ts:142`)
- Office monitoring failure restarts after5s; startup removes interrupted captures; supported download MIME families doc/docx/docm,ppt/pptx/pptm,xls/xlsx/xlsm/xlsb. No Office-to-PDF conversion/browser Office viewer. (`server/runtime/teachDocumentsRuntime.ts:233`, `server/http/routes/teachDocumentDownload.ts:5`)
- Other media are image posts/stickers, AI image attachments, and yt-dlp audio/cover streams; `lib/media` is audio-provider infrastructure, not generic document conversion. (`lib/media/index.ts:1`, `server/services/postImagesService.ts:33`)

## 8. Offline and sync

### 8.1 Boot and ServiceWorker

- Stable production shell owns browser bootstrap: opens shared IDB, migrates historical bundle records before app-store cleanup, reads active pointer, installs JS from ArrayBuffer via blob module script; revoke bootstrap URL after60s. (`shell.html:55`, `shell.html:198`)
- Shell first attempts no-store manifest fetch then falls back cached active bundle on failure; no explicit fetch timeout, so a stalled request can stall launch despite installed cache. Initial shell install does not validate manifest size/hash. (`shell.html:225`)
- ServiceWorker requires secure context; install fetches manifest+shell no-store, skipWaiting; activate claims clients. It does not discover later app updates autonomously. (`shell.html:46`, `server/http/serviceWorker.ts:3`)
- Same-origin navigation excluding /api and /api/* returns cached active shell first, network fallback; missing offline install yields503 with Chinese explanation. API/resource/media fetches are not intercepted for offline caching. (`server/http/serviceWorker.ts:111`)
- Message protocol stage/get/activate stages a chosen shell, switches metadata pointer, then removes other shell caches. App owns update choice. (`server/http/serviceWorker.ts:35`)
- BundleManager checks startup/remote hello/update signal/every5min; validates byte size, stages shell and JS, activates/reloads, attempts old activation on failure; SW ready5s/reply10s timeout. (`client/lib/bundle.ts:16`, `client/lib/bundle.ts:160`)
- main awaits bundle preparation before React/transport startup; reconstructible application-store reset preserves shell IDB and SW cache. (`client/main.tsx:17`, `client/data/migration.ts:267`)

### 8.2 What actually works disconnected

| Operation | Offline behavior / limits | Evidence |
|---|---|---|
| Start installed app | Cached shell+JS possible; initial network stall caveat above; first-ever installation requires network. | `shell.html:225`, `server/http/serviceWorker.ts:111` |
| Authenticate/unlock | Cached authenticated actor can warm restore/optimistically unlock; fresh PIN/OOBE requires server. | `client/interact/sessionController.ts:35`, `client/interact/sessionController.ts:153` |
| Read chat | Only cached continuous ranges; boundary labels explain missing history. | `client/hooks/useChatPosts.ts:296`, `client/components/shared/InfiniView.tsx:116` |
| Write draft | Persist local Assignment; later merge/sync; cannot publish text/image/sticker post. | `client/components/chat/MessageComposeBar.tsx:97`, `client/interact/sync.ts:183` |
| Read document | Cached text segments/resources only; complete retained bundles work; missing dependencies explicit. | `client/interact/bundles.ts:611`, `client/components/articles/ArticleReader.tsx:377` |
| Reading decisions | Resume/furthest/bookmark model stores proposals; bookmark UI itself disabled offline. Reading-time report only online. | `client/data/model.ts:140`, `client/hooks/useArticleReading.ts:6` |
| User/conversation settings | Theme and conversation mute usable; DND model supports proposals but Settings switch blocks offline; pin UI also blocks offline. | `shared/userConfig/keys.ts:1`, `client/components/settings/Settings.tsx:296`, `client/components/chat/ConversationSettingsMenu.tsx:118` |
| Retention requests | Claims can persist while offline, download resumes with connection; absent bytes do not become magically available. | `client/interact/sync.ts:104` |
| Music | Audio previously cached can play via failed-remote fallback; uncached search/play needs backend. | `client/hooks/useMediaPlayer.ts:135` |
| AI / vocabulary/admin writes | Server actions, no generic offline operation outbox found; AI input is only ephemeral component state. | `client/interact/ai.ts:1`, `client/api/words.ts:1`, `client/components/ai/AiView.tsx:103` |
| Membership/DM/publication | Server-established facts remain online-only; no queued create/join/publish mechanism. | `client/interact/groups.ts:1`, `client/interact/posts.ts:1` |

### 8.3 Recovery, conflict semantics and quotas

- Connectivity is RPC socket state, not navigator.onLine. Server disappearance and forced offline both drive presentation. (`client/interact/remoteLifecycle.ts:335`)
- Recovery debounce150ms; authenticate→app state→access refresh→pending proposals→post revision catch-up→article/AI snapshots/retention→queued events→live. Actor generation guards discard late cross-account responses/events. (`client/interact/remoteLifecycle.ts:79`)
- Revoked-object proposals become dormant until access returns, rather than being uploaded against stale rights; queued live events are latency optimization, snapshots/revisions repair missed events. (`client/interact/remoteLifecycle.ts:209`, `client/interact/sync.ts:183`)
- User proposal timestamp=max(now,previous+1), operation_id identifies local operation; equal timestamp favors canonical; strictly newer proposal remains pending after older base update. (`client/repo/assignment.ts:45`)
- Read progression has both override and furthest semantics; sequence ordering, not post UUID lexical order, determines latest read; immutable/tombstone merge prevents resurrection. (`shared/sync/arbitration.ts:1`, `client/repo/immutable.ts:1`)
- Revision recovery compares per-conversation revision and decimal revision sums; coverage separately tracks known intervals. Row count is not proof of a complete list or gap-free history. (`client/repo/coverage.ts:1`, `client/repo/revision.ts:1`, `shared/protocol/actions.ts:790`)
- Flush order lock→user settings→conversation/article config→drafts/progress; a failure is isolated for future recovery, not grounds to discard other pending intent. (`client/interact/sync.ts:183`)
- User-config offline allowlist is theme_mode/do_not_disturb; other named keys active_article_id/recent_stickers/self_discipline_mode exist but are not all queued offline. Server generic setter does not enforce this client allowlist. (`shared/userConfig/keys.ts:1`, `server/domain/facade/versionedUserConfig.ts:9`)
- Conversation retention auto/week/half-year downloads200 posts/page down to sent-time cutoff; article explicit durations1/7/180d; text completeness checked, bundles all-resources materialized. (`client/interact/sync.ts:37`, `client/interact/sync.ts:104`)
- Quota scheduling after writes debounces500ms, triggers90% usage,targets80%,maxfour rounds; unknown quota forced cleanup64MiB,minimum forced16MiB. (`client/interact/quota.ts:21`, `client/data/quotaPolicy.ts:1`)
- Eviction order orphans→unprotected domain cache→protected domain cache→media→post images; protection is priority, not absolute retention guarantee under storage pressure. (`client/interact/quota.ts:56`)
- Conversation eviction trims oldest edge to preserve continuous interval; bundle catalog+dependencies reclaimed together; claims record missing_reason=evicted. (`client/data/repository.ts:2541`)
- Ordinary quota exception retries operation once after reclamation; streams reclaim without blindly replaying consumed stream; stop rounds if estimate does not decrease. (`client/interact/quota.ts:21`)
- navigator.storage persistence helper has no callers; OS/browser may evict app data. No surveyed code proves retention durable against browser-wide storage eviction. (`client/interact/quota.ts:102`)
- Existing old-browser IDB/extent/migration tests cover pure policies, not all browser crash/multitab guarantees; see §12 and open questions. (`scripts/tests/unit/client/quotaPolicy.test.ts:10`, `scripts/tests/test-e2e.mts:670`)

## 9. Client architecture

| Layer / technology | Verified function / version declared by manifest | Evidence |
|---|---|---|
| React/ReactDOM | 19.2.8 SPA rendering; no URL router dependency. | `package.json:52`, `client/interact/types.ts:28` |
| MUI / Emotion | MUI7.3.11,Emotion11.14 styled/material UI; icons package. | `package.json:36` |
| Zustand | 5.0.14 presentation projection, route/session/media/task/debug state; persisted authority remains IDB/server. | `package.json:58`, `client/interact/appStore.ts:140` |
| Zod | 4.4.3 shared input/output/wire schemas. | `package.json:57`, `shared/protocol/actions.ts:258` |
| Rich AI text | Streamdown2.5+CJK/math/Mermaid,KaTeX.18.4 override aligns nested renderer/CSS versions. | `package.json:41`, `package.json:60`, `client/components/ai/markdown.ts:1` |
| Browser polyfills | core-js3.49 loaded before application; ES2017 TS and chrome70 Vite target. | `client/main.tsx:1`, `tsconfig.json:3`, `vite.config.ts:70` |
| Build | TypeScript6.0.3,Vite8.1.5,React plugin6.0.4; strict/noEmit/bundler resolution. | `package.json:70`, `tsconfig.json:7` |
| Virtualization | Local Infini Rust/WASM plus TypeScript/React source aliases; chat/text/PDF/sticker usage. | `tsconfig.json:19`, `client/components/shared/InfiniView.tsx:10` |
| Binary helpers | fflate ZIP,custom zstd WASM,ArrayBuffer IDB extent engine,content hashes. | `package.json:48`, `client/interact/bundles.ts:29`, `client/data/files.ts:5` |

Directory responsibilities (actual import boundaries, not instructions for the rewrite):

- `client/components`: views/dialogs/form controls; `client/hooks`: React lifecycle/selector adapters and player/reading orchestration. (`client/components/App.tsx:1`, `client/hooks/useAppLogic.ts:1`)
- `client/interact`: local/remote policy, authentication lifecycle, proposals, retention, resources, presentation stores. (`client/interact/sessionController.ts:1`, `client/interact/sync.ts:1`)
- `client/data`: IDB transactions/normalized rows/file extents; `client/repo`: pure assignment/coverage/revision/snapshot/immutable/watermark algorithms. (`client/data/schema.ts:1`, `client/repo/assignment.ts:1`)
- `client/api`: typed legacy action wrappers/raw binary HTTP; `client/lib`: shell bundle manager, iframe runtime, text chunk/encoding/CSS/device time/load-balancing mechanisms. (`client/api/admin.ts:1`, `client/lib/bundle.ts:1`)
- `shared`: types/API contracts/events,authority/features,capability/grant validation,byte/time/post/sync helpers; used on both runtimes. (`shared/protocol/actions.ts:1`, `shared/authority.ts:1`)

Production output is one ESM app.js: inline assets,no code splitting,no CSS splitting,hidden source map. CSS imported as text/injected; KaTeX woff2 faces rewritten data URLs to prevent offline missing siblings. (`vite.config.ts:8`, `vite.config.ts:64`, `scripts/builds/katexCss.ts:1`)
Development index title `Talos II (Dev)` imports client/main.tsx; production shell title `Talos II`, old-syntax inline bootstrap and loading/error states. (`index.html:1`, `shell.html:43`)
`vite.bootstrap.config.ts` misleadingly names the Node CJS server bootstrap build, not a browser bootstrap bundle. (`vite.bootstrap.config.ts:7`)
Startup prepares bundle,injects CSS,initializes Infini WASM,transport,quota,endpoints,then React root. (`client/main.tsx:17`)
Theme is light/dark with blue#1d9bf0,Segoe/PingFang/YaHei font,20px button radius,blurred dialogs; per-user mode loaded/remotely updated. (`client/components/App.tsx:61`, `client/components/App.tsx:797`)
Chinese literals and zh-CN formatting/PWA metadata; no translation catalog/framework found. Technical English persists in Incidents/AI/Fork and some help strings. (`public/manifest.webmanifest:2`, `client/components/ai/AiView.tsx:391`, `package.json:35`)
Viewport user-scalable=no; visualViewport sets --vh; CSS helpers implement flex-gap/vh/inset/min fallbacks; global user-select/touch-callout suppression except approved elements. (`index.html:5`, `client/components/App.tsx:797`, `client/lib/css.ts:1`, `client/global.css:7`)
Build-browser targets are explicit; dependency version ranges are declarations, not a claim that arbitrary future versions work on Chrome70. Pinned lockfile exists. (`package.json:32`, `package-lock.json:1`)

## 10. Launcher, packaging and deployment

### 10.1 Installed layout and process lifecycle

| Installed path / process | Purpose | Evidence |
|---|---|---|
| ROOT/launcher.js,start.sh,start.bat | Node launcher entry; scripts cd own directory and invoke externally installed node. | `launcher/start.sh:1`, `launcher/start.bat:1` |
| ROOT/current/ | Active app payload: server.js,server/main.mjs,executor/client/shell/public/native resources. | `launcher/launcher.ts:29`, `scripts/builds/build.mjs:202` |
| ROOT/staging/,ROOT/backup/ | Candidate and previous app trees for swap/rollback. | `launcher/launcher.ts:29` |
| ROOT/data.db and storage/ | Persistent database/object root, outside current version. | `launcher/launcher.ts:118`, `server/storage/paths.ts:3` |
| ROOT/backups/ | SQLite snapshots, not complete data-root copies. | `server/infra/dbBackup.ts:8` |
| ROOT/.launcher-pid | Launcher process marker. | `launcher/launcher.ts:29` |
| ROOT/.pending-update.json | Original appliedAt and DB backup target survive launcher restart. | `launcher/launcher.ts:168` |

- Launcher is process/version manager only; no Electron/Chromium kiosk window is created. Browser entry/managed-device policy belongs to environment and web app. (`launcher/launcher.ts:1`, `launcher/start.bat:1`)
- HTTP defaults80,81,82,83,84,85,86,88 (87 deliberately absent in list),HTTPS443,bind0.0.0.0,trusted proxies empty; ports validated/deduplicated positive≤65535. (`launcher/launcher.ts:48`, `launcher/launcher.ts:118`)
- Read current/https/config.json and resolve certificate paths; invalid config logs and omits HTTPS configuration. (`launcher/launcher.ts:74`)
- fork current/server.js with cwdROOT,NODE_ENV=production,inherited stdio+IPC; ready handshake sends boot config, fallback sends after1s. (`launcher/launcher.ts:290`)
- Update IPC records action, SIGTERM child, waits exit, swaps current→backup/staging→current; restart after500ms; normal crash restart2s; clean exit0 stops. (`launcher/launcher.ts:168`, `launcher/launcher.ts:337`)
- Three rapid crashes (<15s each) can auto-rollback when backup exists; pending release watchdog3min retains original appliedAt across restart. (`launcher/launcher.ts:240`, `launcher/launcher.ts:361`)
- Confirm removes old app backup/pending metadata. Rollback restores DB snapshot after removing WAL/SHM and restores app; absent DB target warns and does app-only restore. (`launcher/launcher.ts:145`, `launcher/launcher.ts:215`)
- SIGINT/SIGTERM remove PID marker, forward signal and exit. No system-service installation/autostart configuration is supplied by these start scripts. (`launcher/launcher.ts:434`, `launcher/start.sh:1`)

### 10.2 Build and native dependencies

- Assembler host restricted Linux x64; target linux-redhat/linux-debian/windows. Both Linux target packages put renderer under server/pdfrender/linux. (`scripts/builds/build.mjs:156`, `scripts/builds/build-targets.mjs:1`)
- Build ID from CLASSAPP_BUILD_ID or git short HEAD; rebuild Infini/zstd WASM; Vite client/server main/executor; private sourcemap assembly; copy renderer; build CJS bootstrap+launcher; write build-id.txt. (`scripts/builds/build.mjs:42`, `scripts/builds/build.mjs:161`)
- Deploy ZIP contains current-version contents only; bootstrap ZIP includes launcher/start scripts and current/; output build/. Neither bundles a Node runtime. (`scripts/builds/build.mjs:238`)
- Runtime copied packages: better-sqlite3,bufferutil,ws,playwright/playwright-core,sharp,detect-libc,@img/colour; native sqlite Linux/Windows x64,bufferutil platform prebuilds,Sharp/libvips packages preserved. (`scripts/builds/runtime-deps.mjs:17`, `scripts/builds/runtime-deps.mjs:108`)
- Native runtime cache key includes locked versions/integrity/platform/assembler hash; build cannot simply copy arbitrary host native addon. (`scripts/builds/runtime-deps.mjs:108`)
- Server/launcher Node22 build target; Rust nightly default2026-05-10+rust-src,wasm-pack release targetweb/no-opt,MVP CPU; disable bulk-memory,multivalue,mutable-globals,nontrapping-fptoint,reference-types,relaxed-simd,sign-ext,simd128,tail-call. (`vite.launcher.config.ts:8`, `scripts/builds/build-wasm.mjs:6`)
- wasm-bindgen cached DataView/Uint8Array getters patched to fresh memory.buffer views for Chrome70 memory.grow behavior; build fails if cached patterns remain. (`scripts/builds/build-wasm.mjs:90`)
- Private sourcemaps under server/source-maps with manifest,public .map removed; project-relative frame mapping supports incidents. (`scripts/builds/build.mjs:99`)
- Build copies HTTPS config/fullchain/private key/root from source-referenced ignored secrets paths; models.json copied mode600; missing AI config disables AI; CLASSAPP_REQUIRE_HTTPS can fail build. Secret contents not read. (`scripts/builds/build.mjs:60`)
- Media pins yt-dlp2026.07.04 and bgutil POT1.3.1; standalone Linux yt-dlp or Windows executable+_internal,custom and POT plugins,prepared POT server. (`lib/media/artifacts-manifest.json:3`, `scripts/builds/build-media.mjs:92`)
- Normal media build can curl-download yt-dlp/plugin on cache miss with size/SHA256 verification, despite source comment calling normal builds offline; missing prepared POT server fails. (`scripts/builds/build-media.mjs:3`, `scripts/builds/build-media.mjs:40`)
- Poppler update helper uses gh successful workflow lookup/optional run, downloads/verifies prebuilts+manifest; normal app build copies committed prebuilts, not compiling Poppler. (`scripts/dev/update-pdfrender.mjs:12`, `scripts/builds/build.mjs:217`)
- Playwright packages copied but Chromium install not part of normal release assembly; network-novel search needs browser runtime provisioned separately. (`scripts/builds/runtime-deps.mjs:17`, `lib/tomato/browser.ts:81`)
- GitHub Windows workflow builds on Ubuntu24.04,Node22,Rust nightly,prepares media,checks ZIP contents and uploads14-day artifacts; no native Windows execution test in that workflow. (`.github/workflows/build-windows.yml:24`)

### 10.3 Update, backup and operations scripts

- Upload ZIP limit512MiB; entry512MiB,expanded2GiB,files200k; require server.js,shell.html,client/,server/,node_modules/; reject absolute/drive/traversal/normalized collisions. (`server/runtime/update/archive.ts:6`)
- unzipSync materializes archive before expansion checks, so configured expansion limits do not bound peak decompression memory. fs.writeFileSync extraction does not restore executable mode. (`server/runtime/update/archive.ts:88`, `server/runtime/update/archive.ts:130`)
- Stage refuses concurrent/pending updates,extracts,backs up SQLite,records pending; HTTP202 must flush before apply, restart scheduled1s. (`server/runtime/update/runtime.ts:194`)
- Cloud checker starts10s then every15min only when enabled+autocheck+manifest URL and idle; it checks but does not automatically install. (`server/runtime/update/runtime.ts:28`, `server/runtime/update/runtime.ts:315`)
- Manifest classapp-update-v1 has buildId/date,archive name/size/SHA256,ordered part URLs/sizes/hashes; manifest≤1MiB,part≤100000000 bytes,aggregate≤8GiB,part sum exact. (`server/runtime/update/cloud.ts:4`)
- Fetch no-store/follow redirects,5min timeout each; buffer full archive,verify every part/full hash; no signature field. Cloud schema8GiB conflicts with deploy512MiB limit. (`server/runtime/update/cloud.ts:56`, `server/runtime/update/archive.ts:7`)
- Current cloud install likely self-rejects: cloudInstalling=true then deployUpdate→stageDeployment guard rejects cloudInstalling. Static call-path finding, not execution result. (`server/runtime/update/runtime.ts:297`, `server/runtime/update/runtime.ts:202`)
- SQLite backup API produces data-<ISO timestamp with colon/dot replaced>.db,retains latest five,sorted by mtime; allowed filename `[\w.-]+.db`; download ZIP buffered≤1GiB. (`server/infra/dbBackup.ts:8`, `server/infra/dbBackup.ts:59`)
- Backups omit storage objects and workspace bytes; launcher rollback restores app+DB, not old object store. A DB rollback may reference unavailable objects after destructive migrations. (`server/infra/dbBackup.ts:59`, `launcher/launcher.ts:145`, `server/infra/db.ts:708`)
- `scripts/operation/deploy-gitee.mjs` references ignored gitee.json credentials,creates deploy-tag release and numbered100MB parts,reads build ID from ZIP. (`scripts/operation/deploy-gitee.mjs:11`)
- `scripts/operation/duckdns-certificate.mjs` supports check/renew DNS certificate workflow; root certificate and hostname setup are environment requirements, not automated tablet enrollment. (`package.json:25`, `scripts/operation/duckdns-certificate.md:1`)
- Dev scripts orchestrate client3000/server3001,reset dev data,update media/renderer; reset is destructive and was not run. (`package.json:7`, `scripts/dev/dev.mjs:1`, `scripts/dev/reset-dev.mjs:1`)
- Development overrides CLASSAPP_APP_DIR,CLASSAPP_DATA_ROOT,CLASSAPP_PORT(default3001),CLASSAPP_BUILD_ID(defaultdev). (`server/dev.ts:9`)

## 11. Other libraries in lib/

| Library | What it is / application use | Submodule / licensing | Evidence |
|---|---|---|---|
| infini | Rust virtual-list engine,WASM glue,TS headless controller,DOM coordinates,React bindings; chat/text/PDF/stickers use bidirectional variable-height windows. | Git submodule infini-scroll/infini; Apache2 declared in packages. | `.gitmodules:1`, `lib/infini/packages/infini-core/package.json:5`, `client/components/shared/InfiniView.tsx:10` |
| tomato | Fanqie novel search/catalog/chapter adapter,Cheerio parsing,PUA decoding,Playwright search,fallback mirrors,pooled cooldowns. | Local source,not submodule; no separate license declaration found; root Apache2 applies only to repository-owned code, upstream service/content rights separate. | `lib/tomato/index.ts:1`, `lib/tomato/decode.ts:8`, `LICENSE:1` |
| media | Provider-neutral track/audio/cover stream abstraction; current youtube-music yt-dlp provider plus custom extractor. | Local source; bundled yt-dlp Unlicense/POT GPL3 notices; not blanket Apache for all payloads. | `lib/media/index.ts:1`, `scripts/builds/build-media.mjs:165` |
| zstd-web | Rust WASM decompressor over ruzstd0.9/wasm-bindgen; dictionary and nondictionary document resource decoding only. | Local wrapper,not submodule; no separate wrapper license found; dependencies carry their own licenses. | `lib/zstd-web/Cargo.toml:1`, `lib/zstd-web/src/lib.rs:5` |
| poppler | Custom native renderer fork,described §7. | Git submodule FlysoftBeta/pdf-render; GPL-2.0-or-later renderer. | `.gitmodules:4`, `lib/poppler/utils/pdfrender.cc:1` |
| poppler-prebuilt | Committed three-platform artifacts,manifest,Poppler data,parser,licenses. | Not submodule; derived binary/dependency licenses apply. | `lib/poppler-prebuilt/manifest.json:3`, `lib/poppler-prebuilt/linux-debian/COPYING:1` |

Tomato operational specifics:

- Client-layer cooldown minimum search5s/download500ms; interactive pool returns ready_at/retry window instead of waiting; background waits25..100ms. (`lib/tomato/client.ts:26`, `lib/tomato/pool.ts:18`)
- Dynamic quota penalizes premature retry by additional5s,expires state after5min; UI timer is not authoritative enforcement. (`lib/tomato/quota.ts:21`)
- Default browser pool two isolated Chromium contexts,headless/stealth,zh-CN,1365×900,automation-flag patch; fresh page per operation. (`lib/tomato/browser.ts:20`, `lib/tomato/browser.ts:81`)
- HTTP default20s timeout/four retries,429/500..504/network exponential800×2^attempt delay; empty verification responses become explicit Chinese error. (`lib/tomato/http.ts:4`)
- Chapter fallback recognizes preview markers,official/mirror options; five hardcoded mirrors, two failures open circuit2min. An embedded third-party API token exists at `lib/tomato/chapter.ts:59`; value omitted. (`lib/tomato/chapter.ts:14`, `lib/tomato/chapter.ts:356`)
- App pool uses30s timeout/four retries,interactive search one page45s; ETA remaining chapters×500ms is estimate, not measured rate. (`server/runtime/articleImportRuntime.ts:48`, `server/runtime/articleImportRuntime.ts:129`)
- Standalone downloadBook exporter can select chapter range,save sanitized title_bookId/catalog.json/five-digit-index_chapterId.txt,skip existing>20byte chapters,atomic .part rename; app does not use this disk exporter. (`lib/tomato/download.ts:12`, `server/runtime/articleImportRuntime.ts:129`)

Media operational specifics:

- Track facts frozen; upstream cover URL hidden in WeakMap hint,not returned as generic trusted client URL. (`lib/media/track.ts:18`)
- yt-dlp base flags `--no-warnings --extractor-args youtube:player_client=web_music`; separate extractor argument for `youtubepot-bgutilhttp:base_url=...`; optional `--js-runtimes node:<node>` and plugin roots. (`lib/media/ytdlpProvider.ts:132`)
- Search flags `--flat-playlist --dump-single-json --playlist-items 1-<limit>` against music-search URL; custom extractor includes artist/album/duration/thumbnail without per-track queries;50s/64MiB stdout cap. (`lib/media/ytdlpProvider.ts:83`, `lib/media/ytdlpProvider.ts:237`)
- Audio flags `--format bestaudio[acodec=opus]/bestaudio --no-playlist --newline --progress --output - <canonicalUrl>`; stream exposed as audio/webm; cover fetched directly or bounded metadata lookup. (`lib/media/ytdlpProvider.ts:277`)
- Runtime search throttle5s,materialize1s,stream-start1s; four concurrent audio streams,30s slot wait,20min admission pin; missing yt-dlp disables backend. (`server/runtime/mediaRuntime.ts:45`, `server/runtime/mediaRuntime.ts:123`)
- POT is separate GPL3 Node process on free loopback port,entry --port N; waits startup log20s then ping polling250ms for10s; shutdown taskkill /T /F on Windows or TERM then KILL3s. (`server/runtime/potServer.ts:11`)
- waitHealthy exits after10s without throwing if ping never succeeds; an apparently allocated port need not mean healthy provider. (`server/runtime/potServer.ts:100`)
- zstd wrapper reads64KiB output chunks,expected-size bound rejects under/overflow; WASM release LTO,opt-size,abort,no wasm-opt; tests valid frame/invalid frame. (`lib/zstd-web/src/lib.rs:5`, `lib/zstd-web/Cargo.toml:14`)

## 12. Cross-cutting behaviours

### 12.1 Domain rules that matter across screens

- Group handle permits letters/digits/underscore/hyphen1..32; generated sanitized lowercase name≤24,base/base-1..7 then random g- suffix. Group password is unsalted SHA256, unlike PIN HMAC. (`server/services/groupsService.ts:40`, `server/services/groupsService.ts:118`)
- Ordinary creation adds creator; discoverable child can attach only to joined parent; nondiscoverable creation discards parent; assigning special wild/announcement demotes previous same-type group. (`server/services/groupsService.ts:197`)
- Join accepts ID or handle,validates discovery source/parent/password; wrong password returns needs_password domain result, not thrown protocol error. (`server/services/groupsService.ts:275`)
- Leaving last-member normal group deletes it; wild/announcement retained; no_leave enforced for ordinary member,advanced admin can force membership changes. (`server/services/groupsService.ts:162`, `server/services/groupsService.ts:317`)
- Hidden-members group returns empty members/users with hidden=true to non-CM; otherwise membership required and self-hidden peers filtered; admin membership display is not editable self-hide. (`server/services/groupsService.ts:339`)
- Parent cannot equal self, but service does not reject arbitrary multi-node parent cycles (static limitation). (`server/services/groupsService.ts:400`)
- Posts have no general product gate; group member OR base administrator can read/post and administrator bypasses admin_only; DM needs one of two peers,with no universal admin DM bypass. This contradicts base-role description claiming no specific operation powers. (`server/domain/facade/posts.ts:30`, `shared/authority.ts:28`)
- First DM publication requires extant peer and mutually visible shared group; existing DM does not recheck shared group. (`server/services/postsService.ts:240`)
- Reply target must be readable,not deleted,same conversation. Muted user cannot create/edit but may delete own post; CM force deletion still needs conversation access and is audited. (`server/domain/facade/posts.ts:98`, `server/domain/facade/posts.ts:164`)
- Post cursor sequence fallback is used only with corresponding missing ID; sequence-only accepted request fields are ignored by implementation. (`server/services/postsService.ts:76`)
- Word selection30% wrong pool when available; otherwise random from first100 alphabetically unlearned; wrong pool weighted-without-replacement≤50 then uniformly selected; distractors biased random-sort≤3. (`server/services/wordsService.ts:154`, `server/data/words.ts:301`)
- Discipline when mistakes exist:50% weighted mistake,40% unlearned,10% review mastered learned_count<5; fallback random entire dictionary. (`server/services/wordsService.ts:186`, `server/data/words.ts:359`)
- Correct practice +1 or explicit mastery+2; total≥2 mastered; wrong count decrements one; incorrect demotes mastery without resetting learned total,so next correct can rapidly restore mastery. No practice idempotency key. (`server/data/words.ts:165`)
- Today count counts distinct words whose latest practice falls on requested local day,not an immutable practice-event history; repeated practice overwrites last_practiced_at. (`server/data/words.ts:123`)

### 12.2 AI execution, billing and file safety

- Semantic model placeholders route_classifier,chat_fast/chat_reasoning/chat_vision,writing,metadata,search tags,context_compactor resolve ordered provider candidates; missing/invalid config disables only AI. (`server/infra/aiModels.ts:51`, `server/infra/aiModels.ts:153`)
- Server OpenAI-compatible Responses harness,store=false,safety identifier SHA256(userId) prefix32; client cache keyed hash(baseURL+token),SDK retries disabled,120s timeout. (`server/services/ai/openaiHarness.ts:30`)
- Harness explicitly retries transient connection/408/409/429/5xx per route count; before visible text it may try next compatible candidate; after visible output error propagates. Candidate loop also advances after a nontransient inner-loop break, broader than docs' transient-only promise. (`server/services/ai/openaiHarness.ts:58`, `server/services/ai/openaiHarness.ts:128`, `docs/systems/ai-harness.md:63`)
- Route classifier picks fast/reasoning/vision/writing and0..8 tool rounds; heuristic fallback recognizes Chinese writing/reasoning/new-topic phrases,images force vision. (`server/services/ai/aiService.ts:65`, `server/services/ai/aiService.ts:201`)
- One active run/conversation enforced in SQL; input≤100k characters,≤4 supported images≤5MiB actual bytes; fork must belong to same owned conversation; branch follows parent-message ancestry. (`server/services/ai/aiService.ts:399`, `server/infra/db.ts:142`)
- Conservative reservation includes worst main call plus classifier/one compaction/metadata; quote then transactionally reserve with input/output placeholders; tool loops may cost more than estimate and final charge caps at reservation. (`server/services/ai/aiService.ts:132`, `server/services/ai/aiService.ts:478`, `server/services/ai/aiService.ts:883`)
- Context compacts oldest60% when≥8 messages and characters≥contextSize×2.2; stores prompt-versioned snapshot through message; existing applicable snapshot reused. (`server/services/ai/aiService.ts:601`)
- Stream checkpoints/events at250ms or crossing512-character boundary; cancellation reads AbortController and durable flag; final tool round disables tools. (`server/services/ai/aiService.ts:776`)
- Credit integer scale1,000,000 microcredits per displayed credit; prices credits/million tokens make token×price microcredits; cached-input pricing separate; round aggregate response cost. (`server/data/ai.ts:615`, `server/services/ai/pricing.ts:9`)
- Daily window UTC day,weekly window Monday UTC; plan+top-up split with durable reservation/usage/ledger and idempotency keys; default30-day plan and allowances from §4. (`server/data/ai.ts:648`, `server/infra/db.ts:231`)
- Search can call model to derive tags and reserve/settle auxiliary credits,so AI sidebar search is not necessarily free. (`server/services/ai/aiService.ts:319`)
- Workspace10MiB payload,12MiB ZIP,256 files,three path components (two directories),.txt/.md/.svg authored; image attachments under protected attachments/ directory. (`server/services/ai/aiWorkspace.ts:22`)
- Reject hidden/absolute/parent/backslash paths,NUL text; SVG rejects script,foreignObject,event handlers,external HTTP/javascript refs,entities. These are syntactic filters,not proof of universal SVG safety. (`server/services/ai/aiWorkspace.ts:57`)
- Tools list_files/read_file/create_file/replace_text/delete_file; create refuses existing,replace requires exact expected1..100 occurrences; call IDs and before/after revisions journal mutations. (`server/services/ai/fileTools.ts:19`)
- Workspace mutations serialize per-user lock,build new manifest ZIP,fsync,publish new pointer; crash reconciliation clears staging; startup reconciles active runs/reservations rather than resume provider streams. (`server/services/ai/aiWorkspace.ts:339`, `server/runtime/aiExecutionRuntime.ts:1`)
- Provider token config,full prompts,attachments/workspace data are sensitive; UI exposes placeholder/error/credit state,not provider credential values. Existing embedded token location in tomato remains a separate secret-handling issue. (`server/infra/aiModels.ts:152`, `lib/tomato/chapter.ts:59`)

### 12.3 Security, concurrency and performance

- Single installed server can have many worker SQLite connections,one writer at a time; WAL snapshots/IMMEDIATE writes plus UnitOfWork,not distributed consensus or broker. (`server/infra/db.ts:13`, `server/runtime/unitOfWork.ts:7`)
- Per-request actor reads current user/ban/features/roles,while protocol session binding caches authenticated user identity. Session revocation/expiry is not rechecked on every bound WS action (see §13). (`server/services/authorityService.ts:15`, `server/runtime/executorWorkerMain.ts:68`)
- Multiple device decisions converge through timestamped Assignments and sequence-aware read watermarks; no conflict-resolution UI. Local clock manipulated far forward can dominate settings. (`client/repo/assignment.ts:45`, `server/data/userConfig.ts:35`)
- Access_effective unions direct/group grants with provenance; cached allow accepted,denial recomputed; revoke/remembership rematerializes; ownership/delegation distinct from attribution user_id. (`server/services/accessService.ts:42`)
- Immutable IDs/revisions/tombstones and explicit coverage preserve historical continuity; large bodies/files split/virtualized to limit old-tablet memory. (`server/infra/db.ts:1331`, `client/data/files.ts:5`, `client/repo/coverage.ts:1`)
- Native PDF threads and child semaphore,audio stream cap,thumbnail two-job cap,quota read leases and keyed publication locks bound selected expensive paths. Not every queue has a size/timeout bound. (`server/infra/pdfRenderProcess.ts:7`, `server/runtime/mediaRuntime.ts:123`, `server/runtime/postImageRuntime.ts:11`)
- Images have12MiB upload bound,thumbnail waits15s/two jobs,original durable storage; thumbnails encoded lossy WebP by sharp. (`server/services/postImagesService.ts:33`, `server/runtime/postImageRuntime.ts:11`, `server/infra/imageThumbnail.ts:1`)
- Assets' immutable HTTP caching,content-hash archive dedup,per-blob cached archive indexes,origin spreading,virtualization and staged IDB publication are major performance mechanisms. (`server/http/handler.ts:230`, `server/storage/renderArchive.ts:389`, `client/lib/loadBalancer.ts:15`)
- Anonymous/concealed UI and PIN/device gates are designed for managed intranet,not evidence of public-Internet hardening; raw upload allocation-before-auth and long-lived tokens deserve explicit rewrite decisions. (`docs/product-context.md:5`, `server/http/routes/deploy.ts:4`)

Additional image/media/reading limits found during final cross-check:

- Post originals support JPEG/PNG/GIF/WebP by byte inspection; dimensions positive and≤40,000,000 pixels. Thumbnail sharp uses first page/frame,auto-rotation,fit-inside320×320,no enlargement,WebP quality75/effort4/smartSubsample. (`server/infra/imageThumbnail.ts:4`, `server/infra/imageThumbnail.ts:143`, `server/infra/imageThumbnail.ts:192`)
- Queue title “播放队列”,expiry24h from creation or list mutation; cleanup removes expired queues. Playlist duration is a separate local-retention policy. (`server/data/media.ts:339`, `server/data/media.ts:801`)
- Audio grants use24 random bytes base64url,default10min expiry,are reusable for multiple Range GETs rather than consumed once. (`server/data/media.ts:827`)
- Default server media quota4GiB,target80%,half-life7d; `eviction_days` config expresses heat decay,not a strict age-delete deadline. (`server/data/media.ts:741`)
- Reading history uses30s minimum and sidebar history limit3; read heartbeat15s. Raw recent-access library and history presentation need not show identical sets. (`shared/types/api/article.ts:66`, `server/services/articlesService.ts:67`)

### 12.4 Existing verification assets — inspected, not executed

| Test family / runner | Concrete coverage | Evidence |
|---|---|---|
| Unit runner | node --import tsx --test,30s test timeout,glob scripts/tests/unit/**/*.test.ts. | `package.json:17` |
| Smoke runner | Live action API,fresh default or copied seed/all,180s,concurrency1; absent optional seed skips. | `package.json:18`, `scripts/tests/smoke/all.test.ts:57` |
| Smoke domain suites | auth/app/groups/conversations/posts/articles/stickers/announcement/admin/incidents/words/media/AI/user-config. | `scripts/tests/smoke/all.test.ts:24` |
| Assignment/consistency | LWW/ties/backwards clock/tombstones/read-sequence/furthest/revision/immutable/range cursor progress. | `scripts/tests/unit/client/assignments.test.ts:5`, `scripts/tests/unit/client/consistency.test.ts:15` |
| Coverage/snapshot | Connected/disconnected pages,root reset,live append,eviction prefix,article membership,preserve new proposals. | `scripts/tests/unit/client/coverage.test.ts:14`, `scripts/tests/unit/client/snapshot.test.ts:7` |
| Client policy/encoding | Retention windows,quota90→80/forced floors,device UTC offsets,UTF8/BOM/GBK/ASCII. | `scripts/tests/unit/client/retention.test.ts:9`, `scripts/tests/unit/client/quotaPolicy.test.ts:10`, `scripts/tests/unit/client/deviceTime.test.ts:5`, `scripts/tests/unit/client/textEncoding.test.ts:5` |
| AI math | Same KaTeX dependency,inline woff2 and rendered inline/block/fenced classes. | `scripts/tests/unit/client/aiMath.test.ts:80` |
| Storage | blobStore,gc,treeStore,storagePaths,storageRuntime,keyedLock,quota/quotaService,renderArchive,updateArchive. | `scripts/tests/unit/server/blobStore.test.ts:1`, `scripts/tests/unit/server/renderArchive.test.ts:95`, `scripts/tests/unit/server/updateArchive.test.ts:1` |
| Access | Access grants/effective rights,lifecycle/recovery ports,feature bitset; actor authority tests. | `scripts/tests/unit/server/access.test.ts:1`, `scripts/tests/unit/server/access-lifecycle.test.ts:1`, `scripts/tests/unit/server/access-recovery-ports.test.ts:1`, `scripts/tests/unit/shared/authority.test.ts:1` |
| Runtime/accounting | executorPool,UnitOfWork,AI billing/pricing,images/thumbnail. | `scripts/tests/unit/server/executorPool.test.ts:1`, `scripts/tests/unit/server/unitOfWork.test.ts:1`, `scripts/tests/unit/server/aiBilling.test.ts:1`, `scripts/tests/unit/server/pricing.test.ts:1`, `scripts/tests/unit/server/postImages.test.ts:1` |
| Incidents | Dedup/bounds,archive,source-map behavior. | `scripts/tests/unit/server/incidents.test.ts:1`, `scripts/tests/unit/server/incidentArchive.test.ts:1`, `scripts/tests/unit/server/incidentSourceMaps.test.ts:1` |
| Shared algorithms | access-grants,aiText,arbitration,authority,bytes,conversations,features,posts,segments,stickers,time. | `scripts/tests/unit/shared/arbitration.test.ts:1`, `scripts/tests/unit/shared/segments.test.ts:1`, `scripts/tests/unit/shared/posts.test.ts:1` |
| Production E2E | Fixed Chrome70 CDP,HTTP→trusted HTTPS,redirect caching,incident IDs,legacy IDB migration,single bundle,SW-controlled offline restart. | `scripts/tests/test-e2e.mts:566`, `scripts/tests/test-e2e.mts:670`, `scripts/tests/test-e2e.mts:742` |
| Manual harnesses | Current/legacy browser production runtime setup; not automatic assertions of all feature UX. | `scripts/tests/test-manual.mts:1`, `scripts/tests/test-manual-legacy.mts:1`, `scripts/tests/prod-runtime.mts:1` |
| Infini | Rust/controller/DOM coordinate and browser clamp/layout/mutation/react/seek/window-scroll tests. | `lib/infini/package.json:15`, `lib/infini/packages/infini-core/test/controller.test.ts:1` |
| Renderer fixtures | Deterministic PDF generator;text/fonts/Type3 triangle/raster image; archive unit tests do not execute native renderer. | `lib/poppler/examples/make-pdfrender-smoke-pdf.mjs:13`, `scripts/tests/unit/server/renderArchive.test.ts:95` |

No test results are claimed in this survey. Existing E2E coverage is meaningful for boot compatibility,not evidence every UI/domain feature is fully tested. (`scripts/tests/test-e2e.mts:566`)

## 13. Pain points and accidental complexity

Classification: **essential** preserves observable user value; **implementation accident** is not a requirement to reproduce; **static bug/inference** needs runtime confirmation before claiming production impact.

| Finding | Classification / rewrite implication | Evidence |
|---|---|---|
| Old managed Chrome/intermittent LAN/shared device premise | Essential until deployment changes; replacing PDF pipeline or offline shell requires equivalent compatibility proof. | `docs/product-context.md:5`, `scripts/tests/test-e2e.mts:742` |
| Concealed unlock/browser-Back lock | Intentional user-visible behavior,unusual accessibility/navigation tradeoff; do not silently discard. | `client/components/auth/LockScreen.tsx:8`, `client/hooks/useAppLogic.ts:68` |
| Multiple storage generations/destructive migrations | Implementation accident; current rewrite must explicitly decide preservation/migration rather than copy destructive resets. | `server/infra/db.ts:586`, `server/infra/db.ts:708` |
| Historical architecture says active bundle in globals | Documentation stale: current shell_kv owns pointer. | `ARCHITECTURE.md:33`, `client/data/shellSchema.ts:1` |
| README “ZIP workspace” versus current object model | ZIP remains representation,but publication is UUID BlobStore+manifest tree,not old per-user file paths; docs alone insufficient. | `README.md:35`, `server/services/ai/aiWorkspace.ts:339` |
| Cloud install self-block | Static bug: sets cloudInstalling then calls stage guard rejecting that flag. | `server/runtime/update/runtime.ts:297`, `server/runtime/update/runtime.ts:202` |
| ZIP update loses Unix executable modes | Inference: unzip→writeFile has no chmod/mode restoration; renderer/yt-dlp can lose executable bit after admin update. | `server/runtime/update/archive.ts:88`, `server/runtime/update/archive.ts:130` |
| ZIP expansion limits checked late | Implementation risk: unzipSync allocation precedes bounds; not a streaming bomb-resistant extractor. | `server/runtime/update/archive.ts:88` |
| Cloud aggregate8GiB versus deploy512MiB | Inconsistent acceptance limits,large download can be rejected only at later stage. | `server/runtime/update/cloud.ts:4`, `server/runtime/update/archive.ts:7` |
| DB backup excludes blobs | Essential limitation to surface; restore/rollback cannot promise document/workspace completeness. | `server/infra/dbBackup.ts:59`, `launcher/launcher.ts:145` |
| Renderer native ABI dependencies | Deployment complexity: static Poppler still dynamic Cairo/JPEG/etc.; observed missing libjpeg.so.8 on survey host. | `lib/poppler/utils/pdfrender.md:66` |
| Render archive offset validation weaker than docs | Static discrepancy; validate actual ZIP offsets in rewrite,not only declared bounds. | `lib/poppler/utils/pdfrender.md:133`, `server/storage/renderArchive.ts:228` |
| Renderer queue unbounded/no queue cancellation | Implementation accident; 30min timeout begins only after slot; stale upload cleanup also30min. | `server/infra/pdfRenderProcess.ts:7`, `server/runtime/articleUploadRuntime.ts:15` |
| Global object GC absent | Design choice requires every domain own durable intent/reconciliation; missed domain reference can leak published objects. | `server/storage/gc.ts:54`, `server/storage/blobStore.ts:354` |
| RPC timeout callback no-op | Static bug:120000ms timer callback is ()=>undefined,does not reject/cancel RPC. | `server/runtime/executorPool.ts:47`, `server/runtime/executorPool.ts:145` |
| Worker error handling incomplete | Static risk: rejects pending jobs without restoring all busy/drain state; possible stuck queue. | `server/runtime/executorPool.ts:74` |
| WS bound identity outlives deleted/expired session | Inference: token validated at binding,action uses bound user ID; ban/role state still reread but token expiry/revocation not each action. | `server/runtime/executorWorkerMain.ts:68`, `server/protocol/WebSocketProtocol.ts:83`, `server/runtime/scope.ts:81` |
| Missing MAC merges devices | Static identity collision: default MAC+UA uses mac IS NULL plus exact UA,IP excluded; unrelated same-UA devices can match. | `server/data/clients.ts:47`, `server/data/clients.ts:153` |
| Generic user config has arbitrary keys | Static authority gap/question: setter accepts any key and future timestamp; client allowlist not security boundary. | `server/domain/facade/versionedUserConfig.ts:9`, `server/data/userConfig.ts:35` |
| Administrator role description understates authority | Code gives base administrator group membership/admin-only bypass; preserve actual rule or deliberately revise. | `shared/authority.ts:28`, `server/domain/facade/posts.ts:30` |
| Media config role/navigation mismatch | Backend CM,Global page only OA/ACM visible; CM alone can be authorized without UI route access. | `server/domain/facade/media.ts:206`, `client/components/admin/AdminPanel.tsx:103` |
| Uniform HTTP500 for denials | Accidental transport semantics complicates retry/error reporting; business denial is not necessarily server failure. | `server/http/errorResponse.ts:10` |
| Browser bootstrap network stall | Offline-first intent undermined by unbounded initial manifest fetch before cached fallback. | `shell.html:225` |
| App-store v2/v3→5 migration gaps | Static risk: direct marker upgrade omits media-store creation present in later migration path. | `client/data/migration.ts:105` |
| No persistent-storage request caller | Retention is best effort; OS eviction can remove local intent as well as cache. | `client/interact/quota.ts:102` |
| Text reader unmount progress bug | Static bug: saves lastSavedId instead of current waterline; recent movement lost. | `client/components/articles/TextArticleReader.tsx:150`, `client/components/articles/TextArticleReader.tsx:325` |
| Reading time ignores visibility | Online background-open reader may accrue reading time; not proof of active attention. | `client/hooks/useArticleReading.ts:16` |
| Discipline timer limited/duplicated | Only dashboard mounted,duplicate initial five-minute scheduling; not global discipline enforcement. | `client/components/learning/Learning.tsx:83`, `client/components/learning/Learning.tsx:106` |
| Learning exit UX inconsistent | Direct navigate paths bypass confirmation; insulting exit copy and no-word forced modal deserve product review. | `client/components/App.tsx:170`, `client/components/learning/WordLearningPage.tsx:186`, `client/components/learning/SelfDisciplineModal.tsx:143` |
| Queue lacks automatic next | Observable current behavior,not necessarily intended product requirement. | `client/hooks/useMediaPlayer.ts:278` |
| DND/pin UI stricter than sync model | Inconsistent offline affordances; do not infer writable model means enabled control. | `client/components/settings/Settings.tsx:296`, `client/components/chat/ConversationSettingsMenu.tsx:118` |
| Maintenance restart polling can wait indefinitely | Timeout checked only after successful status response; continuous offline errors can bypass deadline. | `client/components/admin/MaintainTab.tsx:225` |
| POT health wait silently expires | Static bug: supervisor can record unhealthy port. | `server/runtime/potServer.ts:100` |
| AI fallback broader than documented | Candidate loop advances on nontransient failure too; visible-text guard still prevents mid-output fallback. | `server/services/ai/openaiHarness.ts:128`, `docs/systems/ai-harness.md:63` |
| AI attempt schema versus harness | Durable ai_run_attempts exists,but existence alone does not prove every provider retry is recorded; confirm instrumentation before relying on audit completeness. | `server/infra/db.ts:171`, `server/services/ai/openaiHarness.ts:97` |
| Upstream novel scraping/mirrors/embedded token | Fragile implementation dependency,not core reading semantics; hardcoded token location exists and must not be copied as reusable configuration. | `lib/tomato/chapter.ts:48` |
| Stale IDE and selective lint coverage | VSCode points to absent infini2; eslint excludes learning components and words service,so lint pass would not cover those. | `.vscode/settings.json:2`, `eslint.config.mjs:18` |
| Recent churn affects completeness | Git history includes image-post addition/gating (93fa51f/05fcbe4),access model replacement(e1ff5cd),deploy restart-display fix(29d4fec),WebP thumbnail fix(52f2709). Current code,not older docs,is baseline. | Git log at surveyed HEAD; `server/http/routes/postImageUpload.ts:7`, `server/infra/imageThumbnail.ts:1`, `server/storage/paths.ts:3` |

No TODO/FIXME marker was found in the focused client/server/shared/scripts/lib-media search; absence of markers does not mean absence of unfinished behavior. The code-path discrepancies above are stronger evidence than comments.

## 14. Reusable assets

Sizes are filesystem measurements of allowed source tree at survey time,not installed package sizes. Reuse requires preserving source/dependency licenses and target-platform assumptions.

| Asset | Measured size / contents | Reuse caveat | Source |
|---|---|---|---|
| Custom renderer core | pdfrender.cc47,251B | GPL-2.0-or-later;Poppler/Cairo ABI,fonts,math/layout heuristics;review offset validation on integration. | `lib/poppler/utils/pdfrender.cc:1` |
| Bundle writer | PdfRenderBundle.cc21,264B + header1,549B | ZIP64/Zstd/content ID contract;native deps/license. | `lib/poppler/utils/PdfRenderBundle.cc:1`, `lib/poppler/utils/PdfRenderBundle.h:1` |
| Bundle parser example | 4,123B | Useful executable contract documentation;not full adversarial validator. | `lib/poppler-prebuilt/linux-debian/pdfrender-bundle-parser.mjs:1` |
| Debian renderer | 3,716,808B | Linux x64 shared-library requirements;not self-contained. | `lib/poppler-prebuilt/manifest.json:10` |
| RedHat renderer | 3,330,624B | Linux x64/Fedora-era ABI dependencies. | `lib/poppler-prebuilt/manifest.json:17` |
| Windows renderer | 3,406,433B +24 DLLs | x64/UCRT,redistribution notices and executable/DLL co-location. | `lib/poppler-prebuilt/manifest.json:24`, `lib/poppler/.github/workflows/pdfrender.yml:156` |
| Native PDF fixture generator | 2,181B | Generates text,serif/sans,Type3 triangle,raster sample;no checked-in PDF found in allowed tree. | `lib/poppler/examples/make-pdfrender-smoke-pdf.mjs:13` |
| Archive adapter | renderArchive.ts13,420B | Reuse schema/index/range logic only after correcting offset proof gap. | `server/storage/renderArchive.ts:14` |
| Frame sandbox | bundleFrame.ts6,839B | Sanitization/CSP/scroll forwarding/opaque-origin blobs valuable;security regression tests needed when changing contract. | `client/lib/bundleFrame.ts:4` |
| Archive tests | renderArchive.test.ts6,119B | Paths/offset bounds/ordinal/dictionary fixtures,not native-render visual QA. | `scripts/tests/unit/server/renderArchive.test.ts:95` |
| Infini | Rust/TS/DOM/React engine and test suites | Apache2;keep WASM MVP path if Chrome70 remains target;API coupling to local branch. | `lib/infini/package.json:15` |
| Zstd wrapper | src/lib.rs2,623B | Expected-size bounded dictionary decompression;ruzstd/wasm-bindgen license/build constraints. | `lib/zstd-web/src/lib.rs:5` |
| Sync algorithms | assignment,coverage,immutable,revision,snapshot,watermark with unit fixtures | Strong reusable pure logic;separate product conflict policy from mechanisms. | `client/repo/assignment.ts:1`, `scripts/tests/unit/client/consistency.test.ts:15` |
| File extent engine | client/data/files.ts | Chrome70 ArrayBuffer/transaction/orphan handling;requires crash/multitab integration validation. | `client/data/files.ts:5` |
| Chinese text decoder | UTF-8/BOM/GBK tests and PUA map2,262B | Charset map tied to upstream font obfuscation,can become stale. | `client/lib/textEncoding.ts:14`, `lib/tomato/charset.ts:1` |
| App icons | icon-192.png5,113B;icon-512.png19,613B;favicon.ico25,931B | Product branding/rights need confirmation. | `public/manifest.webmanifest:12` |
| Word corpus | words.txt108,617B | Import parser reusable;dictionary provenance/quality not established by code. | `public/words.txt:1`, `server/services/wordsService.ts:79` |
| Sticker packs | 1,062 PNG+5 pack.json;50,690,362B total | Third-party character/art rights not proven by root Apache license. | `public/stickers/akig/pack.json:1`, `public/stickers/starrail/pack.json:1` |

Public inventory:1,072 files/50,850,163B total; sticker directories akavatar421files/17,878,252B,starrail456/20,465,207B,akig58/896,490B,akendfield2 65/5,462,685B,akendfield67/5,987,728B (each includes pack JSON).
Other public assets are two icons24,726B,favicon25,931B,words108,617B,manifest527B. Manifest name/short_name Talos II,description “ClassApp 学习与交流应用”,lang zh-CN,standalone,start_url/scope `/`,white colors. (`public/manifest.webmanifest:2`)

Top-level source coverage audit (all nonexcluded directories accounted for):

| Top-level entry | Accounted use / scope | Evidence |
|---|---|---|
| client/ | All components/screens in §3;data/offline/build §§4,8,9. | `client/main.tsx:1` |
| server/ | All route files §5,actions136 entries,schema60 tables,domain/runtime/storage. | `server/main.ts:16`, `server/http/handler.ts:275` |
| shared/ | Wire/API/event schemas,features/authority/access/sync/time/bytes helpers. | `shared/protocol/actions.ts:258`, `shared/features.ts:3` |
| launcher/ | Process/version manager,start scripts,rollback §10. | `launcher/launcher.ts:29` |
| lib/ | All six child libraries §§7,11. | `.gitmodules:1`, `lib/media/index.ts:1`, `lib/zstd-web/Cargo.toml:1` |
| public/ | PWA/icons/word corpus/five sticker packs inventoried above. | `public/manifest.webmanifest:2`, `server/infra/stickerLoader.ts:1` |
| scripts/ | Build/dev/operation/manual/unit/smoke/E2E entrypoints §§10,12. | `package.json:6` |
| docs/ | Product premise/architecture/foundations/offline/systems/engineering/decisions/reference;intent compared with implementation;excluded draft subtree untouched. | `docs/README.md:1`, `docs/product-context.md:5`, `docs/systems/ai-harness.md:63` |
| .github/ | Windows-release Actions workflow. | `.github/workflows/build-windows.yml:1` |
| .vscode/ | Stale rust-analyzer linkedProject infini2 path. | `.vscode/settings.json:2` |
| .git/ | Read-only HEAD/history/submodule metadata;no checkout/commit/mutation. | Survey baseline; `.gitmodules:1` |

Root files also accounted: README/ARCHITECTURE/AGENTS.old/CLAUDE are documentation,not governing instructions;LICENSE Apache2;package/package-lock dependency manifests;index/shell boot;four Vite configs;tsconfig and generated tsbuildinfo;eslint/prettier/editor ignore/config files.
Evidence: `README.md:1`, `ARCHITECTURE.md:1`, `AGENTS.old.md:1`, `CLAUDE.markdown:1`, `LICENSE:1`, `package.json:1`, `tsconfig.json:1`, `eslint.config.mjs:1`, `vite.config.ts:1`, `vite.server.config.ts:1`, `vite.bootstrap.config.ts:1`, `vite.launcher.config.ts:1`.
Generated tsconfig.tsbuildinfo is compiler metadata,not a runtime feature; .gitignore/.prettierignore/.prettierrc constrain development tooling,not user behavior.

## 15. Open questions

1. Which managed tablet/WebView builds,screen sizes,input devices and storage quotas are actually deployed? Code targets Chrome70 and documents70–80,but fleet inventory is outside allowed source. (`docs/product-context.md:5`, `vite.config.ts:70`)
2. Must the rewrite preserve hidden unlock,Back-to-lock and intentionally harsh learning copy,or are these legacy presentation choices? They are observable,not merely comments. (`client/components/auth/LockScreen.tsx:8`, `client/components/learning/WordLearningPage.tsx:186`)
3. What production reverse proxy/DNS/certificate enrollment arrangement supports concealed LAN+trusted HTTPS? Config/source describe mechanism,not installed topology. (`launcher/launcher.ts:74`, `scripts/operation/duckdns-certificate.md:1`)
4. Are all60 current tables populated in production,and what migration starting version must rewrite import? Runtime DB/ignored backups were not read. (`server/infra/db.ts:982`)
5. What backup procedure outside this repo protects immutable blobs/AI workspaces,if any? Built-in snapshots only preserve SQLite. (`server/infra/dbBackup.ts:59`)
6. Are stale WS bindings,identity collisions and arbitrary user-config keys actively relied on or observed as bugs? Static paths establish risk,not exploitation/production frequency. (`server/runtime/executorWorkerMain.ts:68`, `server/data/clients.ts:47`, `server/domain/facade/versionedUserConfig.ts:9`)
7. Which grant/capability revocation semantics should users expect: current held ownerless token remains valid after originating collection access is lost until expiry. (`server/services/ownerlessCapability.ts:44`)
8. Should base administrator retain group posting/read bypass despite narrower documented responsibility role? (`server/domain/facade/posts.ts:30`, `shared/authority.ts:28`)
9. Is cloud install used in production through some different path that avoids the observed flag guard? Runtime was not executed. (`server/runtime/update/runtime.ts:297`)
10. Do ZIP updates restore Linux modes through an external installer not represented here? Current extractor does not. (`server/runtime/update/archive.ts:130`)
11. Which native runtime/font/library versions are guaranteed on hosts,and what Windows versions are supported beyond x64/UCRT packaging? No complete OS support matrix found. (`lib/poppler/.github/workflows/pdfrender.yml:25`, `lib/poppler/utils/pdfrender.md:66`)
12. Is there a representative multilingual/math/encrypted/large-PDF corpus and visual correctness baseline elsewhere? Allowed tree contains generator,not checked-in PDFs. (`lib/poppler/examples/make-pdfrender-smoke-pdf.mjs:13`)
13. Should PDFs gain outlines/search/zoom/ink,or must rewrite preserve only current fit-width selectable pages? No implemented outline/thumbnail/annotation model found. (`lib/poppler/utils/pdfrender.cc:1090`, `client/components/articles/BundleArticleReader.tsx:347`)
14. What are legal/provenance constraints for novel mirrors,YouTube Music,stickers,word corpus and embedded API access? Source proves integration,not permission to redistribute content or credentials. (`lib/tomato/chapter.ts:48`, `lib/media/ytdlpProvider.ts:22`, `public/stickers/akig/pack.json:1`)
15. Are AI plan allowance units/prices,provider models and billing reset windows appropriate product policy,or current configuration? Secret provider config not inspected; code uses UTC daily/Monday weekly windows. (`server/data/ai.ts:648`, `server/infra/aiModels.ts:145`)
16. Must AI file tools expose a separate user file browser/export UI? Current surveyed UI presents conversations/attachments;server workspace API is tool-oriented. (`client/components/ai/AiView.tsx:391`, `server/services/ai/fileTools.ts:19`)
17. Are automatic music advance,global discipline timer and visibility-aware reading time missing intended features? Current observable implementations differ from common expectations. (`client/hooks/useMediaPlayer.ts:278`, `client/components/learning/Learning.tsx:83`, `client/hooks/useArticleReading.ts:16`)
18. Does offline local intent need stronger durability across quota/OS eviction/multiple tabs? Current persistent-storage helper unused and fallback file locks page-local. (`client/interact/quota.ts:102`, `client/data/files.ts:68`)
19. What operational installation supplies Playwright Chromium and POT dependencies on clean hosts? Build packages modules but browser provisioning is not established. (`scripts/builds/runtime-deps.mjs:17`, `lib/tomato/browser.ts:81`)
20. Should Office capture retain privacy-sensitive on-disk originals automatically,and should changed-open documents be recaptured? Current behavior is one snapshot per open path. (`server/runtime/teachDocumentsRuntime.ts:250`)

Verification record: all nonexcluded top-level directories are mapped above; all12 HTTP route files and all136 named actions appear in §5; every client component screen/dialog file appears in §3; all60 current SQL tables and all19 app+2 shell IndexedDB stores appear in §4.
Citation path/line checks and fifteen content spot-checks were performed after drafting; tests/builds were not executed and secrets/excluded directories were not inspected.
