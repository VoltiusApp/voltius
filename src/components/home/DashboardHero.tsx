import { Icon } from "@iconify/react";
import { useEffect } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSessionStore } from "@/stores/sessionStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutStore, formatShortcut } from "@/stores/shortcutStore";
import { useActiveTunnelCount } from "@/hooks/useActiveTunnelCount";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface StatChipProps {
  icon: string;
  label: string;
  value: number;
}

function StatChip({ icon, label, value }: StatChipProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
    >
      <Icon icon={icon} width={14} style={{ color: "var(--t-text-dim)" }} />
      <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>
        {label}
      </span>
    </div>
  );
}

export function DashboardHero() {
  const vaultCount = useVaultStore((s) => s.vaults.length);
  const hostCount = useConnectionStore((s) => s.connections.length);
  const activeSessionCount = useSessionStore((s) => s.sessions.filter((sess) => sess.status === "connected").length);
  const savedRulesCount = usePortForwardingStore((s) => s.rules.length);
  const loadRules = usePortForwardingStore((s) => s.loadRules);
  const activeTunnelCount = useActiveTunnelCount();
  const portForwardCount = activeTunnelCount > 0 ? activeTunnelCount : savedRulesCount;
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const omniShortcut = shortcuts.find((s) => s.id === "omni");

  useEffect(() => { loadRules().catch(() => {}); }, [loadRules]);

  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold mb-3" style={{ color: "var(--t-text-primary)" }}>
        {greeting()}
      </h1>

      <button
        onClick={() => setOmniOpen(true)}
        className="flex items-center gap-3 w-full px-4 h-11 rounded-xl mb-5 transition-colors text-left"
        style={{
          background: "var(--t-bg-input)",
          border: "1px solid var(--t-border)",
          color: "var(--t-text-dim)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
        }}
      >
        <Icon icon="lucide:search" width={15} className="shrink-0" />
        <span className="text-sm flex-1">Search hosts, sessions, snippets…</span>
        {omniShortcut && (
          <kbd
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded shrink-0"
            style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-dim)", border: "1px solid var(--t-border)" }}
          >
            {formatShortcut(omniShortcut)}
          </kbd>
        )}
      </button>

      <div className="flex flex-wrap gap-2">
        <StatChip icon="lucide:vault" label="vaults" value={vaultCount} />
        <StatChip icon="lucide:server" label="hosts" value={hostCount} />
        <StatChip icon="lucide:terminal" label="active sessions" value={activeSessionCount} />
        <StatChip icon="lucide:network" label="port forwards" value={portForwardCount} />
      </div>
    </div>
  );
}
