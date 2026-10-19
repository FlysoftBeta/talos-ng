# Implementation documents

How Talos II is built. Product behaviour is in `docs/product/README.md`, process history in
`docs/tasks/`.

| Document | Covers |
|---|---|
| [architecture.md](architecture.md) | premises, packages and direction, runtime topology, tooling |
| [structure.md](structure.md) | repository layout, import rules, SQL ownership, model/connect/view contract |
| [link.md](link.md) | link transport, API contract, error codes, HTTP gateway, operation replay |
| [sync.md](sync.md) | scopes and revisions, windows, conflict rules, outbox, client sync engine |
| [virtual-scroller.md](virtual-scroller.md) | id-based sources, anchoring, windows, DOM measurement and browser verification |
| [client-store.md](client-store.md) | IndexedDB engine, FileStore, client database, retention and eviction |
| [objects.md](objects.md) | object store, ledger and GC, uploads, bulk ingestion |
| [documents.md](documents.md) | pack format, converters, pdfrender, delivery, viewer |
| [jobs.md](jobs.md) | durable jobs and the task projection |
| [user-purge.md](user-purge.md) | atomic user deletion across modules |
| [server.md](server.md) | process model, kernel services, data conventions, configuration |
| [identity.md](identity.md) | credentials, devices and admission, authority |
| [modules.md](modules.md) | per-module mechanisms (community, chat, netbooks, media, AI, admin, ops) |
| [client-runtime.md](client-runtime.md) | runtime ports, features, repositories, navigation, design system |
| [client-features.md](client-features.md) | per-feature client mechanisms |
| [design-system.md](design-system.md) | tokens, UI primitives, frame and pane anatomy, feature stylesheets |
| [chrome70-compat.md](chrome70-compat.md) | Chrome 70 floor, polyfills, compatibility gate |
| [packaging.md](packaging.md) | shell boot and updates, launcher, release assembly |
| [e2e-hooks.md](e2e-hooks.md) | selector contract between UI and end-to-end scenarios |
| [ops-migrate.md](ops-migrate.md) | legacy data migration tool: operator guide |
| [ops-performance.md](ops-performance.md) | performance budgets and measurements |
