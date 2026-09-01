# JogPad notes for Claude

## Releasing

When asked to release a beta (or any version): bump the version in
`apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock`, add
the `## <version>` CHANGELOG.md section (the workflow refuses tags without
one), commit, tag `v<version>`, push, wait for the release workflow, then
**publish the draft release** (`gh release edit v<version> --draft=false`).
Do not stop at the draft — publishing is part of the ask.

## Known follow-ups and traps

- Drag-to-reorder has no keyboard path (dnd-kit `PointerSensor` only). Flagged
  by review, deferred: a `KeyboardSensor` needs focusable rows, which fights
  the panel's window-level keyboard model.
- `check_on_copy` / `group_done` default to true, but anyone who ran
  0.1.5-beta.2 has explicit `false` saved in prefs.json, so the new default
  never reaches them.
- With done-grouping on, dragging a mixed done/undone selection moves one block
  in the file, then re-partitions on screen. Deliberate.
- aibridge review delegates run with shell access and may revert uncommitted
  files they judge out of scope (one reverted a CHANGELOG edit). Re-check the
  working tree after a review run.

## Toolchain gotcha

The `cargo` on PATH is an outdated pkgx shim (1.81) that cannot build the deps.
Use the rustup toolchain instead:
`PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo …`
