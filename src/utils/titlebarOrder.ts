export type TitlebarItemKey = `session:${string}` | `split:${string}`;

export function placeTitlebarItem(
  order: string[],
  itemKey: string,
  targetKey: string | null,
  placement: "before" | "after",
) {
  const next = order.filter((key) => key !== itemKey);
  const targetIndex = targetKey ? next.indexOf(targetKey) : -1;
  if (targetIndex === -1) return [...next, itemKey];
  const insertIndex = placement === "before" ? targetIndex : targetIndex + 1;
  return [...next.slice(0, insertIndex), itemKey, ...next.slice(insertIndex)];
}

export function mergeTitlebarItems(order: string[], visibleKeys: string[]) {
  const visible = new Set(visibleKeys);
  const ordered = order.filter((key) => visible.has(key));
  const orderedSet = new Set(ordered);
  return [...ordered, ...visibleKeys.filter((key) => !orderedSet.has(key))];
}
