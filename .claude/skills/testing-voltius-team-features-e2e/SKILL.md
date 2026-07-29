---
name: testing-voltius-team-features-e2e
description: Use when verifying, reproducing, or debugging Voltius TEAM / multiplayer features end-to-end with real accounts — team vaults, invitations, member vault-key distribution (X25519 wrap/unwrap), shared/collaborative terminals, live presence, and control handoff. These multi-user crypto + realtime flows are exactly what unit tests and single-instance UI runs structurally cannot prove. Not for single-user UI tweaks (use iterating-on-voltius-ui).
---

# Testing Voltius team features end-to-end

## Overview

Team features (team vaults, invites, shared terminals, presence) need TWO authenticated accounts talking to a REAL server. This skill stands up an **isolated** server + one or two live app instances, unlocks team tier for free, drives them over WebDriver, and verifies via server logs + `psql` (screenshots are useless here). It complements `iterating-on-voltius-ui` (single-instance UI) and the `team-e2e-harness-and-findings` memory (findings/status).

## ⛔ NEVER touch production

Prod `voltius-server` + `voltius-db` are running on the `cloudflare` docker network with real paying users. **Only ever create/destroy `voltius-e2e-*` containers.** Verify with `docker ps | grep voltius` before and after — prod must stay up.

## The unlock cheat (why this is cheap)

Run the server in **self-hosted mode** = leave `LEMONSQUEEZY_API_KEY` unset. Then `register` grants **business tier, no trial**, and (with `RESEND_API_KEY` unset) **auto-verifies email**. So any freshly-registered account is business+verified → team UI unlocks with ZERO DB surgery. The client's `isTeams`/`isBusiness` derive purely from the `tier` string the server returns; there is no other kill-switch.

## Bring-up

The `tauri-headless` app container + its network come from `compose.headless.yml` (see `iterating-on-voltius-ui`). Bring that up first, then attach an isolated DB + server to the SAME network:

```bash
docker compose -f compose.headless.yml up -d          # app + ssh-host-1 + network
NET=voltius-headless_voltius-test
docker run -d --name voltius-e2e-db --network $NET \
  -e POSTGRES_USER=voltius -e POSTGRES_PASSWORD=e2epass -e POSTGRES_DB=voltius postgres:16-alpine
# server AUTO-MIGRATES on boot (db.rs sqlx::migrate!). Bump rate limits or you WILL hit 429s.
docker run -d --name voltius-e2e-server --network $NET \
  -e DATABASE_URL=postgres://voltius:e2epass@voltius-e2e-db:5432/voltius \
  -e JWT_SECRET=e2e-secret -e PORT=8080 \
  -e SYNC_RATE_LIMIT=100000 -e INVITE_RATE_LIMIT=100000 -e REGISTER_RATE_LIMIT=100000 \
  voltius-server:latest      # no LEMONSQUEEZY_API_KEY = self-host
```

If `voltius-server:latest` is missing: `docker build -t voltius-server:latest ../server`. If `tauri-mcp` is missing, `compose.headless.yml up` builds it (first cold build takes minutes).

The app reaches the server by name inside the network: sign-in server URL = `http://voltius-e2e-server:8080`.

## Driving the app (raw WebDriver, not the MCP)

