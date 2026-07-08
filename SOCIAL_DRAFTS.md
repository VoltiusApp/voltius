# Voltius — social drafts (since 0.4.0)

Status: drafts. Nothing is committed/published. The 3 blog posts live in
`../web/landing/content/blog/` with `draft: true` — flip to `draft: false` once
media is attached and you've reviewed.

Account voice: plain, dev-to-dev, lead with the pain you removed. Each tweet has a
suggested media slot → see the **Media shot-list** at the bottom for exactly what to
capture. Media filenames here match the placeholder paths in the blog posts so you
upload once.

---

## Blog posts (3)

| File | Title | Hook |
|---|---|---|
| `edit-remote-files-without-the-scp-dance.mdx` | Edit Remote Files Without the scp Dance | CodeMirror editor + editable diff (0.6.0) |
| `port-forwards-that-survive-sleep.mdx` | Port Forwards That Survive a Closed Lid | PF panel + per-host + the sleep/wake leak (0.7.0) |
| `voltius-on-android.mdx` | The Whole SSH Client, Now in Your Pocket | Same app on Android + touch gestures (0.5.0/0.7.0) |

---

## Tweets

### A. Remote file editor (0.6.0) — flagship, most demoable

**A1 (lead / launch)**
> You SSH in to change one line of an nginx config. The box has vi and an opinion about it.
>
> Voltius now has a real editor built in: open a remote file over SFTP, edit it with syntax highlighting, save it straight back. No scp, no local copy to clean up.
>
> 🎥 editor-open-edit-save

**A2 (the diff angle — strongest)**
> Drag one file tab onto another in Voltius and you get a live diff.
>
> The two sides can be anything: local ↔ remote, staging ↔ prod, or the same file on two boxes that have drifted. Apply changes hunk-by-hunk across the gutter. Fully editable.
>
> 🎥 editor-diff-apply-ribbons

**A3 (technical / for the HN crowd)**
> The editable diff in Voltius is a CodeMirror 6 MergeView underneath — we didn't write a diff engine.
>
> What was ours: the apply-ribbon geometry, viewport-aware next/prev nav, and guarding apply against a stale chunk when two applies race.
>
> 🖼 editor-diff-static

### B. Port forwarding (0.7.0)

**B1 (the bug war-story — best engagement bait)**
> Bug we just killed: forward a remote port, close your laptop, come back — tunnel dead. Felt like a network hiccup. It wasn't.
>
> The accept loop's CancellationToken was never cancelled on drop. The local listener stayed bound with nothing serving it. A ghost socket.
>
> 🖼 ports-badge (or no media)

**B2 (panel overhaul)**
> Reworked port forwarding in Voltius:
> • inline quick-forward — one row, ad-hoc tunnel
> • save any tunnel as a named rule, rename inline
> • copy localhost:port from a live row
> • active-tunnel badge on the rail
>
> 🎥 ports-panel-overhaul

**B3 (per-host)**
> Auto port-forwards in Voltius now belong to the host, not one terminal tab.
>
> Open 5 tabs to the same box → one set of tunnels, shared. They come up on the first session and only tear down when the last one closes. No more duplicate-port fights.
>
> 🖼 ports-panel-static

### C. Android (0.5.0 + gestures in 0.7.0)

**C1 (lead)**
> Voltius for Android isn't a companion app. It's the same app.
>
> Same terminal, SFTP, Docker/metrics/processes panels, native keychain — compiled to a signed arm64 APK and running on your phone.
>
> 🎥 android-tour

**C2 (gestures)**
> Making a terminal usable with thumbs:
> • swipe to scroll scrollback
> • long-press to select + a copy/paste toolbar
> • paste into blank area
> • double-tap for Tab
>
> All on Android, in Voltius.
>
> 🎥 android-gestures

### D. Smaller ships (one-liners — space these out as filler between the big ones)

**D1 — Mobile copy actually works**
> Most mobile terminals: tap "Copy" → it clears the selection you were copying. Useless.
> Voltius: long-press select, copy/paste toolbar that doesn't fight you. Fixed.
> 🎥 android-gestures (reuse)

**D2 — OSC 52 clipboard**
> Voltius now supports OSC 52 — yank from vim/tmux on a remote box and it lands in your local clipboard. One shared copy/paste path across the whole terminal.
> 🖼 (optional, none needed)

**D3 — Legacy SSH algorithms**
> Got an ancient switch/router that only speaks deprecated SSH algorithms? Voltius has a per-connection legacy-algorithms toggle now. Connect to the old gear without weakening everything else.
> 🖼 connection-legacy-toggle

**D4 — SFTP follow-cwd through tmux**
> Voltius's SFTP panel follows your terminal's working directory — now even through tmux and screen, by polling the multiplexer for cwd. cd on the left, the file browser keeps up on the right.
> 🎥 sftp-follow-cwd

