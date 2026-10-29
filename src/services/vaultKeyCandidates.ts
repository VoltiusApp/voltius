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
  for (const key of [vaultKey, kek, dek]) {
    if (!key || key.length === 0 || out.some((k) => sameKey(k, key))) continue;
    out.push(key);
  }
  return out;
}

export const sameKey = (a: number[] | null, b: number[] | null): boolean =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
