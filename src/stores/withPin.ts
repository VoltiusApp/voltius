/**
 * `folder_update`, `key_update`, `identity_update` and `connection_update` all
 * assign `pinned = data.pinned` outright, so a payload that omits it clears the
 * pin. Callers build partial payloads (rename, reparent, vault move, bulk
 * actions) and almost none carry it, so carry it over from the stored object
 * unless the caller states one — an explicit `false` still unpins.
 */
export function withPin<T extends { pinned?: boolean }>(
  data: T,
  prev: { pinned?: boolean },
): T {
  return data.pinned === undefined ? { ...data, pinned: prev.pinned } : data;
}
