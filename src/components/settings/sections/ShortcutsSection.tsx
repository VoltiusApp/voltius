import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import {
  useShortcutStore,
  formatShortcut,
  getAliases,
  getDefaultShortcut,
  type Shortcut,
} from "@/stores/shortcutStore";
import { useFilterShortcut } from "@/components/shared/ToolbarViewControls";
import { DirtyDot, ResetButton } from "./shared";

const BLOCKED_KEYS = new Set(["Escape", "Tab"]);

type Group = { id: string; label: string; ids: string[] };

const GROUPS: Group[] = [
  { id: "global",     label: "Global",      ids: ["omni", "shortcuts", "themes"] },
  { id: "tabs",       label: "Tabs",        ids: ["new-tab", "close-tab", "next-tab", "prev-tab"] },
  { id: "navigation", label: "Navigation",  ids: ["sidebar", "filter"] },
  { id: "editing",    label: "Editing",     ids: ["delete", "undo", "redo"] },
];

const LABEL_OVERRIDES: Record<string, { label?: string; description?: string }> = {
  shortcuts: { label: "Keyboard Shortcuts", description: "Open shortcut settings" },
  themes:    { label: "Settings",           description: "Open settings" },
};

function displayLabel(sc: Shortcut): string {
  return LABEL_OVERRIDES[sc.id]?.label ?? sc.label;
}
function displayDescription(sc: Shortcut): string {
  return LABEL_OVERRIDES[sc.id]?.description ?? sc.description;
}

