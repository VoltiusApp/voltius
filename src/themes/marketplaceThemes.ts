import { FIRST_PARTY_SOURCE, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { useUIStore } from "@/stores/uiStore";
import { ownedByPlugin } from "@/stores/pluginStore";
import type { AppTheme } from "@/themes/types";

export interface ThemePreviewPalette {
  ui: { bgTerminal: string; accent: string; tabActiveText: string; statusConnected: string };
  terminal: { background: string; foreground: string; green: string; blue: string; yellow: string; cyan: string };
}

const PREVIEW_KEYS = {
  ui: ["bgTerminal", "accent", "tabActiveText", "statusConnected"],
  terminal: ["background", "foreground", "green", "blue", "yellow", "cyan"],
} as const;

// Catalogue data is untrusted and lands in inline styles: hex only, so no url(...) fetches.
const HEX = /^#[0-9a-fA-F]{3,8}$/;

function pickHex<K extends string>(raw: unknown, keys: readonly K[]): Record<K, string> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string" || !HEX.test(value)) return null;
    out[key] = value;
  }
  return out;
}

export const paletteOf = (theme: AppTheme): ThemePreviewPalette => ({
  ui: Object.fromEntries(PREVIEW_KEYS.ui.map((k) => [k, theme.ui[k]])) as ThemePreviewPalette["ui"],
  terminal: Object.fromEntries(PREVIEW_KEYS.terminal.map((k) => [k, theme.terminal[k]])) as ThemePreviewPalette["terminal"],
});

export function parsePreview(raw: unknown): ThemePreviewPalette | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { ui, terminal } = raw as Record<string, unknown>;
  const pickedUi = pickHex(ui, PREVIEW_KEYS.ui);
  const pickedTerminal = pickHex(terminal, PREVIEW_KEYS.terminal);
  return pickedUi && pickedTerminal ? { ui: pickedUi, terminal: pickedTerminal } : null;
}

export const THEME_TAG = "theme";

export const isThemeOnly = ({ permissions }: { permissions: string[] }) =>
  permissions.length === 1 && permissions[0] === "themes";

export const isThemeEntry = (p: MarketplacePlugin) => p.theme || p.tags.includes(THEME_TAG);

export function openMarketplaceThemes(): void {
  const ui = useUIStore.getState();
  ui.openSettings("plugins");
  ui.setPluginBrowseRequest({ tag: THEME_TAG });
}

export function availableThemeEntries(entries: MarketplacePlugin[], installedIds: Set<string>): MarketplacePlugin[] {
  const byId = new Map<string, MarketplacePlugin>();
  for (const p of entries) {
    if (!isThemeEntry(p) || installedIds.has(p.id)) continue;
    const seen = byId.get(p.id);
    if (!seen || (seen.sourceId !== FIRST_PARTY_SOURCE.id && p.sourceId === FIRST_PARTY_SOURCE.id)) byId.set(p.id, p);
  }
  return entries.filter((p) => byId.get(p.id) === p);
}

export function pluginThemeIdsFor(pluginThemes: Map<string, unknown>, pluginId: string): string[] {
  return [...pluginThemes.keys()].filter((id) => ownedByPlugin(id, pluginId));
}
