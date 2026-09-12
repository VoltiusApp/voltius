# Voltius Cloudflare Sync Worker

Bring-your-own **Cloudflare Worker + R2** backend for syncing a Voltius vault.

The Worker stores **opaque ciphertext** and minimal sync metadata (device ids, labels, timestamps, KDF salt).  
Vault encryption stays in the Voltius client. This Worker never sees your passphrase or plaintext hosts/keys.

Upstream: [VoltiusApp/voltius#267](https://github.com/VoltiusApp/voltius/issues/267) · PR: [\#268](https://github.com/VoltiusApp/voltius/pull/268)

---

## Deploy (pick one)

### Option 1 — Deploy to Cloudflare button (easiest)

Click, sign in to Cloudflare, accept the R2 binding, deploy. Takes about a minute.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mrchatam/voltius/tree/feat/cloudflare-sync/examples/cloudflare-sync-worker)

> Until \#268 merges, the button points at the PR fork branch. After merge, use:
>
> [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/VoltiusApp/voltius/tree/dev/examples/cloudflare-sync-worker)

**After the button finishes:**

1. Open the new Worker in the Cloudflare dashboard → **Settings** → **Variables and Secrets**.
2. Add secret `SYNC_TOKEN` = a long random string (password manager is fine).
3. Copy the Worker URL (e.g. `https://voltius-cloudflare-sync.<account>.workers.dev`).
4. In Voltius → enable **Cloudflare Sync** → paste URL + token + a **separate** encryption passphrase → **Create vault** or **Link existing**.

### Option 2 — Wrangler CLI (three commands)

Requires Node 20+ and a Cloudflare account (`npx wrangler login` once).

```bash
git clone https://github.com/mrchatam/voltius.git
cd voltius/examples/cloudflare-sync-worker
git checkout feat/cloudflare-sync   # until merged to VoltiusApp/dev

npm install
npx wrangler login
npm run setup:buckets              # creates R2 buckets (ignore "already exists")
npm run deploy
npm run secret:token               # prompts for SYNC_TOKEN
```

Or the all-in-one:

```bash
npm run deploy:easy
```

Then paste the printed Worker URL into the Voltius plugin settings.

### Option 3 — Local dev

```bash
cp .dev.vars.example .dev.vars   # set SYNC_TOKEN=
npm install
npm run dev                      # http://127.0.0.1:8787
```

---

## Connect Voltius

| Field | Value |
|-------|--------|
| Worker URL | Your `*.workers.dev` (or custom domain) — no trailing slash needed |
| Sync token | Same value as Worker secret `SYNC_TOKEN` |
| Encryption passphrase | **Different** from the token — used only on-device for vault crypto |

Use **Create vault** on the first device, **Link existing** on the next ones.

---

## HTTP API (MVP)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/health` | no | Liveness |
| OPTIONS | `*` | no | CORS preflight |
| GET/PUT | `/v1/manifest` | Bearer | `{ schema:1, salt, devices[] }` |
| GET/PUT/DELETE | `/v1/devices/:id` | Bearer | PUT `{ content, label, pushedAt }` |

R2 keys: `manifest.json`, `devices/{id}.b64`

Quick check:

```bash
curl -sS "$WORKER_URL/health"
curl -sS -H "Authorization: Bearer $SYNC_TOKEN" "$WORKER_URL/v1/manifest"
```

---

## Develop / test this package

This folder is self-contained (safe for the Deploy button monorepo subdirectory rule).

```bash
# From a Voltius checkout, ignore the parent overrides-only workspace:
pnpm --ignore-workspace install
pnpm --ignore-workspace test
pnpm --ignore-workspace typecheck
```

## License

MIT — clean-room example; not a copy of the Voltius AGPL sync server.
