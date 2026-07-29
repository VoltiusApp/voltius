#!/usr/bin/env bash
# Frame a captured clip with the Voltius brand gradient — matches the docs screenshots
# (navy->lift gradient + top-left glow, rounded floating window + drop shadow, 1600px wide).
# Reuses the docs frame.py as the single source of truth for the brand look.
#
# Runs IN-CONTAINER (needs ffmpeg + python3-pil, both in Dockerfile.tauri-headless).
# Prereq — copy the brand-framing files into /tmp first:
#   docker cp ../docs/tools/screenshots/frame.py tauri-headless:/tmp/frame.py
#   docker cp .claude/skills/capturing-voltius-media/frame_video.py tauri-headless:/tmp/
#   docker cp .claude/skills/capturing-voltius-media/frame-video.sh  tauri-headless:/tmp/
#   docker exec tauri-headless bash /tmp/frame-video.sh /app/screenshots/video/in.mp4 out.mp4
set -e
IN="${1:?input mp4}"; OUT="${2:-framed.mp4}"
read W H < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=' ' "$IN")
META=$(cd /tmp && python3 frame_video.py "$W" "$H" /tmp)          # writes /tmp/frame_bg.png + /tmp/frame_mask.png
PAD=$(echo "$META" | python3 -c 'import sys,json;print(json.load(sys.stdin)["pad"])')
TW=$(echo "$META"  | python3 -c 'import sys,json;print(json.load(sys.stdin)["target_w"])')
# Round the video's corners (alphamerge with the mask), overlay onto the brand background,
# scale to target width. shortest=1 so the looped bg/mask images end with the video.
ffmpeg -y -loglevel error -i "$IN" -loop 1 -i /tmp/frame_bg.png -loop 1 -i /tmp/frame_mask.png \
 -filter_complex "[2:v]format=gray[m];[0:v]format=rgba[v];[v][m]alphamerge[rv];\
[1:v][rv]overlay=${PAD}:${PAD}:shortest=1[c];[c]scale=${TW}:-2,format=yuv420p" \
 -c:v libx264 -crf 20 -preset medium -movflags +faststart -an "$OUT"
echo "framed -> $OUT"
