type Click = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

const isPlainClick = (e: Click): boolean => !e.ctrlKey && !e.metaKey && !e.shiftKey;

export function selectFollowing<E extends Click>(
  select: (id: string, e: E) => void,
  panelOpen: boolean,
  follow: () => void,
): (id: string, e: E) => void {
  return (id, e) => { select(id, e); if (panelOpen && isPlainClick(e)) follow(); };
}

export function folderAwareKeys<F extends { id: string }>(
  folders: F[],
  folder: { open: (f: F) => void; edit: (f: F) => void },
  item: { enter: (id: string) => void; edit: (id: string) => void },
): { onEnter: (id: string) => void; onEdit: (id: string) => void } {
  const find = (id: string) => folders.find((f) => f.id === id);
  return {
    onEnter: (id) => { const f = find(id); if (f) folder.open(f); else item.enter(id); },
    onEdit: (id) => { const f = find(id); if (f) folder.edit(f); else item.edit(id); },
  };
}

export function exceptItems<T extends { id: string }>(items: T[], excluded: T[]): T[] {
  if (excluded.length === 0) return items;
  const ids = new Set(excluded.map((x) => x.id));
  return items.filter((x) => !ids.has(x.id));
}
