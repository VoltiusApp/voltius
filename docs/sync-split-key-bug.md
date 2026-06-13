# BUG: split-key cloud sync — fresh logins silently lose hosts

> **Status:** open, parked (found 2026-06-12 while unblocking the Android port). NOT
> Android-specific. Working doc — do not commit.

## Symptom
A freshly-logged-in device (here: the Android client) pulls only a fraction of the
account's hosts. In the repro, an account with ~10 personal-vault hosts synced just **1**
host ("oracle") to a fresh login, while two existing desktop clients sync all 10 fine
with each other.

## Root cause — two vault keys coexist on one account
Encryption keys in play (see `src/services/account.ts`):
- **`kek`** = `derive_keys(password, account_id).enc_key` — the *legacy* direct vault key.
- **`dek`** = random data key, wrapped by `kek` and stored server-side as
  `wrapped_user_secrets`; unwrapped at login. The *post-migration* vault key.

The account is in a **split state**:
- The **desktops** encrypt their pushed sync blobs with **`kek`** (they logged in before the
  wrapped-user-secrets migration and run on a cached session — never re-derived to `dek`).
- A **fresh `signInToCloud`** (the phone) unwraps `wrapped_user_secrets` → uses **`dek`**, and
  pushes `dek`-encrypted blobs.

`migrateToWrappedUserSecrets` re-keys the local `secrets.enc` (kek→dek) and uploads
`wrapped_user_secrets`, but **never re-encrypts already-pushed server sync blobs**, and other
already-logged-in devices keep using `kek`. So per-device blobs diverge by key.

## Why it's silent
`syncOnLoginReplace` (and `pullAndMerge`) decrypt every per-device blob with **only**
`getVaultKey()` (= `dek` after `signInToCloud`). Blobs encrypted with `kek` throw
`"Decryption failed — wrong key or corrupted blob"`, and the loop swallows it:
```js
} catch {
  // Skip unreadable blobs — don't abort the whole replace-sync.
}
```
→ the desktop blobs (all the hosts) are dropped with no error, no log, no UI signal.

## Evidence (on-device, 2026-06-12, account kiki.kalagan@gmail.com)
Reconstructed `kek` and `dek` in the webview via CDP and called `backup_decrypt` on each of
the 5 server device-blobs:

| device blob | size (b64) | decrypt with `dek` | decrypt with `kek` |
|---|---|---|---|
| 0d0bf0f6 (phone, just-now) | 11 KB | ✅ 1 host (oracle) | ❌ wrong key |
| a9b29b94 (phone, 06-11) | 11 KB | ✅ 1 host (oracle) | ❌ wrong key |
| 2ddb623d (desktop) | 462 KB | ❌ wrong key | ✅ 71 entries |
| 661f64de (desktop) | 451 KB | ❌ wrong key | ✅ 69 entries |
| 621d3039 (desktop) | 351 KB | ❌ wrong key | ✅ 61 entries |

Desktop blobs hold the real hosts (Serv Maison, Trading Sim, Pi 5, Serv Oracle, Proxmox,
glance_lxc, Oracle, …) — many soft-deleted CRDT dupes inflate the raw counts.

## Proposed fix (when prioritised)
1. **Client dual-key read fallback** — in `syncOnLoginReplace` *and* `pullAndMerge`, on
   `backup_decrypt(dek)` failure retry with `kek` (`derive_keys(password, account_id)`), before
   skipping. Recovers legacy blobs on any fresh login. Must ship to **desktop too** for full
   two-way convergence (otherwise desktops still can't read the phone's `dek` blobs).
2. **Stop silently swallowing** decrypt failures — at minimum count/log them and surface a
   "some devices' data could not be decrypted" warning, so this can never hide again.
3. **Optional durable repair** — a one-time "re-key all my server blobs to `dek`" so the
   account converges on a single key; then the fallback is only needed for the transition.

## Repro tooling
`/tmp/cdp_syncdiag.mjs` — node CDP client (node 24 built-in WebSocket) that reconstructs both
keys and decrypts every device blob. Drive via `adb forward tcp:9333
localabstract:webview_devtools_remote_<pid>`, ws from the adb-server host (192.168.240.1).

## Fix implemented + VERIFIED ON DEVICE — branch `split-key-sync-fix` (2026-06-13)

Spec: `docs/superpowers/specs/2026-06-13-split-key-sync-fix-design.md`
Plan: `docs/superpowers/plans/2026-06-13-split-key-sync-fix.md`
9 commits off `main`. tsc clean, all 12 node tests pass, full multi-agent review = ready to merge.

**Verified on the OnePlus (account kiki.kalagan@gmail.com), 2026-06-13 ~02:00:** built a combined
APK = `android` branch + cherry-picked 9 fix commits (throwaway branch `android-split-key-test`;
the fix is off `main`, which lacks all the Android-port work, so a raw build wouldn't run). After
`adb install -r` (session data preserved) the phone went from **1 host ("oracle") → the full ~9
hosts** (Trading Sim, glance_lxc, Proxmox, Serv Oracle, Pi 5, deploy@…, postgres@…, …) with real
decrypted addresses. **Self-healed on `autoLogin` — no re-login required** (kek vault key reads the
desktop kek-blobs via the new fallback). console.debug `[sync]` lines don't reach Android logcat,
so absence there is expected; the recovered host list is the proof.
Not yet on-device tested: reverse direction (phone edit → desktop) — covered by code review only.

What landed (client-only, no server change; converge on `dek`, tolerate both keys during transition):
1. **Dual-key read fallback** — `decryptBlobWithFallback` (`sync.ts`) tries `[vaultKey, kek, dek]`
   (deduped, via pure `vaultKeyCandidates.ts`), wired into `pullAndMerge` + `syncOnLoginReplace`
   (so `syncOnLogin` too). Only an AEAD "Decryption failed" advances to the next key; structural
   errors re-throw instead of being masked.
2. **No more blind swallow** — undecryptable + non-decrypt device errors are `console.debug`'d
   (count + device_id). Deliberately NO user-facing toast/error (per decision: silent + robust).
3. **Convergence** — `wrapped_user_secrets` cached in keychain at all 6 obtain-sites; `autoLogin`
   now unwraps it OFFLINE and adopts `dek`, picking the key that actually verifies against
   `secrets.enc` (prefer dek, fall back to kek). Cache cleared on logout (`resetVault`) and
   `switchToAccount`. So every session converges to pushing `dek` blobs; fallback is transitional.
4. Team-vault path confirmed independent (per-team X25519 key, not kek/dek) — untouched.

Rejected: durable server-blob re-key (needs cross-device-id PUT / server change; highest risk).

Known limitation (not a regression): after a password change, old `kek`-encrypted blobs from a
device that never migrated to `dek` are permanently unreadable (old kek isn't derivable from the
new password). Self-heals once those devices `autoLogin` and converge on `dek`.

### Remaining: manual verification (Task 7 — needs account password + device)
- Desktop: fresh XDG profile (`XDG_DATA_HOME=/tmp/voltius-verify/data XDG_CONFIG_HOME=/tmp/voltius-verify/config VOLTIUS_KEYCHAIN_NS=verify npm run tauri dev`), sign into the account, confirm ALL ~10 hosts load (was: only "oracle").
- Android: deploy debug APK, fresh login, confirm all hosts (CDP harness above if counts need inspecting).
- Reverse direction: edit a host on the fresh device, confirm it reaches an existing device (proves dek writes are readable both ways).
- On pass, change the heading above to "## Fix verified" with observed host counts.
