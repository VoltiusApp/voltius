import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ShortcutAlias {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  label: string;
}

export interface Shortcut {
  id: string;
  /** i18n key resolving to the display label, translated at render time (see ShortcutsSection.tsx) */
  labelKey: string;
  /** i18n key resolving to the display description, translated at render time */
  descriptionKey: string;
  defaultKey: string;
  key: string; // current (possibly overridden) key
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** Static alias definitions — not persisted, always active */
const ALIASES: Record<string, ShortcutAlias[]> = {
  omni: [
    { key: "P",  ctrl: true,  shift: true,  alt: false, label: "Ctrl+Shift+P" },
    { key: "F1", ctrl: false, shift: false, alt: false, label: "F1" },
  ],
  redo: [
    { key: "y", ctrl: true, shift: false, alt: false, label: "Ctrl+Y" },
  ],
};

export function getAliases(id: string): ShortcutAlias[] | undefined {
  return ALIASES[id];
}

export function getDefaultShortcut(id: string): Omit<Shortcut, "key"> | undefined {
  return DEFAULTS.find((d) => d.id === id);
}

const DEFAULTS: Omit<Shortcut, "key">[] = [
  { id: "omni",            labelKey: "settings.shortcuts.items.omni.label",            descriptionKey: "settings.shortcuts.items.omni.desc",            defaultKey: "k",      ctrl: true,  shift: false, alt: false },
  { id: "shortcuts",       labelKey: "settings.shortcuts.items.shortcuts.label",       descriptionKey: "settings.shortcuts.items.shortcuts.desc",       defaultKey: " ",      ctrl: true,  shift: false, alt: false },
  { id: "themes",          labelKey: "settings.shortcuts.items.themes.label",          descriptionKey: "settings.shortcuts.items.themes.desc",          defaultKey: ",",      ctrl: true,  shift: false, alt: false },
  { id: "new-tab",         labelKey: "settings.shortcuts.items.newTab.label",          descriptionKey: "settings.shortcuts.items.newTab.desc",          defaultKey: "t",      ctrl: true,  shift: false, alt: false },
  { id: "duplicate-session",       labelKey: "settings.shortcuts.items.duplicateSession.label",      descriptionKey: "settings.shortcuts.items.duplicateSession.desc",      defaultKey: "d", ctrl: true, shift: true,  alt: false },
  { id: "duplicate-session-split", labelKey: "settings.shortcuts.items.duplicateSessionSplit.label", descriptionKey: "settings.shortcuts.items.duplicateSessionSplit.desc", defaultKey: "d", ctrl: true, shift: false, alt: true },
  { id: "close-tab",       labelKey: "settings.shortcuts.items.closeTab.label",        descriptionKey: "settings.shortcuts.items.closeTab.desc",        defaultKey: "w",      ctrl: true,  shift: false, alt: false },
  { id: "next-tab",        labelKey: "settings.shortcuts.items.nextTab.label",         descriptionKey: "settings.shortcuts.items.nextTab.desc",         defaultKey: "Tab",    ctrl: true,  shift: false, alt: false },
  { id: "prev-tab",        labelKey: "settings.shortcuts.items.prevTab.label",         descriptionKey: "settings.shortcuts.items.prevTab.desc",         defaultKey: "Tab",    ctrl: true,  shift: true,  alt: false },
  { id: "sidebar",         labelKey: "settings.shortcuts.items.sidebar.label",         descriptionKey: "settings.shortcuts.items.sidebar.desc",         defaultKey: "b",      ctrl: true,  shift: false, alt: false },
  { id: "delete",          labelKey: "settings.shortcuts.items.delete.label",          descriptionKey: "settings.shortcuts.items.delete.desc",          defaultKey: "Delete", ctrl: false, shift: false, alt: false },
  { id: "undo",            labelKey: "settings.shortcuts.items.undo.label",            descriptionKey: "settings.shortcuts.items.undo.desc",            defaultKey: "z",      ctrl: true,  shift: false, alt: false },
  { id: "redo",            labelKey: "settings.shortcuts.items.redo.label",            descriptionKey: "settings.shortcuts.items.redo.desc",            defaultKey: "z",      ctrl: true,  shift: true,  alt: false },
  { id: "filter",          labelKey: "settings.shortcuts.items.filter.label",          descriptionKey: "settings.shortcuts.items.filter.desc",          defaultKey: "f",      ctrl: true,  shift: false, alt: false },
  { id: "terminal-search", labelKey: "settings.shortcuts.items.terminalSearch.label",  descriptionKey: "settings.shortcuts.items.terminalSearch.desc",  defaultKey: "f",      ctrl: true,  shift: false, alt: false },
  { id: "history",         labelKey: "settings.shortcuts.items.history.label",         descriptionKey: "settings.shortcuts.items.history.desc",         defaultKey: "h",      ctrl: true,  shift: true,  alt: false },
  { id: "snippets",        labelKey: "settings.shortcuts.items.snippets.label",        descriptionKey: "settings.shortcuts.items.snippets.desc",        defaultKey: "s",      ctrl: true,  shift: true,  alt: false },
  { id: "panel-themes",    labelKey: "settings.shortcuts.items.panelThemes.label",     descriptionKey: "settings.shortcuts.items.panelThemes.desc",     defaultKey: "t",      ctrl: true,  shift: true,  alt: false },
  { id: "copy",  labelKey: "settings.shortcuts.items.copy.label",  descriptionKey: "settings.shortcuts.items.copy.desc",  defaultKey: "c", ctrl: true, shift: false, alt: false },
  { id: "cut",   labelKey: "settings.shortcuts.items.cut.label",   descriptionKey: "settings.shortcuts.items.cut.desc",   defaultKey: "x", ctrl: true, shift: false, alt: false },
  { id: "paste", labelKey: "settings.shortcuts.items.paste.label", descriptionKey: "settings.shortcuts.items.paste.desc", defaultKey: "v", ctrl: true, shift: false, alt: false },
];

function toShortcut(s: Omit<Shortcut, "key">): Shortcut {
  return { ...s, key: s.defaultKey };
}

interface ShortcutStore {
  shortcuts: Shortcut[];
  shortcutsUpdatedAt: string;
  setKey: (id: string, key: string, ctrl: boolean, shift: boolean, alt: boolean) => void;
  reset: (id: string) => void;
  resetAll: () => void;
}

export const useShortcutStore = create<ShortcutStore>()(
  persist(
    (set) => ({
      shortcuts: DEFAULTS.map(toShortcut),
      shortcutsUpdatedAt: new Date(0).toISOString(),

      setKey: (id, key, ctrl, shift, alt) => {
        set((s) => ({ shortcutsUpdatedAt: new Date().toISOString(), shortcuts: s.shortcuts.map((sc) => sc.id === id ? { ...sc, key, ctrl, shift, alt } : sc) }));
        import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {});
      },

      reset: (id) => {
        set((s) => ({
          shortcutsUpdatedAt: new Date().toISOString(),
          shortcuts: s.shortcuts.map((sc) => {
            if (sc.id !== id) return sc;
            const def = DEFAULTS.find((d) => d.id === id)!;
            return { ...sc, key: def.defaultKey, ctrl: def.ctrl, shift: def.shift, alt: def.alt };
          }),
        }));
        import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {});
      },

      resetAll: () => {
        set({ shortcuts: DEFAULTS.map(toShortcut), shortcutsUpdatedAt: new Date().toISOString() });
        import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {});
      },
    }),
    {
      name: "voltius-shortcuts",
      // Bump on every DEFAULTS addition: migrate is what merges new entries into a persisted set.
      version: 7,
      // v5: label/description (literal English strings) → labelKey/descriptionKey
      // (i18n keys resolved at render time). Re-derive keys from `id`; drop the
      // stale literal fields so old English text can't linger in persisted state.
      migrate: (persisted, version) => {
        const state = persisted as { shortcuts?: Array<Record<string, unknown>> } | undefined;
        if (version < 5 && state?.shortcuts) {
          state.shortcuts = state.shortcuts.map((sc) => {
            const { label: _label, description: _description, ...rest } = sc;
            const def = DEFAULTS.find((d) => d.id === sc.id);
            return { ...rest, labelKey: def?.labelKey ?? "", descriptionKey: def?.descriptionKey ?? "" };
          });
        }
        // Shortcuts added after a user first persisted their set would otherwise
        // never appear, because persist replaces the array rather than merging it.
        if (state?.shortcuts) {
          const present = new Set(state.shortcuts.map((sc) => sc.id as string));
          for (const def of DEFAULTS) {
            if (!present.has(def.id)) state.shortcuts.push({ ...def, key: def.defaultKey });
          }
        }
        return state as unknown as ShortcutStore;
      },
    },
  ),
);

