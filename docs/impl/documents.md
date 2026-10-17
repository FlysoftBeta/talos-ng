# Document pipeline

Packages: `@talos/docpack` (isomorphic pack format), `@talos/docpipe` (Node converters), the
server `library` module (import jobs, delivery), the client `reader` feature (viewer),
vendored renderer `vendor/pdfrender`. Entry points: `packages/docpack/src/index.ts`,
`packages/docpipe/src/index.ts`, `packages/docpipe/bin/docpipe.mjs` (CLI: `convert`,
`inspect`, `doctor`), `packages/server/src/modules/library`.

## Model

A document has an immutable optional **source** object (the uploaded file) and one
**rendition**: a **pack**, a single object holding everything a client needs to display it.
Packs are format independent and come in two kinds: `paged` (fixed-layout units with
intrinsic width/height: PDF) and `flow` (reflowable units: plain text, network novels; EPUB
would be one more converter emitting sanitised XHTML units). One storage, delivery, sync and
offline path therefore serves all formats.

Every imported document has a durable source and one pack. Failed conversions keep their
source for explicit retry; deleting the document releases source and pack.

## Pack format (TDP v1)

```
8 bytes "TDPACK1\n" | u32 BE manifestLen | manifest (UTF-8 JSON) | resources concatenated
```

Manifest: `{v:1, kind, title?, meta, units:[{ordinal,id,entry,deps:[rid],w?,h?,chars?,label?}],
shared:[rid], resources:{[rid]:{mime, enc:'raw'|'deflate', size, stored, offset}},
outline?:[{title, ordinal, level}]}`.

- `rid` is the hex SHA-256 of the **decoded** bytes: it dedups within and across documents on
  the client and is verified after decoding. `offset` is relative to the end of the manifest.
- `deflate` is raw DEFLATE, decodable with `fflate` in Chrome 70 and `node:zlib` on the
  server. Text-like MIME types (text, JSON, JS, XML/XHTML, SVG) are compressed only when it
  saves at least 10%; others stay raw. No zstd or WASM in the client: zstd output of the PDF
  renderer is decoded once on the server and re-encoded.
- Validation: contiguous ordinals, every reference resolves, offsets and sizes in bounds and
  non-overlapping, outline ordinals exist. Limits: 200,000 resources, 32 MiB manifest,
  512 MiB per resource. Inflation uses a fixed expected-size-plus-one buffer so output
  exceeding the declared size is detected and allocation is never attacker controlled.
- `PackWriter` streams to a sink through a spool (memory is one resource plus index);
  `PackReader` reads over a `RandomAccess` and can serve stored bytes (delivery) or decoded
  verified bytes. Delivery batches frame resources as `u32 length, 32-byte sha256, u8 enc,
  payload`.

## Converters (`@talos/docpipe`)

```ts
interface Converter { id; detect(head, name, mime?): boolean;
  convert(input: {path, name, mime?}, sink: PackSink, ctx: {signal, tmpDir, progress, log}) }
```

A registry detects in two passes: magic bytes first (names and MIME empty), then extension
and MIME. Output goes either to a caller-owned object sink or to a file (sibling temp file,
fsync, exclusive hard-link publish; an existing destination is never overwritten).

- **pdf**: runs the vendored `pdfrender` (`--resolution 96 --webp-quality 80 --jobs N`,
  N = ceil(cpus/2) clamped to 1-4) without a shell, in an isolated temp directory, through
  one shared runner with a FIFO queue and a two-process cap; the 30 minute timeout starts at
  spawn; Windows kills the tree with `taskkill /T /F`; stderr is bounded to 64 KiB; the output
  directory is removed on every exit path. The produced ZIP64 archive is validated strictly
  (local and central headers, offsets, STORED entries, sizes, CRCs, manifest fields,
  references, dictionary, no unindexed or overlapping data) and then **transcoded** one
  resource at a time into a `paged` pack. Fractional page sizes round up to integers.
  Exit 1 means invalid, empty or encrypted input (password-protected PDFs are rejected with
  `文档已加密，暂不支持`), exit 2 an integration failure.
- **text**: fatal UTF-8 (BOM) then fatal GB18030, NULs removed, newlines normalised,
  paragraph-first segmentation into units of about 8,000 UTF-16 units (cap 16,000, never
  splitting a surrogate pair), a chapter outline when headings are detectable; input up to
  512 MiB.

