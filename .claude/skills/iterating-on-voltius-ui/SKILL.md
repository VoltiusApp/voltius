---
name: iterating-on-voltius-ui
description: Use when modifying, running, screenshotting, clicking through, or verifying the Voltius Tauri app's UI — drives the live headless dev build through the tauri-docker MCP so changes can be seen and interacted with, not just compiled.
---

# Iterating on the Voltius UI

## Overview

Modify the app, then **look at it and interact with it** in the live dev build via the
`tauri-docker` MCP. Don't claim a UI change works because it compiled — drive it and read
the screenshot. A blank frame means it failed to launch.

The stack is `compose.headless.yml`: `tauri-headless` (debug app + Xvfb + tauri-driver on
4444, driven by the MCP) and `ssh-host-1` (throwaway SSH host: user `voltius` / pass
`voltius`, port 2222, reachable by name on the shared network).

## Bring-up (do this FIRST — the MCP fails to connect if the container is down)

```bash
docker compose -f compose.headless.yml up -d
docker compose -f compose.headless.yml logs tauri-headless   # wait for the driver
```

Ready signals: log shows `Joined session keyring`, and `claude mcp list` shows
`tauri-docker` connected. First build from a cold cache takes minutes; a warm cache
(`target/` is host-mounted) finishes in seconds. If the MCP is registered but failing,
the cause is almost always that the container isn't up yet — bring it up and retry.

Register the MCP if absent:
`claude mcp add tauri-docker -- docker exec -i tauri-headless npx -y github:VoltiusApp/mcp-tauri-automation`

## Loop

1. `launch_app` `appPath=/app/target/debug/voltius` (check `get_app_state` first).
2. Interact: `click_element`, `type_text` (`clear:true` to overwrite; `\n` sends Enter),
   `press_key` (Enter, arrows, chords like `["Control","l"]`), `wait_for_element`.
3. `capture_screenshot` with `returnBase64:false` → saves to `/app/screenshots/<name>.png`
   → **Read the host path** `./screenshots/<name>.png` to actually look at it.

## The MCP is yours — extend it, don't work around it

`tauri-docker` runs **our own** MCP: `VoltiusApp/mcp-tauri-automation`, checked out at
`../mcp-tauri-automation`. It is not a fixed constraint. When a tool is missing or too
limited (e.g. `type_text` couldn't send Enter or Ctrl-keys) and you catch yourself
building a fragile workaround, **stop and fix the MCP**:

1. Edit `../mcp-tauri-automation/src`; `npm install && npm run build` to typecheck.
2. Commit and push to `origin/main` (the VoltiusApp fork) — that's what the container's
   `npx` pulls on the next fresh session.
3. **To use the new capability in _this_ session:** a `claude mcp` add/reload does NOT
   surface new or changed tools mid-session — the tool registry is fixed at startup.
   Instead `docker cp` the built dir into the container and drive the built `TauriDriver`
   directly from a throwaway `node` script (`docker exec tauri-headless node x.mjs`), or
   drive `tauri-driver` directly over WebDriver.
4. Resume the paused work.

Don't grep `src-tauri` for a backend command to fake a keystroke — improve the tool.

## Selectors (the #1 time-sink — read source, don't guess)

`click_element` / `type_text` take **CSS selectors only** — no `:contains`, no XPath.

- Grep the component before guessing a selector.
- Prefer stable hooks already in the code: `[data-host-card="true"]`, `button[title="…"]`,
  `input[placeholder="…"]`.
- Tailwind v4 arbitrary classes contain literal parens. Match by substring to skip
  escaping: `button[class*="bg-(--t-bg-elevated)"][class*="text-(--t-accent)"]`.
- Context-menu / dropdown items have no ids → positional. The menu portal is `z-100`;
  the Nth item is `[class*="z-100"] > div > div:nth-child(N) > button`.
- `button:"right"` on `click_element` opens the context menu.

## After editing code

- **Frontend (`.tsx`/`.css`): hot-reloads via Vite, no rebuild.** Just re-screenshot.
  Confirm: `docker exec tauri-headless tail /tmp/vite.log` shows `hmr update …`.
- **Rust (`src-tauri/`):** `docker exec tauri-headless cargo build --manifest-path
  src-tauri/Cargo.toml` (debug + mold), then `close_app` + `launch_app`.

## Verifying non-visual effects

A toast firing proves the handler ran; confirm the *actual* effect too.

- App's own UI: the notification bell (`button[title="Notifications"]`) keeps a history.
- Clipboard (needs the app's X auth, not just `DISPLAY`):
  ```bash
  pid=$(docker exec tauri-headless pgrep -f target/debug/voltius | head -1)
  docker exec tauri-headless sh -c "export \$(tr '\0' '\n' </proc/$pid/environ | grep -E '^(DISPLAY|XAUTHORITY)='); xclip -o -selection clipboard"
  ```
- SSH host reachability: the host card shows a green ping dot once added.

## Common mistakes

| Mistake | Fix |
|---|---|
| Calling the MCP before `compose up` | Bring the stack up first; "Failed to connect" = container down |
| Guessing CSS selectors | Grep the component; use `data-*`/`title`/`placeholder`/`class*=` |
| Using `:contains`/XPath | Unsupported — CSS only |
| `returnBase64:true` then not looking | Save to file, **Read it**, inspect the pixels |
| Rebuilding for a `.tsx` change | Frontend hot-reloads; only Rust needs `cargo build` |
| "It compiled / toast showed" = done | Verify the real effect (clipboard, host state, DB) |
| App hangs on splash | Container needs `seccomp=unconfined` (keyutils keyring) |
| Hacking around a missing/limited MCP tool | The MCP is ours — add the tool, push, continue ("The MCP is yours") |
