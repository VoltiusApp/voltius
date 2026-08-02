// The asm.js build, not the default wasm one: wasm needs 'wasm-unsafe-eval' in the
// CSP, and an engine that doesn't know that token blocks it and silently loads no
// plugins at all. Synchronous, so there is no init to await.
import { parse } from "es-module-lexer/js";
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as IconifyReact from "@iconify/react";
import * as VoltiusUI from "./ui";
import { isHostIconPrefix } from "@/utils/hostIconPrefixes";

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

/**
 * Plugins share the host's Iconify storage — that is the point of the specifier —
 * but writes into a host-owned prefix would let any plugin repaint host chrome.
 * Reads and rendering are untouched.
 */
function guardedIconify(): Record<string, unknown> {
  const refuse = (prefix: string, verb: string): void => {
    console.warn(`[plugin-runtime] refused ${verb} for host-owned icon prefix "${prefix}"`);
  };
  return {
    ...IconifyReact,
    addCollection(data: { prefix?: string }, provider?: string) {
      if (typeof data?.prefix === "string" && isHostIconPrefix(data.prefix)) {
        refuse(data.prefix, "addCollection");
        return false;
      }
      return IconifyReact.addCollection(data as never, provider);
    },
    addIcon(name: string, data: unknown) {
      const prefix = typeof name === "string" && name.includes(":") ? name.split(":")[0] : "";
      if (prefix && isHostIconPrefix(prefix)) {
        refuse(prefix, "addIcon");
        return false;
      }
      return IconifyReact.addIcon(name, data as never);
    },
  };
}

export function hostModuleUrls(): Record<string, string> {
  _urls ??= {
    react: moduleUrl("react", React as unknown as Record<string, unknown>),
    "react/jsx-runtime": moduleUrl(
      "react/jsx-runtime",
      ReactJsxRuntime as unknown as Record<string, unknown>,
    ),
    "react-dom": moduleUrl("react-dom", ReactDOM as unknown as Record<string, unknown>),
    "@iconify/react": moduleUrl("@iconify/react", guardedIconify()),
    "@voltius/ui": moduleUrl("@voltius/ui", VoltiusUI as unknown as Record<string, unknown>),
    "@voltius/api": moduleUrl("@voltius/api", {}),
  };
  return _urls;
}

/**
 * The specifier, read from the source rather than `imp.n`. es-module-lexer decodes
 * `n` with an indirect `eval` and swallows the failure, so under a CSP without
 * 'unsafe-eval' every `n` is undefined while the offsets stay correct — which made
 * the old `n === undefined` branch skip every import, both breaking plugin loading
 * and silently disabling the allowlist below. Returns null for a non-literal.
 */
function specifierOf(source: string, imp: { s: number; e: number; d: number }): string | null {
  const raw = source.slice(imp.s, imp.e);
  // Static specifier offsets exclude the quotes; dynamic import() offsets include them.
  if (imp.d === -1) return raw;
  const q = raw[0];
  if ((q === '"' || q === "'") && raw.length >= 2 && raw[raw.length - 1] === q) {
    return raw.slice(1, -1);
  }
  return null;
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
  const urls = hostModuleUrls();
  const [imports] = parse(source);
  let out = "";
  let last = 0;
  for (const imp of imports) {
    if (imp.d === -2) continue; // import.meta — carries no specifier
    const spec = specifierOf(source, imp);
    if (spec === null) {
      throw new Error("Plugin bundle contains a dynamic import() with a non-literal specifier");
    }
    const url = urls[spec];
    if (url) {
      out += source.slice(last, imp.s) + (imp.d > -1 ? JSON.stringify(url) : url);
      last = imp.e;
      continue;
    }
    if (!spec.startsWith("./") && !spec.startsWith("../")) {
      throw new Error(`Plugin bundle imports disallowed specifier: "${spec}"`);
    }
  }
  return out + source.slice(last);
}