// Single-char letter keys normalize case so Ctrl+Shift+H matches defaultKey "h"
function normalizeKey(k: string): string {
  return k.length === 1 ? k.toLowerCase() : k;
}

export function matchShortcut(id: string, e: KeyboardEvent): boolean {
  const sc = useShortcutStore.getState().shortcuts.find((s) => s.id === id);
  if (!sc) return false;
  const ctrl = e.ctrlKey || e.metaKey;

  // Check primary
  if (ctrl === sc.ctrl && e.shiftKey === sc.shift && e.altKey === (sc.alt ?? false) && normalizeKey(e.key) === normalizeKey(sc.key)) return true;

  // Check static aliases
  return ALIASES[id]?.some(
    (a) => ctrl === a.ctrl && e.shiftKey === a.shift && e.altKey === (a.alt ?? false) && normalizeKey(e.key) === normalizeKey(a.key),
  ) ?? false;
}

export function getShortcutHint(id: string): string | undefined {
  const sc = useShortcutStore.getState().shortcuts.find((s) => s.id === id);
  return sc ? formatShortcut(sc) : undefined;
}

export function formatShortcut(sc: Shortcut): string {
  const parts: string[] = [];
  if (sc.ctrl) parts.push("Ctrl");
  if (sc.alt) parts.push("Alt");
  if (sc.shift) parts.push("Shift");
  parts.push(sc.key === " " ? "Space" : sc.key);
  return parts.join("+");
}
