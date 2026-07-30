import { init, parse } from "es-module-lexer";
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as VoltiusUI from "./ui";

let _urls: Record<string, string> | null = null;

/**
 * Re-export a live host module object as an ES module the plugin bundle can import.
 * Bindings are read off a global registry so the plugin shares the host's instances
 * (critical for React: a second copy has a null hook dispatcher and every hook throws).
 */
function moduleUrl(key: string, mod: Record<string, unknown>): string {
  const registry = ((globalThis as Record<string, unknown>).__voltiusHostModules ??= {}) as Record<
    string,
    unknown
  >;
  registry[key] = mod;
  const names = Object.keys(mod).filter((n) => n !== "default");
  const src = [
    `const m = globalThis.__voltiusHostModules[${JSON.stringify(key)}];`,
    ...names.map((n) => `export const ${n} = m[${JSON.stringify(n)}];`),
    `export default m.default ?? m;`,
  ].join("\n");
  return URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
}

export function hostModuleUrls(): Record<string, string> {
  _urls ??= {
    react: moduleUrl("react", React as unknown as Record<string, unknown>),
    "react/jsx-runtime": moduleUrl(
      "react/jsx-runtime",
      ReactJsxRuntime as unknown as Record<string, unknown>,
    ),
    "react-dom": moduleUrl("react-dom", ReactDOM as unknown as Record<string, unknown>),
    "@voltius/ui": moduleUrl("@voltius/ui", VoltiusUI as unknown as Record<string, unknown>),
    "@voltius/api": moduleUrl("@voltius/api", {}),
  };
  return _urls;
}

/**
 * Point a plugin bundle's host imports at the blob modules above. Only the five
 * specifiers the host provides are rewritten; anything else the plugin bundled
 * for itself is left alone.
 */
export async function resolveHostSpecifiers(source: string): Promise<string> {
  await init;
  const urls = hostModuleUrls();
  const [imports] = parse(source);
  let out = "";
  let last = 0;
  for (const imp of imports) {
    const url = imp.n === undefined ? undefined : urls[imp.n];
    if (!url) continue;
    // Static specifier offsets exclude the quotes; dynamic import() offsets include them.
    out += source.slice(last, imp.s) + (imp.d > -1 ? JSON.stringify(url) : url);
    last = imp.e;
  }
  return out + source.slice(last);
}
