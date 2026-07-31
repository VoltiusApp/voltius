import { init, parse } from "es-module-lexer";
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as IconifyReact from "@iconify/react";
import * as VoltiusUI from "./ui";

export { HOST_SPECIFIERS } from "./hostSpecifiers";

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
    "@iconify/react": moduleUrl(
      "@iconify/react",
      IconifyReact as unknown as Record<string, unknown>,
    ),
    "@voltius/ui": moduleUrl("@voltius/ui", VoltiusUI as unknown as Record<string, unknown>),
    "@voltius/api": moduleUrl("@voltius/api", {}),
  };
  return _urls;
}

/**
 * Point a plugin bundle's host imports at the blob modules above. Only the
 * specifiers in HOST_SPECIFIERS are rewritten. Anything else must be a `./` or `../`
 * relative specifier the bundler left in place (e.g. an unresolved chunk split) —
 * any bare specifier the host doesn't recognize, any protocol-relative (`//host/x.js`)
 * or path-absolute (`/x.js`) specifier, or a dynamic import() whose argument isn't
 * a static string literal, is rejected. A hash-verified bundle must not be able to
 * pull in remote code at runtime and slip outside the integrity boundary the hash
 * check exists to establish.
 */
export async function resolveHostSpecifiers(source: string): Promise<string> {
  await init;
  const urls = hostModuleUrls();
  const [imports] = parse(source);
  let out = "";
  let last = 0;
  for (const imp of imports) {
    if (imp.n === undefined) {
      if (imp.d > -1) {
        throw new Error("Plugin bundle contains a dynamic import() with a non-literal specifier");
      }
      continue;
    }
    const url = urls[imp.n];
    if (url) {
      // Static specifier offsets exclude the quotes; dynamic import() offsets include them.
      out += source.slice(last, imp.s) + (imp.d > -1 ? JSON.stringify(url) : url);
      last = imp.e;
      continue;
    }
    if (!imp.n.startsWith("./") && !imp.n.startsWith("../")) {
      throw new Error(`Plugin bundle imports disallowed specifier: "${imp.n}"`);
    }
  }
  return out + source.slice(last);
}