**D5 — SFTP intra-pane drag-to-move**
> Drag files to move them within an SFTP pane in Voltius — onto folders, onto the parent, onto breadcrumbs. Works in the terminal-side panel and fullscreen.
> 🎥 sftp-drag-move

**D6 — FTP/FTPS**
> Voltius isn't SSH-only anymore — FTP and FTPS are supported too. Same browser, same transfer queue.
> 🖼 (optional)

**D7 — Install everywhere (packaging)**
> You can now install Voltius however you like:
> • macOS: brew install --cask voltiusapp/voltius/voltius
> • Windows: winget
> • Linux: AppImage, .deb, .rpm, apt/yum repos
> 🖼 install-matrix (text/graphic card)

**D8 — Persistent + cross-device (recap of the existing blog post)**
> Close your laptop mid-deploy. Sit at your desktop. Same terminal, same process, still running — mirrored live on both. Voltius wraps your shell in tmux on the host; your device just holds a view.
> → link existing blog: /blog/cross-device-session-pickup
> 🎥 (reuse cross-device clip if you have it)

---

## Suggested posting cadence (sustainable, ~2/week)

The big rocks first, war-story tweets where engagement lives, one-liners as filler:

1. A1 (editor lead) + link blog post 1
2. B1 (closed-lid bug) → 2 days later B2
3. C1 (Android lead) + link blog post 3
4. A2 (diff) — the single most demoable thing you have
5. B-post link (port forwards blog) via B3
6. C2 (gestures) + D1
7. D7 (install everywhere) — good for a r/selfhosted / Show HN cross-post
8. D4 / D5 / D2 / D3 as midweek filler

Cross-post the meatier ones (B1 war story, C1 Android, D7 install) to:
HN Show HN · r/selfhosted · r/commandline · lobste.rs. Those move more dev users than X alone.

---

## 📸 Media shot-list (everything to capture)

Upload to the R2 bucket you already use: `pub-8ed71dde1bad496f9df2b3f5a84b69df.r2.dev/blog/`
Filenames below are the exact placeholders referenced in the blog posts + tweets.

### Videos (autoplay loop, keep them 4–12s, no audio needed)

| File | What to record | Used in |
|---|---|---|
| `editor-open-edit-save.mp4` | Open a remote file from SFTP browser → edit a line → Ctrl+S → show it saved | Blog 1, Tweet A1 |
| `editor-diff-apply-ribbons.mp4` | Drag one tab onto another → diff opens → click an apply ribbon to push a hunk → next/prev nav | Blog 1, Tweet A2 |
| `ports-panel-overhaul.mp4` | Open Ports panel → inline quick-forward a port → save as rule + rename → copy localhost:port; show the rail badge | Blog 2, Tweet B2 |
| `android-tour.mp4` | Phone screen recording: launch app → terminal session → SFTP browser → a Docker/metrics panel | Blog 3, Tweet C1 |
| `android-gestures.mp4` | Phone: swipe-scroll the scrollback → long-press select → copy via toolbar → double-tap Tab | Blog 3, Tweets C2/D1 |
| `sftp-follow-cwd.mp4` | cd around inside a tmux session → SFTP panel on the right tracks the directory | Tweet D4 |
| `sftp-drag-move.mp4` | Drag a file onto a folder / parent / breadcrumb in an SFTP pane | Tweet D5 |

### Static images (PNG screenshots)

| File | What to capture | Used in |
|---|---|---|
| `editor-diff-static.png` | A clean frame of the color-coded diff (green/red/yellow) with ribbons visible | Tweet A3 |
| `ports-panel-static.png` | The Ports panel with a couple of active tunnels + the badge | Tweet B3 |
| `ports-badge.png` | Close-up of the rail icon with the active-tunnel count badge (optional) | Tweet B1 |
| `connection-legacy-toggle.png` | The per-connection legacy-algorithms toggle in the connection form | Tweet D3 |
| `install-matrix.png` | A simple graphic/card listing brew / winget / AppImage / deb / rpm commands | Tweet D7 |

### Notes
- For the Android clips, the on-device debug build + screen record is enough; you don't need the MCP harness, but it can produce clean framed shots if you want consistency.
- For the desktop clips, the headless dev build can produce repeatable framing, or just screen-record your normal app.
- Reuse is fine: `android-gestures.mp4` covers C2 and D1; the cross-device clip (if you still have it) covers D8.

### Minimum viable set (if you only shoot a few)
1. `editor-diff-apply-ribbons.mp4` — your single best demo
2. `android-tour.mp4` — proves the "same app on a phone" claim
3. `ports-panel-overhaul.mp4` — covers the PF post
That's enough to publish all 3 blog posts and run the top tweets.
