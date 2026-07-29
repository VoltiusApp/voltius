import { resolveHostSpecifiers } from "./hostModules";

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
