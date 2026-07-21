export interface TimestampedEntity {
  id: string;
  updated_at: string;
  deleted_at?: string;
  clocks: Record<string, string>;
}

/**
 * Per-field LWW merge of two versions of the same entity.
 *
 * For each field tracked in either entity's `clocks` map, the version with the
 * higher clock wins. A missing clock entry means "never touched on this device"
 * (treated as "" — always loses to any real timestamp).
 *
 * `deleted_at` uses the dedicated "__deleted__" clock key.
 * Tiebreak on equal clocks: higher `id` string wins (stable, deterministic).
 */
function mergeTwo<T extends TimestampedEntity>(a: T, b: T): T {
  const allFields = new Set([
    ...Object.keys(a.clocks),
    ...Object.keys(b.clocks),
  ]);
  allFields.delete("__deleted__");

  const merged: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  const mergedClocks: Record<string, string> = {};

  for (const field of allFields) {
    const clockA = a.clocks[field] ?? "";
    const clockB = b.clocks[field] ?? "";
    if (clockB > clockA || (clockB === clockA && clockB !== "" && b.id > a.id)) {
      merged[field] = (b as Record<string, unknown>)[field];
      mergedClocks[field] = clockB;
    } else {
      mergedClocks[field] = clockA;
    }
  }

  // Resolve deleted_at via __deleted__ clock
  const delClockA = a.clocks["__deleted__"] ?? "";
  const delClockB = b.clocks["__deleted__"] ?? "";
  if (delClockB > delClockA || (delClockB === delClockA && delClockB !== "" && b.id > a.id)) {
    merged["deleted_at"] = b.deleted_at;
    if (delClockB) mergedClocks["__deleted__"] = delClockB;
  } else {
    merged["deleted_at"] = a.deleted_at;
    if (delClockA) mergedClocks["__deleted__"] = delClockA;
  }

  merged["clocks"] = mergedClocks;

  const allClockValues = Object.values(mergedClocks);
  merged["updated_at"] = allClockValues.length > 0
    ? allClockValues.reduce((max, v) => (v > max ? v : max))
    : (a.updated_at > b.updated_at ? a.updated_at : b.updated_at);

  return merged as T;
}

/**
 * Per-field LWW merge of two entity collections.
 * Entities present on only one side are kept as-is.
 * Entities present on both sides are field-merged via mergeTwo().
 */
export function mergeEntities<T extends TimestampedEntity>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of local) {
    map.set(item.id, item);
  }
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      map.set(item.id, mergeTwo(existing, item));
    }
  }
  return [...map.values()];
}

/**
 * Filter out tombstones for UI display.
 * An entity is alive if never deleted, or revived (updated_at > deleted_at).
 */
export interface SecretMergeResult {
  /** Live secrets, keyed as before (`password:<id>`, `key:<id>:private`, …). */
  secrets: Record<string, string>;
  /**
   * Per-secret last-write timestamps (RFC3339). A key present here but absent
   * from `secrets` is a tombstone — a deletion that must keep propagating.
   */
  clocks: Record<string, string>;
}

/**
 * Per-secret last-writer-wins merge (issue #35).
 *
 * Each secret carries its own last-write timestamp (`clocks`), so the freshest
 * write wins regardless of which side it came from — fixing both the reported
 * case (a stale remote blob overwriting a just-changed local password) and its
 * mirror (a remote change failing to reach the local device). Deletions are
 * tombstones: a key present in `clocks` but absent from `secrets`. A newer
 * tombstone removes the value; a newer value revives it.
 *
 * A missing clock means "no known write time" (legacy secret written before
 * this mechanism) and sorts oldest, so any genuine timestamped write wins over
 * it. Tie-breaks (equal timestamps) are resolved symmetrically — independent of
 * which argument is "local" — so both devices converge on the same result.
 */
export function mergeSecrets(
  localSecrets: Record<string, string>,
  localClocks: Record<string, string>,
  remoteSecrets: Record<string, string>,
  remoteClocks: Record<string, string>,
): SecretMergeResult {
  const secrets: Record<string, string> = {};
  const clocks: Record<string, string> = {};
  const keys = new Set([
    ...Object.keys(localSecrets),
    ...Object.keys(localClocks),
    ...Object.keys(remoteSecrets),
    ...Object.keys(remoteClocks),
  ]);

  for (const key of keys) {
    const lts = localClocks[key] ?? "";
    const rts = remoteClocks[key] ?? "";
    const lHas = key in localSecrets;
    const rHas = key in remoteSecrets;

    let winTs: string;
    let winHas: boolean;
    let winVal: string | undefined;

    if (lts > rts) {
      winTs = lts; winHas = lHas; winVal = localSecrets[key];
    } else if (rts > lts) {
      winTs = rts; winHas = rHas; winVal = remoteSecrets[key];
    } else {
      // Equal timestamps (including two legacy "" secrets): resolve without
      // reference to argument order so both devices agree.
      winTs = lts;
      if (lHas && rHas) {
        // Both present — pick the lexically greater value deterministically.
        winHas = true;
        winVal = localSecrets[key] >= remoteSecrets[key] ? localSecrets[key] : remoteSecrets[key];
      } else if (lHas || rHas) {
        // One present, one tombstone at the same instant → keep the value.
        winHas = true;
        winVal = lHas ? localSecrets[key] : remoteSecrets[key];
      } else {
        winHas = false;
      }
    }

    if (winTs) clocks[key] = winTs; // retain clock for live secrets and tombstones
    if (winHas && winVal !== undefined) secrets[key] = winVal;
  }

  return { secrets, clocks };
}

/** True if two secret maps differ in keys or values (used to detect sync changes). */
export function secretsDiffer(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return true;
  for (const k of ak) {
    if (!(k in b) || a[k] !== b[k]) return true;
  }
  return false;
}
