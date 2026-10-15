# @talos/objectstore

Content-addressed storage with filesystem and memory backends. Design, guarantees and bulk
ingestion: `docs/impl/objects.md`. The runner-neutral `@talos/objectstore/testing` entry
exports `objectStoreConformanceTests(factory)` for any backend (fresh fixture per case with
`store`, `advanceTime(ms)` and `dispose()`); it is allowed in authorised consumers' tests only.
