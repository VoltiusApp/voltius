import { resolveHostSpecifiers } from "./hostModules";
import type { PluginRegisterFn } from "./api";

/**
 * A plugin bundle's shape. Marketplace plugins conventionally `export default` their
 * register function; a lib-mode build of a first-party plugin emits it as a named
 * `register` export instead. Accept both — reading only `default` silently produces
 * `register is not a function` at load time, which the loaders swallow.
 */
export interface PluginModule {
  default?: PluginRegisterFn;
  register?: PluginRegisterFn;
}

/** The register function from either supported export convention. */
export function pluginRegisterOf(mod: PluginModule): PluginRegisterFn {
  const fn = mod.default ?? mod.register;
  if (typeof fn !== "function") {
    throw new Error("plugin bundle exports no register function (default or named)");
  }
  return fn;
}

/** Turn a plugin bundle's source into a live module with its host imports resolved. */
export async function importPluginModule(jsText: string): Promise<unknown> {
  const url = URL.createObjectURL(
    new Blob([await resolveHostSpecifiers(jsText)], { type: "text/javascript" }),
  );
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
