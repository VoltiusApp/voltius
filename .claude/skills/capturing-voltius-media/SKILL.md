---
name: capturing-voltius-media
description: Use when producing screenshots or videos of the Voltius app UI for docs, blog posts, changelog, or demos — capturing or recording the live headless dev build and editing the result (crop, zoom, loop) with ffmpeg.
---

# Capturing Voltius Media (screenshots & video)

Produce real screenshot and video assets of the Voltius desktop app by driving the
**headless dev build** and screen-grabbing its Xvfb framebuffer. Same stack as
[[iterating-on-voltius-ui]] (`compose.headless.yml`: `tauri-headless` = app + Xvfb +
tauri-driver on 4444; `ssh-host-1` = throwaway SSH host `voltius`/`voltius`).

**Path note:** the screenshot pipeline and brand framing live in the **docs sibling repo**,
`../docs/tools/screenshots/` — one level *up* from the voltius repo (there is no `docs/`
inside voltius). All references below are to that sibling path.

## ⚠️ The one thing that will silently ruin captures

**WebKitGTK renders opacity/transform animations (CSS transitions, `animate-fadeIn`,
dropdown/modal open) on GPU compositor layers. Under Xvfb's software path those layers
are NOT flushed to the X framebuffer that a screen grab reads** — so recordings show
**instant jumps with no transitions**, and a screenshot taken mid-animation shows the
pre-animation state. There is no error; it just looks wrong.

**Fix: run the app with `WEBKIT_DISABLE_COMPOSITING_MODE=1`.** It's baked into
`compose.headless.yml` (`tauri-headless` `environment:`). Verify before trusting a capture:

```bash
docker exec tauri-headless sh -c 'pid=$(pgrep -f target/debug/voltius|head -1); \
  tr "\0" "\n" </proc/$pid/environ | grep WEBKIT_DISABLE_COMPOSITING_MODE' || echo "MISSING — recompose"
```

**Always confirm a transition actually recorded** (this check is manual — the scripts
don't run it for you). Sample per-frame luminance with `signalstats` YAVG and require a
*ramp* over several frames, not a single step:
- **Crop over the element that animates** (the modal / dropdown / palette) — NOT the
  backdrop. The dimming backdrop often fades in ~1 frame and reads as a step even when the
  element ramps, so a backdrop crop gives a false negative.
- Find the moment `T` from the timeline your scene logs: `T ≈ event_epoch −
  record_start_epoch (+ ~1.0s warm-up − any head trim)`. Or just scan all frames.
- A constant value across the whole clip ⇒ compositing was NOT disabled. Command in
  `record-video.sh` / `edit-video.sh`.

## Screenshots (stills)

Use the existing pipeline — do not reinvent it: `../docs/tools/screenshots/`
(`run.sh`, `shots.json` manifest, `capture.mjs`, `frame.py`). It seeds state, dismisses the
dev banner, drives tauri-driver, frames the raw PNG (brand gradient), and injects into docs.
From the docs repo: `./tools/screenshots/run.sh [shot-id ...]`. Add a new shot = add an
entry to `shots.json`.

## Video

Three moving parts, all inside the container: **record** (ffmpeg x11grab) + **drive**
(WebDriver) + **edit** (ffmpeg). Templates: `record-video.sh`, `edit-video.sh` (copy into
`/tmp`, adapt the scene).

1. **Driving = same WebDriver as the screenshot pipeline.** Reuse the verb vocabulary in
   `../docs/tools/screenshots/capture.mjs` (`clickAt`, `clickText`, `evalJs`, `setVal`,
   `keyCombo` for chords like Ctrl+K, `seedHost`, …). tauri-driver allows **one** session:
   - Reuse the live one via the id in `/tmp/wd_sid`. **If that file is absent**, a prior
     run may have left it in `/tmp/wd_sid*` (e.g. `wd_sid2`) — check those; else create a
     fresh session (capture.mjs's `ensureSession` does this and writes `/tmp/wd_sid`).
     There is no list-sessions endpoint — `/status` only says whether one exists, not its id.
   - If the `tauri-docker` MCP holds it (`{"ready":false,"message":"A session already
     exists"}`), stop the MCP (`pkill -f mcp-tauri-automation`) — the session and app
     survive; then reuse its id. You do NOT need the MCP in your Claude session; drive
     `tauri-driver` directly over HTTP.
   - `record-video.sh` runs the scene as `node /tmp/<scene>` — put the scene .mjs directly
     in `/tmp` and pass a **bare filename**, not a path.
2. **Recording.** ffmpeg `x11grab` on the app's display. Derive `DISPLAY`/`XAUTHORITY`
   from the running app process (the Xvfb auth path regenerates per boot). Grab the exact
   window region (set the window to a known size first, e.g. `1200x800@0,0`). See
   `record-video.sh` — it also logs an `event → epoch` **timeline** so edits can key zooms
   to real moments.
3. **Editing = ffmpeg only.** `edit-video.sh` has the recipes: crop, **smooth keyed zoom
   via `zoompan`** (NOT `crop` — `crop` evaluates `w`/`h` once at config time, so it can't
   animate; `zoompan` can), supersample-then-downscale to kill zoom shimmer, clean loop,
   and web encode (`-pix_fmt yuv420p -movflags +faststart`, silent).

Blog `<video>` tags want silent looping H.264 at the app's native window size.

## Framing (brand gradient — match the docs media)

Docs/blog assets sit on the brand look: navy→lift vertical gradient + a faint top-left
accent glow, the app as a rounded floating window with a drop shadow, 1600px wide. For
stills this is `../docs/tools/screenshots/frame.py`; **reuse it — don't reinvent the
colors** (it's the single source of truth; brand tweaks there should flow to video too).

For video, `frame-video.py` calls `frame.py` to render the gradient background + shadow +
rounded-window mask at the clip's size, then `frame-video.sh` ffmpeg-overlays the
corner-rounded video onto it. Needs `python3-pil` + `ffmpeg` (both in the Dockerfile) and
`frame.py` copied alongside `frame_video.py` in `/tmp`. Produces the identical framed look
to the screenshots, in motion.

## Cursor

`draw_mouse 1` captures the X cursor, but **synthetic WebDriver clicks don't move the OS
cursor** — it sits wherever it last was. For static demos use `draw_mouse 0` (cleaner).
For drag/drop/paste demos where pointer motion IS the story, animate a synthetic cursor in
post along the click path (you already log click coordinates + timestamps in the timeline).

## Common mistakes

| Mistake | Fix |
|---|---|
| Animations missing / instant in the video | App not launched with `WEBKIT_DISABLE_COMPOSITING_MODE=1`. Verify env on the *app process*, not just the container. |
| `crop` "Error when evaluating the expression" with `t` | `crop` can't animate w/h. Use `zoompan` for time-varying zoom. |
| `ffmpeg: command not found` after a rebuild | ffmpeg is in `Dockerfile.tauri-headless`; a container *recreate* without *rebuild* can lag it — `apt-get install -y ffmpeg` in-container as a stopgap. |
| `"A session already exists"` when creating a session | The MCP (or a prior run) holds the single session. Stop it / reuse `/tmp/wd_sid`. |
| Black bars / wrong region | Set the window rect to a known size at 0,0 first; grab that exact region. |
| Blank frames | App failed to launch (splash) — see [[iterating-on-voltius-ui]] (needs `seccomp=unconfined`). |
