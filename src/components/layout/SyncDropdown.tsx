import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { getSyncState, onSyncStateChange, syncNow, type SyncStatus } from "@/services/sync";
import {
  getGistSyncState,
  onGistSyncStateChange,
  syncNow as gistSyncNow,
  type GistSyncState,
} from "@/plugins/gist-sync/sync-engine";
import { useVaultContents } from "@/hooks/useVaultContents";
import { useUIStore } from "@/stores/uiStore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function statusColor(status: SyncStatus): string {
  if (status === "success") return "var(--t-status-connected)";
  if (status === "error")   return "var(--t-status-error)";
  if (status === "syncing") return "var(--t-text-primary)";
  if (status === "offline") return "var(--t-text-dim)";
  return "var(--t-text-muted)";
}

function statusIcon(status: SyncStatus): string {
  if (status === "syncing") return "lucide:refresh-cw";
  if (status === "success") return "lucide:cloud-check";
  if (status === "error")   return "lucide:cloud-alert";
  if (status === "offline") return "lucide:wifi-off";
  return "lucide:cloud";
}

function statusLabel(status: SyncStatus, lastSync: Date | null): string {
  if (status === "syncing") return "Syncing…";
  if (status === "success") return lastSync ? `Synced · ${formatTime(lastSync)}` : "Synced";
  if (status === "error")   return "Sync error";
  if (status === "offline") return "Offline";
  return "Idle";
}

// ─── Section ──────────────────────────────────────────────────────────────────

type SectionVariant =
  | { kind: "active"; status: SyncStatus; lastSync: Date | null; error: string | null; blobSizeBytes: number | null }
  | { kind: "misconfigured"; onConfigure: () => void }
  | { kind: "disabled"; onEnable: () => void }
  | { kind: "locked"; onSignIn: () => void };

