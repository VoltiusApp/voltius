/**
 * Ordered, deduped list of vault keys to try when decrypting a sync blob.
 *
 * Accounts can carry two vault keys at once — the legacy `kek` and the migrated
 * `dek` — and different devices encrypt their blobs with different ones. Trying
 * each key in turn lets any session read every device's blob.
 *
 * Order: active vault key first (most likely to match own/recent blobs), then
 * `kek`, then `dek`. Nulls and empty arrays are dropped; byte-identical keys are
 * removed so the same key is never tried twice.
 */
export function buildDecryptKeyCandidates(
  vaultKey: number[] | null,
  kek: number[] | null,
  dek: number[] | null,
): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  for (const key of [vaultKey, kek, dek]) {
    if (!key || key.length === 0) continue;
    const sig = key.join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(key);
  }
  return out;
}