If `tauri-headless` started after your session began, the `tauri-docker` MCP tools are NOT in your tool registry (fixed at startup). Drive `tauri-driver` (W3C WebDriver on the container's `localhost:4444`) directly with the bundled `wd.mjs`:

```bash
C=tauri-headless
docker cp .claude/skills/testing-voltius-team-features-e2e/wd.mjs $C:/app/wd.mjs
docker exec $C node /app/wd.mjs new                    # launch app, save session
docker exec $C node /app/wd.mjs eval "return document.body.innerText.slice(0,200)"
```

`wd.mjs` commands: `new [ns]`, `eval "<js; MUST return>"`, `click <cssSel>`, `clicktext "<exact text>"`, `setval <sel> <val>`, `type <sel> <val> [clear]`, `text <sel>`, `exists <sel>`, `esc`, `shot <name>`, `source [n]`.

### WebKitGTK gotchas (each one cost real time to learn)

- **Screenshots are BLACK** (offscreen paint). Verify state via `eval` reading `innerText`/inputs/buttons — DOM introspection, not pixels.
- **Clicks get dropped** on ripple mutations → `click`/`clicktext` dispatch the full `pointerdown→mousedown→pointerup→mouseup→click` sequence.
- **React controlled inputs**: WebDriver `type`/`clear` leave React state stale (value re-reverts, or appends to a default). Use `setval` (native setter + `input` event).
- **`window.__TAURI__` is NOT exposed** to injected JS → you cannot call backend `invoke`; drive the real UI instead.
- **Some editors won't open** via synthetic events (host editor, right-click context menus). Filling `New Host` fields **auto-saves** (no Save button); if an editor/menu won't open, find another path rather than fighting it.
- **App state lives in the OS keychain (keyutils), not files** — wiping `~/.local/share/com.voltius.app` does NOT sign you out. Use the app's **Account menu → Disconnect**. Account SWITCH reuses the cached master key (no password prompt).

## Two simultaneous clients (multiplayer / presence)

Run a second app container. **Keychain-isolation trap:** both containers run as root and share the host's keyutils `@u` (`_uid.0`) keyring, so accounts leak between them. Fix = a separate keychain namespace, set at the **container** level (`tauri:options.env` in the WebDriver capability is IGNORED):

```bash
docker run -d --name tauri-headless-2 --network $NET --security-opt seccomp=unconfined \
  -e VOLTIUS_KEYCHAIN_NS=2 -v $(pwd):/app tauri-mcp     # fresh keychain → onboards clean
```

Now: `tauri-headless` = account A, `tauri-headless-2` = account B, independent sessions. Register/login each against `http://voltius-e2e-server:8080`.

## Verify with server logs + psql (not the UI alone)

The load-bearing proof is server-side. Terminal output is xterm **canvas** (unreadable via DOM), so confirm multiplayer via the WebSocket logs, and crypto via the DB:

```bash
docker logs --since 30s voltius-e2e-server 2>&1 | grep -iE "vault-key|WS participant|/ws|login|101|404"
docker exec voltius-e2e-db psql -U voltius -d voltius -tA -c \
  "select u.email from team_vault_keys k join users u on u.id=k.user_id"   # who holds a wrapped key
```
Key signals: `Vault keys upserted key_count=N` / `Vault key fetched` (crypto distribution), `WS participant joined user=<id>` + `→ 101` (a client joined a shared session), `User logged in tier=business`.

## Reference flows

- **Crypto round-trip (1 instance, sequential):** A registers → shares a vault (migrates to team vault) → invites B → switch to B → accept the "Vault invite:" → team_members gains B; when A is next online it wraps the key for B (`team_vault_keys` gains B, `key_count=2`) → B unwraps and the shared "Cloud vault" opens. A writes a host+password → `team_vault_secrets` gains ciphertext → B fetches `/secrets` and the host renders decrypted.
- **Multiplayer (2 instances):** A connects `ssh-host-1` (:2222 voltius/voltius, on the network) → **Share terminal** (Team mode) → `POST /terminal-sessions 201` + host WS `101`. B sees it under **TEAM SESSIONS · LIVE** → Join → B WS `101`. B "Request Control" → A "Grant" → B "You have control".

## Teardown (leave prod untouched)

```bash
docker rm -f voltius-e2e-server voltius-e2e-db tauri-headless-2
docker compose -f compose.headless.yml down            # tauri-headless + ssh-host-1 + network
docker ps | grep voltius                               # prod voltius-server/voltius-db must remain
```

## Known real bug this harness surfaced

The **async key-distribution window** (VoltiusApp/voltius#41): an invitee who accepts while the sole key-holder is offline stays keyless (silent `GET vault-key → 404` loop) until the inviter reconnects. If you reproduce team-vault access failures, check `team_vault_keys` for a missing member row before assuming a crypto bug.
