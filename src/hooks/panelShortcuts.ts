import { matchShortcut } from "@/stores/shortcutStore";
import type { BuiltinRightPanelSection } from "@/stores/uiStore";

const PANEL_SHORTCUTS: [shortcutId: string, section: BuiltinRightPanelSection][] = [
  ["history", "history"],
  ["snippets", "snippets"],
  ["panel-themes", "themes"],
  ["panel-notes", "notes"],
];

export function matchPanelShortcut(e: KeyboardEvent): BuiltinRightPanelSection | null {
  return PANEL_SHORTCUTS.find(([id]) => matchShortcut(id, e))?.[1] ?? null;
}
