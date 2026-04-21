import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ShortcutAlias {
  key: string;
  ctrl: boolean;
  shift: boolean;
  label: string;
}

export interface Shortcut {
  id: string;
  label: string;
  description: string;
  defaultKey: string;
  key: string; // current (possibly overridden) key
  ctrl: boolean;
  shift: boolean;
}

/** Static alias definitions — not persisted, always active */
const ALIASES: Record<string, ShortcutAlias[]> = {
  omni: [
    { key: "P",  ctrl: true,  shift: true,  label: "Ctrl+Shift+P" },
    { key: "F1", ctrl: false, shift: false, label: "F1" },
  ],
  redo: [
    { key: "y", ctrl: true, shift: false, label: "Ctrl+Y" },
  ],
};

export function getAliases(id: string): ShortcutAlias[] | undefined {
  return ALIASES[id];
}

const DEFAULTS: Omit<Shortcut, "key">[] = [
  { id: "omni",         label: "Omni Search",       description: "Search hosts & tabs",    defaultKey: "k",   ctrl: true,  shift: false },
  { id: "shortcuts",    label: "Shortcuts Panel",   description: "Show/hide this panel",   defaultKey: " ",   ctrl: true,  shift: false },
  { id: "themes",       label: "Theme Panel",       description: "Open theme selector",    defaultKey: ",",   ctrl: true,  shift: false },
  { id: "new-tab",      label: "New Tab",           description: "Go to hosts view",       defaultKey: "t",   ctrl: true,  shift: false },
  { id: "close-tab",    label: "Close Tab",         description: "Close active session",   defaultKey: "w",   ctrl: true,  shift: false },
  { id: "next-tab",     label: "Next Tab",          description: "Switch to next tab",     defaultKey: "Tab", ctrl: true,  shift: false },
  { id: "prev-tab",     label: "Previous Tab",      description: "Switch to prev tab",     defaultKey: "Tab", ctrl: true,  shift: true  },
  { id: "sidebar",      label: "Toggle Sidebar",    description: "Show/hide sidebar",      defaultKey: "b",   ctrl: true,  shift: false },
  { id: "delete",       label: "Delete Selected",   description: "Delete selected items",   defaultKey: "Delete", ctrl: false, shift: false },
  { id: "undo",         label: "Undo",              description: "Undo last action",         defaultKey: "z",      ctrl: true,  shift: false },
  { id: "redo",         label: "Redo",              description: "Redo last undone action",  defaultKey: "z",      ctrl: true,  shift: true  },
];

function toShortcut(s: Omit<Shortcut, "key">): Shortcut {
  return { ...s, key: s.defaultKey };
}

interface ShortcutStore {
  shortcuts: Shortcut[];
  setKey: (id: string, key: string, ctrl: boolean, shift: boolean) => void;
  reset: (id: string) => void;
  resetAll: () => void;
}

export const useShortcutStore = create<ShortcutStore>()(
  persist(
    (set) => ({
      shortcuts: DEFAULTS.map(toShortcut),

      setKey: (id, key, ctrl, shift) =>
        set((s) => ({
          shortcuts: s.shortcuts.map((sc) =>
            sc.id === id ? { ...sc, key, ctrl, shift } : sc,
          ),
        })),

      reset: (id) =>
        set((s) => ({
          shortcuts: s.shortcuts.map((sc) => {
            if (sc.id !== id) return sc;
            const def = DEFAULTS.find((d) => d.id === id)!;
            return { ...sc, key: def.defaultKey, ctrl: def.ctrl, shift: def.shift };
          }),
        })),

      resetAll: () => set({ shortcuts: DEFAULTS.map(toShortcut) }),
    }),
    { name: "voltius-shortcuts" },
  ),
);

export function matchShortcut(id: string, e: KeyboardEvent): boolean {
  const sc = useShortcutStore.getState().shortcuts.find((s) => s.id === id);
  if (!sc) return false;
  const ctrl = e.ctrlKey || e.metaKey;

  // Check primary
  if (ctrl === sc.ctrl && e.shiftKey === sc.shift && e.key === sc.key) return true;

  // Check static aliases
  return ALIASES[id]?.some(
    (a) => ctrl === a.ctrl && e.shiftKey === a.shift && e.key === a.key,
  ) ?? false;
}

export function getShortcutHint(id: string): string | undefined {
  const sc = useShortcutStore.getState().shortcuts.find((s) => s.id === id);
  return sc ? formatShortcut(sc) : undefined;
}

export function formatShortcut(sc: Shortcut): string {
  const parts: string[] = [];
  if (sc.ctrl) parts.push("Ctrl");
  if (sc.shift) parts.push("Shift");
  parts.push(sc.key === " " ? "Space" : sc.key);
  return parts.join("+");
}
