/** Pure helpers for the `{{`-variable autocomplete shared by the snippet
 *  editors. No React — unit-tested in isolation. */

export interface DynamicVarDefKey {
  value: string;
  descKey: string;
}

export const DYNAMIC_VAR_DEF_KEYS: DynamicVarDefKey[] = [
  { value: "connection.host",     descKey: "snippets.form.dynamicVars.connectionHost" },
  { value: "connection.username", descKey: "snippets.form.dynamicVars.connectionUsername" },
  { value: "connection.name",     descKey: "snippets.form.dynamicVars.connectionName" },
  { value: "date",                descKey: "snippets.form.dynamicVars.date" },
  { value: "datetime",            descKey: "snippets.form.dynamicVars.datetime" },
  { value: "timestamp",           descKey: "snippets.form.dynamicVars.timestamp" },
  { value: "clipboard",           descKey: "snippets.form.dynamicVars.clipboard" },
];

/** The in-progress variable name typed after the nearest unclosed `{{`, or null
 *  if the cursor is not inside an open `{{…` at the given text. */
export function activeVarQuery(textBeforeCursor: string): string | null {
  const match = textBeforeCursor.match(/\{\{([^}]*)$/);
  return match ? match[1] : null;
}

/** Dynamic-var defs whose value prefix-matches the query (case-insensitive). */
export function filterDynamicVars<T extends { value: string }>(defs: T[], query: string): T[] {
  const q = query.toLowerCase();
  return defs.filter((d) => d.value.startsWith(q));
}
