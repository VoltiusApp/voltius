declare namespace Cloudflare {
  interface Env {
    VAULT_BUCKET: R2Bucket;
    SYNC_TOKEN?: string;
  }
}

interface Env extends Cloudflare.Env {}
