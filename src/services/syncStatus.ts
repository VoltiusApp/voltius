/** Pure selection of the "effective" sync status from the Voltius (server) and
 *  Gist sync engines + plan/plugin state. No React/stores — node-testable. Shared
 *  by the desktop TitleBar and the mobile header so the two can't drift. */
import type { SyncStatus } from "./sync";

interface SyncStateLike {
  status: SyncStatus;
  lastSync: Date | null;
  error: string | null;
}

export interface EffectiveSync {
  /** Either sync engine is set up. */
  configured: boolean;
  /** True when the Voltius (server) engine is the one being surfaced. */
  showVoltius: boolean;
  status: SyncStatus;
  lastSync: Date | null;
  error: string | null;
}

export function selectEffectiveSyncStatus(i: {
  voltius: SyncStateLike;
  gist: SyncStateLike & { configured: boolean };
  accountMode: string | null;
  isPro: boolean;
  gistPluginEnabled: boolean;
}): EffectiveSync {
  const voltiusConfigured = i.accountMode === "server" && i.isPro;
  const gistConfigured = i.gistPluginEnabled && i.gist.configured;
  const showVoltius = voltiusConfigured || !gistConfigured;
  return {
    configured: voltiusConfigured || gistConfigured,
    showVoltius,
    status: showVoltius ? i.voltius.status : i.gist.status,
    lastSync: showVoltius ? i.voltius.lastSync : i.gist.lastSync,
    error: showVoltius ? i.voltius.error : i.gist.error,
  };
}

/** Lucide icon for a sync status (matches SyncDropdown). */
export function syncStatusIcon(status: SyncStatus): string {
  if (status === "syncing") return "lucide:refresh-cw";
  if (status === "success") return "lucide:cloud-check";
  if (status === "error") return "lucide:cloud-alert";
  if (status === "offline") return "lucide:wifi-off";
  return "lucide:cloud";
}

/** Theme color var for a sync status (matches SyncDropdown). */
export function syncStatusColor(status: SyncStatus): string {
  if (status === "success") return "var(--t-status-connected)";
  if (status === "error") return "var(--t-status-error)";
  if (status === "syncing") return "var(--t-text-primary)";
  if (status === "offline") return "var(--t-text-dim)";
  return "var(--t-text-muted)";
}
