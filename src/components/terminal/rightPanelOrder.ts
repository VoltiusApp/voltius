/**
 * Rail order for plugin-contributed right-panel sections. Sorted explicitly rather
 * than taken from Map insertion order: sections are registered in whatever order the
 * seeded plugin directory reads back, and a reinstall re-inserts at the end, so the
 * rail would otherwise reshuffle in ordinary use. Sections declaring no `order` sort
 * after those that do; `id` breaks every remaining tie so the result is total.
 */
export function orderPluginSections<T extends { id: string; order?: number }>(sections: T[]): T[] {
  return [...sections].sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id),
  );
}
