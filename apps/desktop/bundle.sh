#!/usr/bin/env bash
# `pnpm bundle`: `tauri build`, with the arguments it is given. With the team's Developer ID
# certificate in the environment (`pnpm with-secrets -- pnpm bundle`, which loads it from 1Password,
# as cd.yml does in CI) the app is signed with it; without, it is ad-hoc signed, whatever identity
# the environment or a keychain happens to hold.
#
# Tauri does the keychain work itself: given APPLE_CERTIFICATE, it decodes the .p12 into a temporary
# directory, imports it into a keychain of its own (~/Library/Keychains/<16 letters and
# digits>.keychain-db), adds that to the user's search list without dropping an entry, signs with
# `codesign --keychain <it>`, and deletes it when the build ends, failed or not. It never changes
# the default keychain. What it misses, this script covers:
#
# - A signal kills the build before Tauri's cleanup, or a wrong password stops it after creating
#   the keychain but before listing it. The trap deletes every keychain of that shape that appeared
#   in ~/Library/Keychains during this build, which takes it off the search list too.
# - The decoded .p12 a killed build leaves behind: the build's TMPDIR is a directory of this
#   script's, removed by the same trap.
#
# A lock lets one signed JogPad build run at a time, so the keychain that appears is this build's.
# What it can't tell apart is another Tauri app's signed build starting at the same moment.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ -z "${MAC_NATIVE_APP_APPLE_CERTIFICATE:-}" ]]; then
  APPLE_SIGNING_IDENTITY=- exec pnpm exec tauri build "$@"
fi
if [[ -z "${MAC_NATIVE_APP_APPLE_CERTIFICATE_PASSWORD:-}" || -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Error: MAC_NATIVE_APP_APPLE_CERTIFICATE is set, but its password or APPLE_SIGNING_IDENTITY" >&2
  echo "isn't. Run pnpm -F @jogpad/desktop with-secrets -- pnpm bundle, which loads all three." >&2
  exit 1
fi

LOCK="${TMPDIR:-/tmp}/jogpad-signed-bundle.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Error: another signed JogPad build is running. If none is, remove $LOCK and try again." >&2
  exit 1
fi

tauri_keychains() {
  ls "$HOME/Library/Keychains" | grep -E '^[A-Za-z0-9]{16}\.keychain-db$' || true
}
KEYCHAINS_BEFORE="$(tauri_keychains)"
BUILD_TMPDIR="$(mktemp -d -t jogpad-bundle)"

clean_up() {
  local name
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    if ! printf '%s\n' "$KEYCHAINS_BEFORE" | grep -qxF "$name"; then
      security delete-keychain "$HOME/Library/Keychains/$name" || rm -f "$HOME/Library/Keychains/$name"
    fi
  done < <(tauri_keychains)
  rm -rf "$BUILD_TMPDIR" || true
  rmdir "$LOCK" || true
}
trap clean_up EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export APPLE_CERTIFICATE="$MAC_NATIVE_APP_APPLE_CERTIFICATE"
export APPLE_CERTIFICATE_PASSWORD="$MAC_NATIVE_APP_APPLE_CERTIFICATE_PASSWORD"
unset MAC_NATIVE_APP_APPLE_CERTIFICATE MAC_NATIVE_APP_APPLE_CERTIFICATE_PASSWORD
TMPDIR="$BUILD_TMPDIR" pnpm exec tauri build "$@"
