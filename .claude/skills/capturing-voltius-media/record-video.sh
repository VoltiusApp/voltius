#!/usr/bin/env bash
# Record a video of the headless Voltius app while a WebDriver "scene" script drives it.
# Runs INSIDE the tauri-headless container. Copy to /tmp, point SCENE at your scene .mjs.
#
#   docker cp record-video.sh tauri-headless:/tmp/  &&  docker cp scene.mjs tauri-headless:/tmp/
#   docker exec tauri-headless bash /tmp/record-video.sh scene.mjs out.mp4
#
# The scene .mjs must: reuse the session in $WDSID against localhost:$WDPORT, set the
# window to $W x $H at 0,0, and drive the UI. Emit an event->epoch timeline for keyed edits.
# See docs/tools/screenshots/capture.mjs for the WebDriver verb vocabulary to reuse.
set -e
SCENE="${1:?scene .mjs required}"
OUTNAME="${2:-out.mp4}"
: "${WDPORT:=4444}" "${WDSID:=/tmp/wd_sid}"
W=1200; H=800
OUT=/app/screenshots/video; mkdir -p "$OUT"; cd "$OUT"

# Derive DISPLAY/XAUTHORITY from the running app (Xvfb auth path regenerates each boot).
APPPID=$(pgrep -f target/debug/voltius | head -1)
export $(tr '\0' '\n' </proc/"$APPPID"/environ | grep -E '^(DISPLAY|XAUTHORITY)=')

# CRITICAL: verify compositing is disabled, else animations won't be captured.
tr '\0' '\n' </proc/"$APPPID"/environ | grep -q WEBKIT_DISABLE_COMPOSITING_MODE \
  || { echo "FATAL: app lacks WEBKIT_DISABLE_COMPOSITING_MODE=1 — animations will not record"; exit 1; }

# Record the exact window region. draw_mouse 0 (synthetic clicks don't move the cursor).
ffmpeg -y -loglevel error -f x11grab -draw_mouse 0 -video_size ${W}x${H} -framerate 30 \
  -i "${DISPLAY}+0,0" -c:v libx264 -preset ultrafast -qp 0 -pix_fmt yuv444p raw.mp4 &
FF=$!
sleep 1.0                          # let ffmpeg establish before the scene acts
WDPORT=$WDPORT WDSID=$WDSID node "/tmp/$SCENE"
sleep 0.5
kill -INT "$FF" 2>/dev/null || true; wait "$FF" 2>/dev/null || true

# Encode a clean web-friendly clip (trim 0.4s warm-up head). Silent, faststart.
ffmpeg -y -loglevel error -ss 0.4 -i raw.mp4 -vf format=yuv420p \
  -c:v libx264 -crf 21 -preset medium -movflags +faststart -an "$OUTNAME"
echo "wrote $OUT/$OUTNAME"

# Verify an animation actually recorded: luminance of a region must RAMP over several
# frames, not step once. Constant value across the whole clip => compositing not disabled.
#   ffmpeg -ss <t> -i "$OUTNAME" -vf "crop=W:H:X:Y,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null -
