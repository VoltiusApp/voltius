/**
 * Exported for test: `moduleUrl`'s blob URL cannot be imported under jsdom.
 */
export function hostModuleSource(key: string, names: string[]): string {
  // An export clause, not `export const`: the exported name is an IdentifierName,
  // so reserved words like zod's `enum` / `function` / `void` are legal there.
  return [
    `const m = globalThis.__voltiusHostModules[${JSON.stringify(key)}];`,
    ...names.map((n, i) => `const $v${i} = m[${JSON.stringify(n)}];`),
    names.length ? `export { ${names.map((n, i) => `$v${i} as ${n}`).join(", ")} };` : "",
    `export default m.default ?? m;`,
  ]
    .filter(Boolean)
    .join("\n");
}
