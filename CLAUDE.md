# JogPad notes for Claude

## Releasing

When asked to release a beta (or any version): bump the version in
`apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock`, add
the `## <version>` CHANGELOG.md section (the workflow refuses tags without
one), commit, tag `v<version>`, push, wait for the release workflow, then
**publish the draft release** (`gh release edit v<version> --draft=false`).
Do not stop at the draft — publishing is part of the ask.

## Toolchain gotcha

The `cargo` on PATH is an outdated pkgx shim (1.81) that cannot build the deps.
Use the rustup toolchain instead:
`PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo …`
