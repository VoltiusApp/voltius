import type { BlobPayload } from "./sync";

/**
 * The object-id segment of a secret key.
 *
 * Secret keys are `<type>:<objectId>` or `<type>:<objectId>:<field>`
 * (e.g. `password:<id>`, `key:<id>:private`). The object id is the second
 * `:`-delimited token; returns null when there is no such token.
 */
export function secretObjectId(secretKey: string): string | null {
  const parts = secretKey.split(":");
  return parts.length >= 2 ? parts[1] : null;
}

/**
 * Drop array elements whose `id` is in `excluded` and re-serialize.
 * Returns the input string unchanged if nothing matches, or if the content is
 * not a JSON array (defensive — never throws).
 */
export function filterEntityArrayJson(json: string, excluded: Set<string>): string {
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return json;
  }
  if (!Array.isArray(arr)) return json;
  const kept = arr.filter(
    (e) => !(e && typeof e === "object" && excluded.has((e as { id?: unknown }).id as string)),
  );
  return kept.length === arr.length ? json : JSON.stringify(kept);
}

/**
 * Return a copy of a decrypted remote payload with sync-excluded objects
 * removed, so remote state can neither modify nor resurrect them locally.
 *
 * Filters the given `entityFiles` (drops excluded ids) and the secret maps
 * (drops keys whose object-id segment is excluded, from BOTH `secrets` and
 * `secret_clocks` so no omission reads as a tombstone). Non-entity files pass
 * through untouched. The input payload is not mutated. Returns the same object
 * reference when the excluded set is empty (cheap no-op).
 */
export function filterRemoteExcluded(
  payload: BlobPayload,
  excludedIds: Iterable<string>,
  entityFiles: readonly string[],
): BlobPayload {
  const excluded = new Set(excludedIds);
  if (excluded.size === 0) return payload;

  const files: Record<string, string> = { ...payload.files };
  for (const f of entityFiles) {
    const content = files[f];
    if (content != null) files[f] = filterEntityArrayJson(content, excluded);
  }

  const keep = (key: string): boolean => {
    const id = secretObjectId(key);
    return !(id != null && excluded.has(id));
  };
  const filterMap = (m: Record<string, string> | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(m ?? {})) if (keep(k)) out[k] = v;
    return out;
  };

  return {
    files,
    secrets: filterMap(payload.secrets),
    secret_clocks: filterMap(payload.secret_clocks),
  };
}

/**
 * Collect every entity id that must not participate in sync: any id whose
 * `isObjectSynced(id, type)` is false (covers both individually-excluded ids
 * and every id of a sync-disabled type), unioned with `rawExcludedIds`.
 */
export function collectExcludedIds(
  entitiesByType: Array<{ type: string; ids: string[] }>,
  isObjectSynced: (id: string, type: string) => boolean,
  rawExcludedIds: string[] = [],
): string[] {
  const out = new Set<string>(rawExcludedIds);
  for (const { type, ids } of entitiesByType) {
    for (const id of ids) if (!isObjectSynced(id, type)) out.add(id);
  }
  return [...out];
}
