import type { PluginManifest } from "@/plugins/api";

// `defaultEnabled` only means something for a plugin bundled with the app: installing one is the opt-in.
export function pluginDefaultEnabled(
  manifest: Pick<PluginManifest, "id" | "defaultEnabled">,
  installedMeta: readonly { id: string }[],
): boolean {
  return installedMeta.some((m) => m.id === manifest.id) || (manifest.defaultEnabled ?? true);
}
