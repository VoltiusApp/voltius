# Host-scoped port forwarding (auto-forward dedup across terminals)

## Problem
Each terminal tab opens its own SSH connection with a unique `session_id` and
starts its own auto-forward poller (`commands/ssh.rs` → `set_auto_detect`).
Opening N terminals to the same host runs N pollers, each forwarding every
detected port; local-port collisions bump duplicates to other local ports →
"forwarding all ports again".

## Desired (user)
Forwards are host-scoped and shared by all terminals of the same host (like
VSCode). Forward once per host; all terminals show the same forwards; keep
working until the *last* terminal of that host closes; no user-visible
re-election.

## Key = connection_id
The frontend passes `connection.id` (always present) on every `ssh_connect`.
Use `pf_key = connection_id` (non-empty) else `session_id`. All terminals of a
saved/ephemeral connection share one `pf_key`.

## Phase 1 — host-scoped state + event fan-out
- `PortForwardManager`:
  - `sessions` map re-keyed by `pf_key` (was `session_id`).
  - new `session_keys: Arc<Mutex<HashMap<session_id, pf_key>>>`.
  - `register_session(session_id, pf_key)` / `unregister_session(session_id) -> remaining`.
  - `key_of(session_id) -> pf_key` (fallback to the id itself).
  - all public methods translate incoming `session_id` → `pf_key`.
  - `emit_state` fans out one `pf-state-changed` per live session of the key.
- `ssh_connect`: register `(session_id, pf_key)` before auto_activate_rules /
  set_auto_detect. Dedup is automatic — `set_auto_detect` no-ops when the key
  already has auto_detect on.
- poller: capture `pf_key` + `session_keys`, fan out events to live sessions.
- Frontend: unchanged (still filters by its own `session_id`).

## Phase 2 — handoff on owner close
- `ssh_disconnect` / `on_session_disconnect`: unregister session; if siblings
  remain for the key, do NOT drop pf state. Rebind poller + tunnels onto a
  surviving sibling's handle (fetched from SessionManager) and emit shared
  state to remaining sessions. Only when the last session of the key closes do
  we tear down (current behavior).

## Verify
- 2 terminals same host: only one toast / one set of forwards; both panels show
  the same tunnels.
- Close owner terminal while sibling open: forwards persist.
- Close last terminal: forwards torn down.
- Different hosts: independent.
