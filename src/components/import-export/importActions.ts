export type ItemAction = "include" | "skip" | "overwrite";

export const ITEM_TYPES = ["connections", "keys", "identities", "snippets", "pfRules"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export function defaultActions(
  meta: Record<ItemType, { isDupe: boolean }[]>,
  keysToTeam: boolean,
  previous: ReadonlyMap<string, ItemAction>,
  touched: ReadonlySet<string>,
): Map<string, ItemAction> {
  const actions = new Map<string, ItemAction>();
  for (const type of ITEM_TYPES) {
    meta[type].forEach((m, i) => {
      const key = `${type}:${i}`;
      const kept = touched.has(key) ? previous.get(key) : undefined;
      actions.set(key, kept ?? (m.isDupe || (type === "keys" && keysToTeam) ? "skip" : "include"));
    });
  }
  return actions;
}

export function setActions(
  prev: ReadonlyMap<string, ItemAction>,
  keys: readonly string[],
  action: ItemAction,
  touched: Set<string>,
): Map<string, ItemAction> {
  const next = new Map(prev);
  for (const key of keys) {
    touched.add(key);
    next.set(key, action);
  }
  return next;
}
