# Platform config overlays (`tauri.<platform>.conf.json`)

This file exists because **the config files themselves cannot explain
themselves.** That is not a style preference; it is enforced, and getting it
wrong breaks the build outright.

## Never put a comment key in a Tauri config

JSON has no comments, and Tauri's `Config` is declared
`#[serde(rename_all = "camelCase", deny_unknown_fields)]`
(`tauri-utils-2.9.3/src/config.rs:3586`). The CLI merges the platform overlay
into the base config as raw JSON and *then* deserializes the merged value, so
an unknown key anywhere in either file fails the whole parse.

`$schema` is not a counter-example. It survives only because `Config` gives it
an explicit field: `#[serde(rename = "$schema")] pub schema: Option<String>`
(`config.rs:3589`). There is no such field for `$comment`, or for any other
invented key.

Measured on the real toolchain:

```
$ npx tauri info      # with a top-level "$comment" array present
Error `"tauri.conf.json"` error: Additional properties are not allowed
      ('$comment' was unexpected)

$ npx tauri info      # identical file, comment key removed
(no error)
```

The failure is total — the build dies before cargo runs, so the outcome is
**no installer at all**, which is worse than the payload bug the overlay was
written to fix. `tests/contract/tauri-platform-config.test.js` now fails the
suite if a comment key comes back.

## Why `speech-assets/` is removed on Windows

Nothing in it can run there:

- `tts/python` is a Mach-O **arm64** CPython. Measured: `bin/python3` reports
  "Mach-O 64-bit executable arm64", and the tree carries 5 `.dylib`, 25 `.so`
  and **zero** `.pyd` — nothing in it is loadable by a Windows interpreter.
- The STT engine is absent on *every* platform: all three `whisper-cli` rows
  in `SPEECH-INVENTORY.json` are `sha256Status: absent`, so the 31 MB model
  has nothing to run it.

That left roughly 378 MB shipping inside the NSIS installer that could never
execute. Windows speech is covered instead by the WR-016 system voice, which
uses the synthesizer already on the machine and needs no bundled assets.

## How the removal works

Tauri merges the overlay using **JSON Merge Patch (RFC 7396)**, where a `null`
VALUE removes a key. `bundle.resources` in the base config is a *map*, so the
null drops exactly that one entry. (Had it been the array form, the patch
would have replaced the whole list instead — check the shape before copying
this pattern.)

## Staging

`src-tauri/` is gitignored, and Tauri reads the overlay from the same
directory as the base config. Two paths stage it, and both are needed:

- `src-tauri/build.rs` mirrors the base config **and every platform overlay**,
  which covers a direct `cargo tauri build`.
- `scripts/stage-tauri-config.mjs`, run by `npm run tauri:build`.

`build.rs` originally mirrored only `tauri.conf.json`. A build invoked as
`cargo tauri build` therefore *succeeded* with no overlay at all and silently
re-shipped the 378 MB — a packaging bug that fails in the success direction.

## Still unverified

There is no Windows machine on this project. No Windows bundle has ever been
produced. What is verified is the config parse (above) and that the overlay
does not affect macOS: the CLI reads only the overlay matching the build
target, and a fresh macOS bundle still carries the full 378 MB.
