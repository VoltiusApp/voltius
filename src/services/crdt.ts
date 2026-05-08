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
/**
 * Union merge for secrets: combine both maps, remote values take precedence.
 */
export function mergeSecrets(
  local: Record<string, string>,
  remote: Record<string, string>,
): Record<string, string> {
  return { ...local, ...remote };
}
