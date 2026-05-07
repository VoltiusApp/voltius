import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutStore, formatShortcut, getAliases } from "@/stores/shortcutStore";

const BLOCKED_KEYS = new Set(["Escape", "Tab"]);

export default function ShortcutsPanel() {
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);
  const { shortcuts, setKey, reset, resetAll } = useShortcutStore();
  const [recording, setRecording] = useState<string | null>(null); // shortcut id being recorded
  const [conflict, setConflict] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape, record key on keydown when recording
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (recording) {
          setRecording(null);
          setConflict(null);
        } else setOpen(false);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!recording) return;
      if (BLOCKED_KEYS.has(e.key)) return;

      e.preventDefault();
      e.stopPropagation();

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key;

      // Prevent modifier-only
      if (["Control", "Meta", "Shift", "Alt"].includes(key)) return;

      // Check for conflict (primary keys + static aliases)
      const existing = shortcuts.find((sc) => {
        if (sc.id === recording) return false;
        // Conflict with primary
        if (sc.key === key && sc.ctrl === ctrl && sc.shift === shift) return true;
        // Conflict with an alias
        return getAliases(sc.id)?.some(
          (a) => a.key === key && a.ctrl === ctrl && a.shift === shift,
        ) ?? false;
      });
      if (existing) {
        setConflict(existing.id);
        setTimeout(() => setConflict(null), 1500);
        return;
      }

      setKey(recording, key, ctrl, shift);
      setRecording(null);
      setConflict(null);
    };

    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [open, recording, shortcuts, setKey, setOpen]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop (click outside to close) */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => {
          setRecording(null);
          setOpen(false);
        }}
      />

      {/* Side panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col bg-[var(--t-bg-terminal)] border-l border-l-[var(--t-border)]"
        style={{
          width: "340px",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0 border-b border-b-[var(--t-border)]"
        >
          <div className="flex items-center gap-2.5">
            <Icon icon="lucide:keyboard" width={16} className="text-[var(--t-accent)]" />
            <span className="text-sm font-medium text-[var(--t-text-bright)]">
              Keyboard Shortcuts
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetAll}
              className="text-xs px-2 py-1 rounded transition-colors text-[var(--t-text-muted)]"
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
              title="Reset all to defaults"
            >
              Reset all
            </button>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg transition-colors text-[var(--t-text-muted)]"
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
            >
              <Icon icon="lucide:x" width={14} />
            </button>
          </div>
        </div>

        {/* Shortcuts list */}
        <div className="flex-1 overflow-y-auto py-3">
          {shortcuts.map((sc) => {
            const isRecording = recording === sc.id;
            const isConflict = conflict === sc.id;
            const isModified =
              sc.key !== sc.defaultKey ||
              sc.ctrl !== getDefault(sc.id)?.ctrl ||
              sc.shift !== getDefault(sc.id)?.shift;

            return (
              <div
                key={sc.id}
                className="flex items-center gap-3 px-5 py-3 group border-b border-b-[var(--t-bg-base)]"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">
                    {sc.label}
                    {isModified && (
                      <span className="ml-1.5 text-xs text-[var(--t-text-muted)]">
                        (modified)
                      </span>
                    )}
                  </p>
                  <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                    {sc.description}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isModified && (
                    <button
                      onClick={() => reset(sc.id)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-[var(--t-text-muted)]"
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.color = "var(--t-text-primary)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.color = "var(--t-text-muted)")
                      }
                      title="Reset to default"
                    >
                      <Icon icon="lucide:rotate-ccw" width={11} />
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setRecording(isRecording ? null : sc.id);
                      setConflict(null);
                    }}
                    className="px-2.5 py-1 rounded-md text-xs font-mono transition-all"
                    style={{
                      background: isRecording
                        ? "var(--t-bg-elevated)"
                        : isConflict
                          ? "#2D1515"
                          : "var(--t-bg-toolbar)",
                      border: `1px solid ${
                        isRecording
                          ? "var(--t-accent)"
                          : isConflict
                            ? "#5C2020"
                            : "var(--t-border)"
                      }`,
                      color: isRecording
                        ? "var(--t-accent)"
                        : isConflict
                          ? "#F87171"
                          : "var(--t-text-primary)",
                      minWidth: "80px",
                      textAlign: "center",
                    }}
                    title="Click to rebind"
                  >
                    {isRecording ? "Press key…" : isConflict ? "Conflict!" : formatShortcut(sc)}
                  </button>

                  {/* Static aliases — always active, not rebindable */}
                  {getAliases(sc.id)?.map((alias) => (
                    <span
                      key={alias.label}
                      title="Fixed shortcut — always active"
                      className="px-2 py-0.5 rounded text-xs font-mono bg-[var(--t-bg-base)] border border-[var(--t-border)] text-[var(--t-text-dim)]"
                    >
                      {alias.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div
          className="px-5 py-3 shrink-0 text-xs border-t border-t-[var(--t-border)] text-[var(--t-text-dim)]"
        >
          Click a shortcut badge to rebind it. Press Escape to cancel.
        </div>
      </div>
    </>
  );
}

function getDefault(id: string) {
  return useShortcutStore.getState().shortcuts.find((s) => s.id === id);
}
