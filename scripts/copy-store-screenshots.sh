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

mkdir -p "$DEST"
rm -f "$DEST"/[0-9][0-9]-*.png

copy() {
  local src_name="$1" dest_name="$2"
  [ -f "$SRC/$src_name" ] || { echo "missing capture: $SRC/$src_name" >&2; exit 1; }
  cp "$SRC/$src_name" "$DEST/$dest_name"
  echo "  $dest_name"
}

echo "copied into packaging/msix/store-listing:"
copy sftp-dual-pane.png    01-sftp-dual-pane.png
copy folders-tags.png      02-folders-tags.png
copy panes-grid.png        03-panes-grid.png
copy command-palette.png   04-command-palette.png
copy teams-roles.png       05-teams-roles.png
copy themes-creator.png    06-themes-creator.png
