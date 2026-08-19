#!/usr/bin/env bash
# Render the Microsoft Store art that `tauri icon` does not produce.
#
# Two listing assets — Partner Center accepts the poster at exactly 720x1080 or
# 1440x2160, and the app tile at exactly 300x300 — plus one package asset:
# Wide310x150Logo. `tauri icon` emits only square logos, and makeappx rejects
# the package outright if DefaultTile declares Square310x310Logo without the
# wide one:
#
#   error 80080204: App manifest validation error: The DefaultTile element must
#   specify the Wide310x150Logo attribute if the Square310x310Logo attribute is
#   specified.
#
# Runs ImageMagick and rsvg-convert in a container: neither is needed on the
# host, and the alternative is hand-edited binaries nobody can regenerate.
#
# Usage: scripts/make-store-assets.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UID_GID="$(id -u):$(id -g)"

docker run --rm -v "$REPO_ROOT:/w" -w /w alpine:latest sh -euc "
apk add --no-cache imagemagick rsvg-convert >/dev/null 2>&1

OUT=packaging/msix/store-listing
mkdir -p \"\$OUT\"
TMP=\$(mktemp -d)

# The 1:1 app tile, from the 512x512 app icon.
magick src-tauri/icons/icon.png -resize 300x300 \
  -background none -gravity center -extent 300x300 \"\$OUT/StoreLogo300x300.png\"

# The wide Start tile. Transparent behind the mark, matching the square logos
# tauri emits: the manifest sets BackgroundColor=\"transparent\", so Windows
# paints the accent colour behind it. 110px leaves the tile breathing room
# rather than filling its whole height.
magick src-tauri/icons/icon.png -resize 110x110 \
  -background none -gravity center -extent 310x150 \
  src-tauri/icons/Wide310x150Logo.png

# Bolt at 700px wide; logo.svg is 466x766, so height lands at ~1150.
rsvg-convert -w 700 logo.svg -o \"\$TMP/bolt.png\"

# Flat brand background, sampled from the app icon.
magick -size 1440x2160 xc:'#010318' \"\$TMP/bg.png\"

# Glow behind the mark. The outer stop MUST be black: this is composited with
# 'screen', under which black contributes nothing, so the glow's bounding box
# fades out invisibly. An outer stop of #010318 instead lifts every pixel inside
# the box and leaves a hard horizontal seam where the box ends.
magick -size 1440x1440 radial-gradient:'#2A5FA8-black' \"\$TMP/glow.png\"
magick \"\$TMP/bg.png\" \"\$TMP/glow.png\" -geometry +0+0 -compose screen -composite \"\$TMP/base.png\"

# 370 = (1440 - 700) / 2. 145 puts the bolt's centre at y=720, the middle of the
# top two-thirds — the Store draws text overlays across the bottom third, so
# nothing important may sit there.
magick \"\$TMP/base.png\" \"\$TMP/bolt.png\" -geometry +370+145 -compose over -composite \
  \"\$OUT/StorePoster1440x2160.png\"

magick \"\$OUT/StorePoster1440x2160.png\" -resize 720x1080! \"\$OUT/StorePoster720x1080.png\"

chown ${UID_GID} \"\$OUT/StoreLogo300x300.png\" \"\$OUT/StorePoster1440x2160.png\" \
  \"\$OUT/StorePoster720x1080.png\" src-tauri/icons/Wide310x150Logo.png

echo 'wrote:'
magick identify -format '  %f  %wx%h\n' \
  \"\$OUT/StoreLogo300x300.png\" \"\$OUT/StorePoster1440x2160.png\" \
  \"\$OUT/StorePoster720x1080.png\" src-tauri/icons/Wide310x150Logo.png
rm -rf \"\$TMP\"
"
