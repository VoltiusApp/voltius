#!/usr/bin/env bash
# Refresh the Microsoft Store listing screenshots from the docs repo captures.
#
# The Store listing needs its own copies: the docs repo is a separate checkout,
# the upload order is part of the listing, and a caption is tied to each file.
# Numbering is that order — the first one is what a browsing customer sees.
#
# Usage: copy-store-screenshots.sh [docs-screenshots-dir]
set -euo pipefail

SRC="${1:-$HOME/fourretout/voltius-dev/docs/docs/assets/screenshots}"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/packaging/msix/store-listing"

[ -d "$SRC" ] || { echo "no such directory: $SRC" >&2; exit 1; }

# source:destination, in upload order.
SHOTS=(
  "sftp-dual-pane.png:01-sftp-dual-pane.png"
  "folders-tags.png:02-folders-tags.png"
  "panes-grid.png:03-panes-grid.png"
  "command-palette.png:04-command-palette.png"
  "teams-roles.png:05-teams-roles.png"
  "themes-creator.png:06-themes-creator.png"
)

# Every source is checked before anything is removed. Failing partway through
# the copies would leave the listing directory holding some of the old set and
# some of the new, which only git could sort out.
missing=()
for shot in "${SHOTS[@]}"; do
  [ -f "$SRC/${shot%%:*}" ] || missing+=("$SRC/${shot%%:*}")
done
if [ ${#missing[@]} -gt 0 ]; then
  printf 'missing capture: %s\n' "${missing[@]}" >&2
  exit 1
fi

mkdir -p "$DEST"
rm -f "$DEST"/[0-9][0-9]-*.png

echo "copied into packaging/msix/store-listing:"
for shot in "${SHOTS[@]}"; do
  cp "$SRC/${shot%%:*}" "$DEST/${shot#*:}"
  echo "  ${shot#*:}"
done