function matchesSearch(sc: Shortcut, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase().trim();
  if (!needle) return true;
  const haystack = [
    displayLabel(sc),
    displayDescription(sc),
    formatShortcut(sc),
    ...(getAliases(sc.id)?.map((a) => a.label) ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export default function ShortcutsSection() {
  const { shortcuts, setKey, reset, resetAll } = useShortcutStore();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useFilterShortcut(searchRef);

  const grouped = useMemo(() => {
    const byId = new Map(shortcuts.map((sc) => [sc.id, sc]));
    const known = new Set(GROUPS.flatMap((g) => g.ids));
    const extras = shortcuts.filter((sc) => !known.has(sc.id)).map((sc) => sc.id);
    const groups: Group[] = extras.length
      ? [...GROUPS, { id: "other", label: "Other", ids: extras }]
      : GROUPS;

    return groups
      .map((g) => ({
        ...g,
        items: g.ids
          .map((id) => byId.get(id))
          .filter((sc): sc is Shortcut => !!sc)
          .filter((sc) => matchesSearch(sc, query)),
      }))
      .filter((g) => g.items.length > 0);
  }, [shortcuts, query]);

  const totalMatches = grouped.reduce((n, g) => n + g.items.length, 0);

  useEffect(() => {
    if (!recording) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setRecording(null);
        setConflict(null);
        return;
      }
      if (BLOCKED_KEYS.has(e.key)) return;
      if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;

      e.preventDefault();
      e.stopPropagation();

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;
      const key = e.key;

      const existing = shortcuts.find((sc) => {
        if (sc.id === recording) return false;
        if (sc.key === key && sc.ctrl === ctrl && sc.shift === shift && (sc.alt ?? false) === alt) return true;
        return (
          getAliases(sc.id)?.some(
            (a) => a.key === key && a.ctrl === ctrl && a.shift === shift && (a.alt ?? false) === alt,
          ) ?? false
        );
      });
      if (existing) {
        setConflict(existing.id);
        setTimeout(() => setConflict(null), 1500);
        return;
      }

      setKey(recording, key, ctrl, shift, alt);
      setRecording(null);
      setConflict(null);
    };

    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [recording, shortcuts, setKey]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const isShortcutModified = (sc: Shortcut): boolean => {
    const def = getDefaultShortcut(sc.id);
    if (!def) return false;
    return sc.key !== def.defaultKey || sc.ctrl !== def.ctrl || sc.shift !== def.shift || (sc.alt ?? false) !== def.alt;
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="sticky top-0 z-10 px-6 pt-4 pb-3 bg-(--t-bg-toolbar) border-b border-b-(--t-border)"
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              icon="lucide:search"
              width={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-(--t-text-muted) pointer-events-none"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shortcuts…"
              className="form-input w-full pl-9 pr-8 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm text-(--t-text-muted)"
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
                title="Clear search"
              >
                <Icon icon="lucide:x" width={12} />
              </button>
            )}
          </div>
          <button
            onClick={resetAll}
            className="px-3 py-2 rounded-lg text-xs transition-colors text-(--t-text-secondary) bg-(--t-bg-input) border border-(--t-border)"
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--t-text-bright)";
              e.currentTarget.style.background = "var(--t-bg-input-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--t-text-secondary)";
              e.currentTarget.style.background = "var(--t-bg-input)";
            }}
            title="Reset all shortcuts to defaults"
          >
            Reset all
          </button>
        </div>
        <div className="mt-2.5 flex items-center justify-between text-xs">
          <span
            style={{
              color: recording ? "var(--t-accent)" : "var(--t-text-muted)",
              fontWeight: recording ? 500 : 400,
            }}
          >
            {recording
              ? "Press a key combination… (Esc to cancel)"
              : "Click a shortcut to rebind it."}
          </span>
          {query && (
            <span className="text-(--t-text-muted)">
              {totalMatches} {totalMatches === 1 ? "result" : "results"}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-(--t-text-muted)">
            <Icon icon="lucide:search-x" width={32} />
            <p className="text-sm">No shortcuts match "{query}"</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.id}>
              <h3 className="text-[11px] font-bold uppercase tracking-widest mb-2 px-1 text-(--t-text-secondary)">
                {group.label}
              </h3>
              <div
                className="rounded-xl overflow-hidden border bg-(--t-bg-card)"
                style={{ borderColor: "var(--t-border)" }}
              >
                {group.items.map((sc, idx) => {
                  const isRecording = recording === sc.id;
                  const isConflict = conflict === sc.id;
                  const modified = isShortcutModified(sc);
                  const aliases = getAliases(sc.id) ?? [];
                  return (
                    <div
                      key={sc.id}
                      className="flex items-center gap-3 px-4 py-3 group transition-colors"
                      style={{
                        borderTop: idx === 0 ? undefined : "1px solid var(--t-bg-base)",
                        background: isRecording ? "var(--t-bg-card-hover)" : undefined,
                      }}
                      onMouseEnter={(e) => {
                        if (!isRecording) e.currentTarget.style.background = "var(--t-bg-card-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isRecording) e.currentTarget.style.background = "";
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-(--t-text-bright) truncate">
                          {displayLabel(sc)}
                        </p>
                        <p className="text-xs mt-0.5 text-(--t-text-muted) truncate">
                          {displayDescription(sc)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {modified && <ResetButton onReset={() => reset(sc.id)} />}
                        {modified && <DirtyDot />}

                        <button
                          onClick={() => {
                            setRecording(isRecording ? null : sc.id);
                            setConflict(null);
                          }}
                          className="rounded-md text-[11px] font-mono leading-none transition-colors"
                          style={{
                            background: isRecording || isConflict
                              ? "transparent"
                              : "var(--t-bg-base)",
                            border: `1px solid ${
                              isRecording
                                ? "var(--t-accent)"
                                : isConflict
                                  ? "var(--t-status-error)"
                                  : "var(--t-border)"
                            }`,
                            color: isRecording
                              ? "var(--t-accent)"
                              : isConflict
                                ? "var(--t-status-error)"
                                : "var(--t-text-primary)",
                            padding: "5px 9px",
                            minWidth: "92px",
                            textAlign: "center",
                            letterSpacing: "0.02em",
                          }}
                          onMouseEnter={(e) => {
                            if (!isRecording && !isConflict) {
                              e.currentTarget.style.borderColor = "var(--t-border-hover)";
                              e.currentTarget.style.color = "var(--t-text-bright)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isRecording && !isConflict) {
                              e.currentTarget.style.borderColor = "var(--t-border)";
                              e.currentTarget.style.color = "var(--t-text-primary)";
                            }
                          }}
                          title={isRecording ? "Press a key combo or Esc to cancel" : "Click to rebind"}
                        >
                          {isRecording ? "Press key…" : isConflict ? "Conflict" : formatShortcut(sc)}
                        </button>

                        {aliases.map((alias) => (
                          <span
                            key={alias.label}
                            title="Fixed shortcut — always active"
                            className="rounded-md text-[11px] font-mono leading-none text-(--t-text-muted)"
                            style={{
                              background: "var(--t-bg-base)",
                              border: "1px solid var(--t-border)",
                              padding: "5px 9px",
                              letterSpacing: "0.02em",
                            }}
                          >
                            {alias.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
