#!/usr/bin/env bash
# Render the Microsoft Store 2:3 poster art and the 1:1 app tile.
#
# Partner Center accepts the poster at exactly 720x1080 or 1440x2160, and the
# app tile at exactly 300x300, so both are produced here rather than resized by
# hand. Runs ImageMagick and rsvg-convert in a container: neither is needed on
# the host, and the alternative is a hand-edited binary nobody can regenerate.
#
# Usage: scripts/make-store-poster.sh
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

chown ${UID_GID} \"\$OUT/StoreLogo300x300.png\" \"\$OUT/StorePoster1440x2160.png\" \"\$OUT/StorePoster720x1080.png\"

echo 'wrote:'
magick identify -format '  %f  %wx%h\n' \
  \"\$OUT/StoreLogo300x300.png\" \"\$OUT/StorePoster1440x2160.png\" \"\$OUT/StorePoster720x1080.png\"
rm -rf \"\$TMP\"
"
