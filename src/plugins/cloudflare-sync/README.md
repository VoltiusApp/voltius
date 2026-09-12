# Cloudflare Sync (`plugin-cloudflare-sync`)

BYO encrypted vault sync via a user-deployed Cloudflare Worker + R2.

- Client encryption: `api.crypto.deriveKey(passphrase, salt)` + `exportState` / `importStates`
- Transport auth: Bearer `SYNC_TOKEN` (never used as the encryption secret)
- Worker template: [`examples/cloudflare-sync-worker`](../../../examples/cloudflare-sync-worker)

Tracking: [VoltiusApp/voltius#267](https://github.com/VoltiusApp/voltius/issues/267)
