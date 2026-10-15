# @talos/docpipe

Node document converters (PDF via the vendored `pdfrender`, text) that emit TDP packs. Design:
`docs/impl/documents.md`. Developer CLI:

```text
node packages/docpipe/bin/docpipe.mjs convert <input> <output.tdp>
node packages/docpipe/bin/docpipe.mjs inspect <pack.tdp>
node packages/docpipe/bin/docpipe.mjs doctor
```

Real-binary tests are mandatory unless `TALOS_SKIP_PDFRENDER=1` is set. System libraries for
the renderer: `vendor/pdfrender/README.md`.
