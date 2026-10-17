# Vendored pdfrender

Unmodified CI artifacts of the pdf-render project, laid out as the former `lib/poppler-prebuilt`
platform payloads. `manifest.json` preserves upstream CI provenance and artifact
checksums: FlysoftBeta/pdf-render, commit
`9b6f190656501c4f0f37e167c0a976cc6c53e3ad`, run 39002781402 (2026-10-17).
The format documentation from the Debian payload is retained as `FORMAT.md`;
per-platform documentation duplicates and the example parser are omitted.

This renderer is GPL-2.0-or-later software. `COPYING`, `COPYING3`, third-party
licenses, runtime DLLs, and `share/poppler` data remain alongside each binary.
Distributors must satisfy the applicable GPL source-distribution obligations;
upstream source provenance is recorded in the manifest. This directory does
not relicense the renderer or its bundled dependencies.

Invoke through `@talos/docpipe` without a shell:

```text
pdfrender --resolution 96 --webp-quality 80 --jobs N input.pdf output.zip
```

N is ceil(available CPUs / 2), clamped to 1–4. Windows ships the executable and
its non-system runtime DLLs. Both Linux executables are tracked as executable. Release assembly must preserve
that permission; docpipe does not change executable modes at runtime. Always
keep each executable with its own `share/poppler` tree.

Linux payloads dynamically link system libraries and are not interchangeable:

- Debian/Ubuntu build (Ubuntu 24.04): glibc, libstdc++, Cairo, fontconfig,
  FreeType, libjpeg ABI 8, OpenJPEG, WebP, zstd, zlib, PNG and their transitive
  libraries. Typical packages: libcairo2, libfontconfig1, libfreetype6,
  libjpeg-turbo8, libopenjp2-7, libwebp7, libzstd1, zlib1g, libpng16-16t64,
  libstdc++6, libc6.
- Red Hat build (Fedora 44): corresponding cairo, fontconfig, freetype,
  libjpeg-turbo, openjpeg2, libwebp, libzstd, zlib-ng-compat (or compatible zlib),
  libpng, libstdc++, glibc packages. Older distro ABIs may not satisfy the build.

Install suitable fonts for PDFs using unembedded/fallback fonts. Releases have exact
targets `win32-x64`, `linux-debian-x64`, and `linux-redhat-x64`. Each contains
only its matching directory and a package-time `target` selection file.
Docpipe never searches for another flavour when that binary fails. In development,
`/etc/os-release` selects Red Hat for Fedora/RHEL-family hosts and Debian otherwise.
An explicit path or `TALOS_PDFRENDER` overrides the binary path. Linux prepends
that binary's directory to `LD_LIBRARY_PATH`.

Run `node packages/docpipe/bin/docpipe.mjs doctor` in a checkout: it reports target,
binary and startup status; failures include missing shared libraries and installation
guidance. Use the packages below for the chosen distribution, or supply a compatible
binary through the override. A different target's update is refused by the launcher
and server.

## Dynamic library inventory

`readelf -d` and `ldd` were run on both vendored ELF files on the Fedora
implementation host. The following are **direct** `DT_NEEDED` entries. Each
row gives the Debian/Ubuntu and Fedora/RHEL runtime package normally providing
that SONAME; package names can vary with distribution release.

| SONAME                               | Debian/Ubuntu package                       | Fedora/RHEL package                        |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------ |
| libcairo.so.2                        | libcairo2                                   | cairo                                      |
| libzstd.so.1                         | libzstd1                                    | libzstd                                    |
| libwebp.so.7                         | libwebp7                                    | libwebp                                    |
| libjpeg.so.8 (Debian flavour only)   | libjpeg-turbo8                              | libjpeg-turbo (only if ABI 8 is available) |
| libjpeg.so.62 (Red Hat flavour only) | libjpeg62-turbo                             | libjpeg-turbo                              |
| libz.so.1                            | zlib1g                                      | zlib-ng-compat / zlib                      |
| libfreetype.so.6                     | libfreetype6                                | freetype                                   |
| libfontconfig.so.1                   | libfontconfig1                              | fontconfig                                 |
| libopenjp2.so.7                      | libopenjp2-7                                | openjpeg                                   |
| libpng16.so.16                       | libpng16-16t64 (Ubuntu 24.04) / libpng16-16 | libpng                                     |
| libstdc++.so.6                       | libstdc++6                                  | libstdc++                                  |
| libm.so.6, libc.so.6                 | libc6                                       | glibc                                      |

`ldd` additionally showed these **transitive** SONAMEs on this host, for both
flavours: `libX11.so.6` (libx11-6 / libX11), `libXext.so.6` (libxext6 / libXext),
`libXrender.so.1` (libxrender1 / libXrender), `libxcb.so.1`,
`libxcb-render.so.0`, `libxcb-shm.so.0` (libxcb1 / libxcb),
`libpixman-1.so.0` (libpixman-1-0 / pixman), `libsharpyuv.so.0`
(libsharpyuv0 / libwebp), `libbz2.so.1` (libbz2-1.0 / bzip2-libs),
`libharfbuzz.so.0` (libharfbuzz0b / harfbuzz), `libbrotlidec.so.1` and
`libbrotlicommon.so.1` (libbrotli1 / libbrotli), `libxml2.so.2` (libxml2 /
libxml2), `libgcc_s.so.1` (libgcc-s1 / libgcc), `libXau.so.6`
(libxau6 / libXau), `libglib-2.0.so.0` (libglib2.0-0t64 / glib2),
`libgraphite2.so.3` (libgraphite2-3 / graphite2), `liblzma.so.5`
(liblzma5 / xz-libs), and `libpcre2-8.so.0` (libpcre2-8-0 / pcre2).
The ELF interpreter is `ld-linux-x86-64.so.2` from libc6 / glibc. The
transitive set is host-specific and can differ on Debian/Ubuntu.

All direct Red Hat dependencies resolved on this host and `--help` exited 0.
The Debian flavour's `libjpeg.so.8` was missing here, so no further startup or
render verification was possible for it on this host. The SONAME and package
mapping are inventory data, not a claim that every named distro release ships
compatible versions. Run `docpipe doctor` on the target host.

Windows carries `pdfrender.exe`, `share/poppler`, and these non-system DLLs:
`libbrotlicommon.dll`, `libbrotlidec.dll`, `libbz2-1.dll`, `libcairo-2.dll`,
`libexpat-1.dll`, `libfontconfig-1.dll`, `libfreetype-6.dll`,
`libgcc_s_seh-1.dll`, `libglib-2.0-0.dll`, `libgraphite2.dll`,
`libharfbuzz-0.dll`, `libiconv-2.dll`, `libintl-8.dll`, `libjpeg-8.dll`,
`libopenjp2-7.dll`, `libpcre2-8-0.dll`, `libpixman-1-0.dll`,
`libpng16-16.dll`, `libsharpyuv-0.dll`, `libstdc++-6.dll`,
`libwebp-7.dll`, `libwinpthread-1.dll`, `libzstd.dll`, and `zlib1.dll`
(inventory verified from the vendored directory; Windows execution was not
tested here).
