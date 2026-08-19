#!/usr/bin/env bash
# Shared helpers for the per-channel package generators (Homebrew cask, AUR,
# Scoop, Flatpak). Source it, then call the functions below.
#
#   source "$(dirname "$0")/lib/release-assets.sh"
#   release_assets_init "$TAG"
#   sha="$(release_sha "Voltius_${VERSION}_amd64.deb")"
#
# Requires: gh (authenticated), awk.
#
# Every generator needs the same thing: the sha256 of a named release asset,
# read from the `<asset>.sha256` file the release job uploads beside it. Kept in
# one place so a change to the asset naming or the checksum format is made once
# rather than per channel.

# release_assets_init <tag>
# Sets TAG, REPO and VERSION, and prepares a scratch dir for the checksum files.
release_assets_init() {
  TAG="${1:?usage: release_assets_init <tag>}"
  REPO="${REPO:-VoltiusApp/voltius}"
  VERSION="${TAG#v}"
  _RA_TMP="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand _RA_TMP now, not when the trap fires
  trap "rm -rf '$_RA_TMP'" EXIT
  export TAG REPO VERSION
}

# release_asset <suffix>
# Prints the name of a release asset from its arch/format suffix, e.g.
#   release_asset amd64.deb      -> Voltius_0.27.0_amd64.deb
#   release_asset x64-setup.exe  -> Voltius_0.27.0_x64-setup.exe
# The `Voltius_<version>_` prefix is tauri-action's, and every generator would
# otherwise spell it out again.
release_asset() {
  printf 'Voltius_%s_%s' "$VERSION" "${1:?usage: release_asset <suffix>}"
}

# release_sha <asset-filename>
# Prints the sha256 of the named release asset. Fails when the checksum asset is
# missing rather than emitting an empty hash into a package manifest.
release_sha() {
  local name="${1:?usage: release_sha <asset-filename>}"
  local out="$_RA_TMP/$name.sha256"
  if [ ! -f "$out" ]; then
    gh release download "$TAG" -R "$REPO" -p "$name.sha256" -O "$out" >/dev/null
  fi
  local sha
  sha="$(awk '{print $1; exit}' "$out")"
  [ -n "$sha" ] || { echo "empty checksum for $name" >&2; return 1; }
  printf '%s' "$sha"
}

# release_url <asset-filename>
# Prints the public download URL of a release asset.
release_url() {
  printf 'https://github.com/%s/releases/download/%s/%s' \
    "$REPO" "$TAG" "${1:?usage: release_url <asset-filename>}"
}
