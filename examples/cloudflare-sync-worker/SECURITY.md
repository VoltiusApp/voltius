# Security model (Cloudflare Sync Worker)

## Threat model

- The Worker and R2 store **ciphertext + non-sensitive metadata only** (device ids, labels, timestamps, KDF salt).
- Encryption keys are derived **client-side** from the user’s passphrase + salt. The Worker never receives the passphrase or derived key.
- `SYNC_TOKEN` is a **transport** secret (Bearer). It must not be reused as the encryption passphrase.

## Guarantees

- Unauthenticated `/v1/*` requests return 401.
- Token comparison uses SHA-256 digests + constant-time byte compare (no early length exit on the raw secret).
- Responses use `cache-control: no-store`.
- CORS is permissive for desktop clients; the Worker does not rely on browser cookie auth.

## Non-goals / residual risks

- **No Worker admin UI.** Managing tokens/passphrases/devices belongs in the Voltius client. Rotate `SYNC_TOKEN` via `wrangler secret` / Cloudflare dashboard.
- Anyone with `SYNC_TOKEN` can **read/write ciphertext** and delete device objects. Protect the token like an API key.
- Concurrent multi-device sync uses last-writer-wins on `manifest.json` (same class of race as Gist sync).
- Wrong passphrase still “links”; decrypt failures surface on import (same as Gist). Prefer Sync now after Link to validate.
- Bot Fight Mode / WAF on the zone can block non-browser clients; allow your desktop app / curl if needed.

## Operational checklist

1. Generate a long random `SYNC_TOKEN`; store only as a Worker secret.
2. Use a strong unique passphrase in the Voltius plugin (never equal to the token).
3. Prefer HTTPS Worker URLs (client enforces this except localhost).
4. After rotating `SYNC_TOKEN`, update every device’s plugin settings.
5. Removing a remote device deletes its R2 object; it does not wipe local vaults.
