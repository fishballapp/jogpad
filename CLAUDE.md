# JogPad notes for Claude

## Releasing

When asked to release a beta (or any version): bump the version in
`apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock`, add
the `## <version>` CHANGELOG.md section (the workflow refuses tags without
one), commit, tag `v<version>`, push, wait for the release workflow, then
**publish the draft release** (`gh release edit v<version> --draft=false`).
Do not stop at the draft — publishing is part of the ask.

Every push to main also builds and publishes a dev release on its own
(`<package.json version>.dev.<commit count>`), served to the Dev update
channel via `dev.json`. Nothing to do there, but a red release workflow on
main means the dev track has stopped.

## Known follow-ups and traps

- Drag-to-reorder has no keyboard path (dnd-kit `PointerSensor` only). Flagged
  by review, deferred: a `KeyboardSensor` needs focusable rows, which fights
  the panel's window-level keyboard model.
- `check_on_copy` / `group_done` default to true, but anyone who ran
  0.1.5-beta.2 has explicit `false` saved in prefs.json, so the new default
  never reaches them.
- With done-grouping on, dragging a mixed done/undone selection moves one block
  in the file, then re-partitions on screen. Deliberate.
- Rename and delete in the ⌘K page palette are pointer-only, for the same
  reason as drag-to-reorder: the palette's input owns every key.
- The notes parser keeps only `## ` headings and `- ` bullets and drops every
  other line on the next save. With a Dev channel, any change to the file
  format makes switching back to Beta lossy. Put new constructs inside item
  text, where an old build keeps them as words, or make the parser carry
  unknown lines through first.
- `docs/` is gitignored. Edits there are local notes, never part of a diff or a
  review. `docs/product/DECISIONS.md` says it is append-only — supersede an
  entry, do not rewrite it.
- Repo-wide renames need BSD word boundaries (`[[:<:]]x[[:>:]]`); `\b` in
  `sed -i ''` matches nothing and fails silently. Watch out for "section"
  inside "selection".
- Tauri argument names are the one rename the type checker cannot catch: the
  keys in `invoke('cmd', {...})` must match the Rust parameter names exactly.
  Diff the two lists by hand.
- aibridge review delegates run with shell access and may revert uncommitted
  files they judge out of scope (one reverted a CHANGELOG edit). Re-check the
  working tree after a review run.

## Installing a local build for testing

`pnpm build --bundles app` in `apps/desktop` with
`APPLE_SIGNING_IDENTITY="Developer ID Application: Fishball Ltd (9CWXH66CKT)"`
exported. The identity is already in the keychain. Without it the build is
ad-hoc signed, and macOS then ties Accessibility and Input Monitoring to the
binary hash, so every rebuild silently loses both grants. The updater artifact
step fails without `TAURI_SIGNING_PRIVATE_KEY`; the `.app` is already built by
then and that is all a local install needs. Quit JogPad, copy the bundle over
`/Applications/JogPad.app`, `open` it.

## Toolchain gotcha

The `cargo` on PATH is an outdated pkgx shim (1.81) that cannot build the deps.
Use the rustup toolchain instead:
`PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo …`
An env prefix only covers the first command, so export it when chaining with
`&&` or clippy silently falls back to the shim.

## Front-end checks without a Rust build

`npx vite --port 5199` from the repo root serves the UI against the fixture in
`lib/api.ts`, which stubs every command. Chrome DevTools MCP can then drive the
real components. That is how the page palette's rename and delete were checked.
