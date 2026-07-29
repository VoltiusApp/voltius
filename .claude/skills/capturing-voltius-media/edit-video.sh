#!/usr/bin/env bash
# ffmpeg editing recipes for headless captures. All run in-container (ffmpeg is there).
# These are reference recipes — copy the one you need; don't run this file wholesale.
set -e
IN="${1:-raw.mp4}"

# ── Crop to a sub-region (e.g. drop a panel out of frame) ─────────────────────────────
# ffmpeg -y -i "$IN" -vf "crop=W:H:X:Y,format=yuv420p" -c:v libx264 -crf 21 -movflags +faststart -an crop.mp4

# ── Clean web encode (silent, loop-friendly) ─────────────────────────────────────────
# ffmpeg -y -i "$IN" -vf format=yuv420p -c:v libx264 -crf 21 -preset slow -movflags +faststart -an clean.mp4

# ── Smooth KEYED ZOOM (punch-in on a UI element, hold, ease out) ─────────────────────
# Use zoompan, NOT crop: crop evaluates w/h once at config time and CANNOT animate with t.
# Supersample 2x first so the moving crop doesn't shimmer. t = on/30 (output frame / fps).
# Center on the ORIGINAL point (CX,CY); at 2x that's (2*CX, 2*CY). ZMAX = peak zoom.
# Ease in over [T_IN, T_IN+D], hold, ease out over [T_OUT, T_OUT+D] (smoothstep).
CX=780; CY=450; ZMAX=1.6; TIN=5.3; TOUT=12.9; D=0.9
UIN="clip((on/30-$TIN)/$D\,0\,1)"; UOUT="clip((on/30-$TOUT)/$D\,0\,1)"
Z="1+($ZMAX-1)*($UIN*$UIN*(3-2*$UIN))-($ZMAX-1)*($UOUT*$UOUT*(3-2*$UOUT))"
# ffmpeg -y -i "$IN" -filter_complex \
# "scale=2400:1600:flags=bicubic,\
# zoompan=z='$Z':x='clip($((2*CX))-(iw/zoom)/2\,0\,iw-iw/zoom)':y='clip($((2*CY))-(ih/zoom)/2\,0\,ih-ih/zoom)':d=1:fps=30:s=1200x800,\
# format=yuv420p" -c:v libx264 -crf 20 -preset medium -movflags +faststart -an zoom.mp4

# ── Trim ─────────────────────────────────────────────────────────────────────────────
# ffmpeg -y -ss START -to END -i "$IN" -c copy trimmed.mp4   # or re-encode if cuts must be frame-exact

# ── Verify an animation is present (luminance must ramp, not step once) ───────────────
# ffmpeg -ss T -t 1.4 -i "$IN" -vf "crop=W:H:X:Y,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - \
#   2>/dev/null | grep -o "YAVG=[0-9.]*" | uniq
echo "reference recipes — see comments; adapt CX/CY/ZMAX/TIN/TOUT for zoom"
