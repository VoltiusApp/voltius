import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { getAgentDeps, useAgentStore } from "../state/agentStore";
import { FirstRunCard } from "./FirstRunCard";
import { ProviderLogo } from "./ProviderLogo";
import type { ProviderProfile } from "../types";

/**
 * Composer-footer quick-switcher (spec §6): shows the active provider profile
 * as `label · model`, and opens a small popover to switch profiles or add a
 * new one (reusing `FirstRunCard` inline instead of the settings page).
 *
 * Switching just calls `profilesStore.setActive(id)` — `agentStore.sendMessage`
 * re-resolves the active profile via `getActiveId()`/`list()` on every call, so
 * the next message picks up the new profile with no extra wiring here.
 */
export function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const profilesVersion = useAgentStore((s) => s.profilesVersion);

  const refresh = async () => {
    const deps = getAgentDeps();
    if (!deps) return;
    const [id, list] = await Promise.all([deps.profiles.getActiveId(), deps.profiles.list()]);
    setActiveId(id);
    setProfiles(list);
  };

  // Re-reads on every profile mutation (create/edit/delete elsewhere, e.g. the
  // settings page), not just on mount — an already-open drawer would
  // otherwise keep showing the snapshot it seeded on first render.
  useEffect(() => {
    void refresh();
  }, [profilesVersion]);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setAdding(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [menuOpen]);

  const active = profiles.find((p) => p.id === activeId) ?? null;

  const onSelect = async (id: string) => {
    const deps = getAgentDeps();
    if (!deps) return;
    await deps.profiles.setActive(id);
    setActiveId(id);
    // Every other profile mutation bumps this so a settings page open behind
    // the drawer re-reads (see ProfileEditor/ProfilesBlock/FirstRunCard).
    useAgentStore.getState().bumpProfilesVersion();
    setMenuOpen(false);
  };

  const onAdded = async () => {
    await refresh();
    setAdding(false);
    setMenuOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title="Switch AI provider"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          background: "transparent",
          border: "1px solid var(--t-border)",
          borderRadius: 999,
          padding: "2px 8px",
          color: "var(--t-text-secondary)",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        {active ? (
          <ProviderLogo kind={active.providerKind} size={12} />
        ) : (
          <Icon icon="lucide:cpu" width={12} style={{ flexShrink: 0 }} />
        )}
        <span
          title={active ? `${active.label} · ${active.model}` : undefined}
          style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {active ? `${active.label} · ${active.model}` : "No provider"}
        </span>
        <Icon icon="lucide:chevron-down" width={11} style={{ flexShrink: 0 }} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            width: adding ? 300 : 220,
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--t-bg-elevated)",
            border: "1px solid var(--t-border)",
            borderRadius: 8,
            boxShadow: "var(--t-elev-2)",
            zIndex: 60,
          }}
        >
          {adding ? (
            <FirstRunCard onDone={() => void onAdded()} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", padding: 4 }}>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={p.id === activeId}
                  onClick={() => void onSelect(p.id)}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    background: p.id === activeId ? "var(--t-bg-hover, rgba(128,128,128,0.12))" : "transparent",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 8px",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <ProviderLogo kind={p.providerKind} size={16} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                    <span style={{ color: "var(--t-text-bright)", fontSize: 12, fontWeight: 500 }}>{p.label}</span>
                    <span style={{ color: "var(--t-text-secondary)", fontSize: 11 }}>{p.model}</span>
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAdding(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "transparent",
                  border: "none",
                  borderTop: profiles.length ? "1px solid var(--t-border)" : "none",
                  marginTop: profiles.length ? 4 : 0,
                  paddingTop: profiles.length ? 6 : 0,
                  padding: "6px 8px",
                  color: "var(--t-accent)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <Icon icon="lucide:plus" width={13} />
                Add provider…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
