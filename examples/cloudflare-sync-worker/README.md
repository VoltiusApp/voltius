# Voltius Cloudflare Sync Worker

Bring-your-own **Cloudflare Worker + R2** backend for syncing a Voltius vault.

The Worker stores **opaque ciphertext** and minimal sync metadata (device ids, labels, timestamps, KDF salt).  
Vault encryption stays in the Voltius client (same model as the GitHub Gist Sync plugin). This Worker never sees your master passphrase or plaintext hosts/keys.

Upstream tracking: [VoltiusApp/voltius#267](https://github.com/VoltiusApp/voltius/issues/267)

## Status

| Phase | Feature |
|-------|---------|
| ✅ 1 | `GET /health` scaffold |
| ✅ 2 | Bearer auth on `/v1/*` |
| ✅ 3 | Manifest GET/PUT on R2 |
| ✅ 4 | Device blob GET/PUT/DELETE + manifest upsert |
| ✅ 5 | CORS + OPTIONS preflight |

## Quick start

```bash
cd examples/cloudflare-sync-worker
# Parent Voltius repo has an overrides-only pnpm-workspace.yaml — always pass --ignore-workspace.
pnpm --ignore-workspace install
pnpm --ignore-workspace test
pnpm --ignore-workspace typecheck
pnpm --ignore-workspace dev
```

Create the R2 buckets named in `wrangler.toml` (or change the names), then:

```bash
pnpm exec wrangler secret put SYNC_TOKEN   # required from Phase 2
pnpm deploy
```

Point the Voltius Cloudflare Sync plugin at your Worker URL and use a **separate passphrase** for encryption (never reuse the transport token as the vault key).

## License

MIT — clean-room example; not a copy of the Voltius AGPL sync server.


## HTTP API (MVP)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/health` | no | Liveness |
| OPTIONS | `*` | no | CORS preflight |
| GET/PUT | `/v1/manifest` | Bearer | Schema `{ schema:1, salt, devices[] }` |
| GET/PUT/DELETE | `/v1/devices/:id` | Bearer | PUT body `{ content, label, pushedAt }` |

R2 keys: `manifest.json`, `devices/{id}.b64`