### Renderer binary

The renderer stays a vendored prebuilt binary with the current archive format: a source
build with progressive output would add three native build chains without a demonstrated
quality or latency gain. Resolution lives in one function (`resolvePdfRender`): an explicit
override option; else a packaged `vendor/pdfrender/target` file; else, in
development, `/etc/os-release` (Fedora/RHEL family selects the Red Hat flavour, other Linux
Debian). Only the chosen binary is probed (`--help`, two second limit, cached per resolver);
there is never a fallback to another flavour. Linux prepends the binary directory to
`LD_LIBRARY_PATH`. `docpipe doctor` reports target, binary and missing shared libraries.
Distribution targets and library requirements: `packaging.md`.

## Server import and delivery (`library`)

- Text and PDF attachments enter the registry through restartable `library.convert` jobs
  (`onBoot: requeue`; completed documents make reruns idempotent). The uploaded source is
  retained before enqueueing; publishing the pack, attaching ledger references and marking
  the document ready commit in one transaction. Source files are capped at 200 MiB. Network
  novel providers import generated text through the same seam (`importGeneratedText`,
  which commits the publication and the download checkpoint together).
- `library.doc.describe` returns small metadata and a download ticket without parsing the
  pack; clients open any valid pack with a ranged `PackReader`. `library.doc.open` returns
  the manifest without offsets and answers `E_TOO_LARGE` rather than overflowing the
  transport header (a delivery choice, not a document size limit). `library.doc.fetch`
  returns framed stored resources as the reply body, at most 512 KiB per reply; larger
  resources and retention downloads use ticketed `/dl/` range reads, with grants re-checked
  on every HTTP request.
- Access: collections are authority resources `coll:<id>`; delegation metadata caps issued
  permissions at the actor's own delegable level; the original uploader keeps ownership.
  Possession is not authority: recovery works only through a currently readable containing
  collection, favourites grant nothing, removed grants cannot mint tickets.

## Client viewing

The client stores resources by `rid` in the file store and decodes on use. The viewer
(`features/reader`) uses the id-based `@talos/virtual` scroller (`virtual-scroller.md`):
unit ids are stable anchors; page dimensions are known before resources are fetched; only
the visible window plus 600 px of overscan is mounted, and unmount aborts remaining work.

- `paged` units render through the reader's page renderer (`features/reader/renderer`)
  into one shadow root per page inside the scroll viewport, so scrolling, selection across
  pages and the virtual window are native. The page HTML is sanitised on the client: only
  the `main.page` subtree is kept, scripts, links, frames, event handlers and external URLs
  are removed, CSS loses `@import` and non-inline `url()`, and the only surviving link is
  an SVG `<use>` to a same-page `#id` (pdfrender draws every image through `<use>`).
  `data-bundle-ref` image slots become blob URLs created on mount and revoked on unmount;
  stylesheet resources are inlined into the shadow root; page scripts never run (the word
  width fitting they did is done by the renderer). The shadow host has `contain: layout
  paint`, so fixed positioning cannot escape a page.
- Paged packs record the pdfrender page format in `meta.renderFormat`
  (`RENDER_FORMAT` in `@talos/docpack`). Docpipe refuses an archive of another format with
  `E_UNAVAILABLE` (the vendored renderer and the expected format must change together). On
  `doc.open`/`doc.describe` the server re-queues conversion of a ready pack whose format
  differs (the document returns to processing); the client drops a cached manifest of
  another format, and retention releases the old pack once the server pack id changes.
- `flow` text units render as plain typography; a different viewport width reflows text and
  keeps relative depth within the visible unit. Saved text positions restore through a
  UTF-16 character anchor once the unit has loaded.
- Page input seeks by unit id; PDF zoom preserves the relative within-page offset.
- Reading position: resume is an LWW unit ordinal plus within-unit offset (text units also
  carry a UTF-16 offset and optional `charInset`, restored through DOM Range geometry to
  preserve the character's exact on-screen position); furthest is a Max unit
  ordinal; reading seconds are per-device counters accrued only while the viewer is visible
  and the app unlocked. Navigation guards flush the position before concealment.
- Offline opening requires a complete locally owned pack; units not downloaded show an
  explicit placeholder. Opening online in auto mode reads resources transiently and promises
  nothing offline.
