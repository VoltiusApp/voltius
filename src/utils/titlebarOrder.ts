export type TitlebarItemKey = `session:${string}` | `split:${string}`;

export function placeTitlebarBlock(
  order: string[],
  keys: string[],
  targetKey: string | null,
  placement: "before" | "after",
) {
  const moving = new Set(keys);
  const block = [...order.filter((key) => moving.has(key)), ...keys.filter((key) => !order.includes(key))];
  const next = order.filter((key) => !moving.has(key));
  const targetIndex = targetKey ? next.indexOf(targetKey) : -1;
  if (targetIndex === -1) return [...next, ...block];
  const insertIndex = placement === "before" ? targetIndex : targetIndex + 1;
  return [...next.slice(0, insertIndex), ...block, ...next.slice(insertIndex)];
}

export function placeTitlebarItem(
  order: string[],
  itemKey: string,
  targetKey: string | null,
  placement: "before" | "after",
) {
  return placeTitlebarBlock(order, [itemKey], targetKey, placement);
}

export function gatherGroups(order: string[], groupOf: (key: string) => string | undefined) {
  const byGroup = new Map<string, string[]>();
  for (const key of order) {
    const group = groupOf(key);
    if (group !== undefined) byGroup.set(group, [...(byGroup.get(group) ?? []), key]);
  }
  const gathered: string[] = [];
  const done = new Set<string>();
  for (const key of order) {
    const group = groupOf(key);
    if (group === undefined) { gathered.push(key); continue; }
    if (done.has(group)) continue;
    done.add(group);
    gathered.push(...byGroup.get(group)!);
  }
  return gathered;
}

export function mergeTitlebarItems(order: string[], visibleKeys: string[]) {
  const visible = new Set(visibleKeys);
  const ordered = order.filter((key) => visible.has(key));
  const orderedSet = new Set(ordered);
  return [...ordered, ...visibleKeys.filter((key) => !orderedSet.has(key))];
}