function SyncSection({
  label,
  methodIcon,
  variant,
  onSyncNow,
}: {
  label: string;
  methodIcon: string;
  variant: SectionVariant;
  onSyncNow: () => void;
}) {
  const isActive = variant.kind === "active";
  const isSyncing = isActive && variant.status === "syncing";
  const [spinning, setSpinning] = useState(isSyncing);

  useEffect(() => {
    setSpinning(isActive && variant.status === "syncing");
  }, [isActive, isActive ? variant.status : null]);

  const canSync = isActive && !spinning;

  const handleSync = () => {
    if (!canSync) return;
    setSpinning(true);
    onSyncNow();
  };

  return (
    <div className="px-3 py-2.5 space-y-2">
      {/* Method header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon icon={methodIcon} width={12} style={{ color: "var(--t-text-dim)" }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-text-dim)" }}>
            {label}
          </span>
        </div>
        <button
          onClick={handleSync}
          disabled={!canSync}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all"
          style={{
            color: canSync ? "var(--t-text-secondary)" : "var(--t-text-dim)",
            background: "var(--t-bg-elevated)",
            opacity: !isActive ? 0.4 : 1,
          }}
          onMouseEnter={(e) => {
            if (canSync) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = canSync ? "var(--t-text-secondary)" : "var(--t-text-dim)";
          }}
          title="Sync now"
        >
          <Icon icon="lucide:refresh-cw" width={10} className={spinning ? "animate-spin" : ""} />
          Sync now
        </button>
      </div>

      {/* State body */}
      {variant.kind === "locked" && (
        <button
          onClick={variant.onSignIn}
          className="w-full flex items-center gap-1.5 text-left"
          style={{ color: "var(--t-accent)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.75")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
        >
          <Icon icon="lucide:log-in" width={11} />
          <span className="text-xs">Sign in for cloud sync</span>
          <Icon icon="lucide:arrow-right" width={10} className="ml-auto" />
        </button>
      )}

      {variant.kind === "disabled" && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5" style={{ color: "var(--t-text-dim)" }}>
            <Icon icon="lucide:puzzle" width={11} />
            <span className="text-xs">Plugin disabled</span>
          </div>
          <button
            onClick={variant.onEnable}
            className="text-[10px] font-medium transition-opacity"
            style={{ color: "var(--t-accent)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.75")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
          >
            Enable →
          </button>
        </div>
      )}

      {variant.kind === "misconfigured" && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5" style={{ color: "var(--t-status-warning, var(--t-text-dim))" }}>
            <Icon icon="lucide:alert-triangle" width={11} style={{ color: "var(--t-status-error)" }} />
            <span className="text-xs" style={{ color: "var(--t-status-error)" }}>Not configured</span>
          </div>
          <button
            onClick={variant.onConfigure}
            className="text-[10px] font-medium transition-opacity"
            style={{ color: "var(--t-accent)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.75")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
          >
            Configure →
          </button>
        </div>
      )}

      {variant.kind === "active" && (() => {
        const { status, lastSync, error, blobSizeBytes } = variant;
        const color = statusColor(status);
        return (
          <>
            <div className="flex items-center gap-1.5">
              <Icon
                icon={statusIcon(status)}
                width={12}
                className={status === "syncing" ? "animate-spin" : ""}
                style={{ color }}
              />
              <span className="text-xs" style={{ color }}>
                {statusLabel(status, lastSync)}
              </span>
            </div>
            {status === "error" && error && (
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--t-status-error)" }}>
                {error}
              </p>
            )}
            {blobSizeBytes !== null && (
              <div className="flex items-center gap-1" style={{ color: "var(--t-text-muted)" }}>
                <Icon icon="lucide:lock" width={10} />
                <span className="text-[10px]">Encrypted blob · {formatBytes(blobSizeBytes)}</span>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ─── Entity counts ────────────────────────────────────────────────────────────

function EntityCounts() {
  const counts = useVaultContents().filter((c) => c.count > 0);
  if (counts.length === 0) return null;
  return (
    <div className="px-3 py-2 flex flex-wrap gap-1.5">
      {counts.map(({ icon, count }) => (
        <span
          key={icon}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px]"
          style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-secondary)", border: "1px solid var(--t-border)" }}
        >
          <Icon icon={icon} width={10} />
          {count}
        </span>
      ))}
    </div>
  );
}

// ─── Main dropdown ────────────────────────────────────────────────────────────

interface SyncDropdownProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  cloudActive: boolean;
  gistPluginEnabled: boolean;
  accountMode: string | null;
}

export function SyncDropdown({ anchorRef, open, onClose, gistPluginEnabled, accountMode }: SyncDropdownProps) {
  const openSettings = useUIStore((s) => s.openSettings);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const panelRef = useRef<HTMLDivElement>(null);
  useClickOutside(panelRef, onClose, open);

  const [voltiusState, setVoltiusState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setVoltiusState(getSyncState())), []);

  const [gistState, setGistState] = useState<GistSyncState>(getGistSyncState);
  useEffect(() => onGistSyncStateChange(() => setGistState(getGistSyncState())), []);

  if (!open) return null;

  const isLoggedIn = accountMode === "server";

  // Build per-section variants
  const voltiusVariant: SectionVariant = !isLoggedIn
    ? { kind: "locked", onSignIn: () => { onClose(); openCloudAuth("signin"); } }
    : { kind: "active", status: voltiusState.status, lastSync: voltiusState.lastSync, error: voltiusState.error, blobSizeBytes: voltiusState.blobSizeBytes };

  const gistVariant: SectionVariant = !gistPluginEnabled
    ? { kind: "disabled", onEnable: () => { onClose(); openSettings("plugins"); } }
    : !gistState.configured
    ? { kind: "misconfigured", onConfigure: () => { onClose(); openSettings("plugins", "plugin-gist-sync:gist-sync-settings"); } }
    : { kind: "active", status: gistState.status, lastSync: gistState.lastSync, error: gistState.error, blobSizeBytes: gistState.blobSizeBytes };

  // Position below anchor
  const anchor = anchorRef.current;
  const rect = anchor?.getBoundingClientRect();
  const right = rect ? window.innerWidth - rect.right : 8;
  const top = rect ? rect.bottom + 6 : 60;

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-64 rounded-xl overflow-hidden"
      style={{
        top,
        right,
        background: "var(--t-bg-card)",
        border: "1px solid var(--t-border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--t-border)" }}
      >
        <span className="text-xs font-semibold" style={{ color: "var(--t-text-primary)" }}>
          Sync
        </span>
        <button
          onClick={onClose}
          className="p-0.5 rounded transition-colors"
          style={{ color: "var(--t-text-dim)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)")}
        >
          <Icon icon="lucide:x" width={13} />
        </button>
      </div>

      {/* Voltius Sync section */}
      <SyncSection
        label="Voltius Sync"
        methodIcon="lucide:cloud"
        variant={voltiusVariant}
        onSyncNow={() => syncNow(true).catch(() => {})}
      />

      <div style={{ height: 1, background: "var(--t-border)" }} />

      {/* Gist E2EE section */}
      <SyncSection
        label="Gist E2EE"
        methodIcon="mdi:github"
        variant={gistVariant}
        onSyncNow={() => gistSyncNow({ showProgress: false }).catch(() => {})}
      />

      {/* Entity counts */}
      <div style={{ borderTop: "1px solid var(--t-border)" }}>
        <EntityCounts />
      </div>
    </div>
  );
}
