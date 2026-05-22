import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { Toggle } from "@/components/shared/Toggle";
import { getSyncState, onSyncStateChange, syncNow } from "@/services/sync";
import { useSyncPrefsStore, SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { openBillingCheckout } from "@/services/billingCheckout";

export default function SyncSection() {
  const [syncState, setSyncState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setSyncState(getSyncState())), []);

  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const openSettings = useUIStore((s) => s.openSettings);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const { syncTypes, setSyncType } = useSyncPrefsStore();

  const isLoggedIn = accountMode === "server";

  return (
    <div className="p-6 max-w-lg space-y-6">
      {/* Voltius cloud sync */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Voltius Cloud
        </h3>
        <div className="rounded-lg px-4 py-3 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          {isLoggedIn && isPro ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--t-text-primary)]">Cloud sync active</p>
                <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                  {syncState.status === "syncing" && "Syncing…"}
                  {syncState.status === "error" && `Error: ${syncState.error ?? "unknown"}`}
                  {syncState.status === "success" && syncState.lastSync && `Last sync: ${syncState.lastSync.toLocaleTimeString()}`}
                  {syncState.status === "offline" && "Offline"}
                  {syncState.status === "idle" && "Not synced yet"}
                </p>
              </div>
              <button
                onClick={() => { if (syncState.status !== "syncing") syncNow().catch(() => {}); }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors shrink-0 bg-[var(--t-bg-input)]"
                style={{
                  color: syncState.status === "error" ? "var(--t-status-error)" : "var(--t-text-muted)",
                  opacity: syncState.status === "syncing" ? 0.5 : 1,
                }}
                disabled={syncState.status === "syncing"}
              >
                <Icon
                  icon="lucide:refresh-cw"
                  width={18}
                  className={syncState.status === "syncing" ? "animate-spin" : ""}
                />
                Sync now
              </button>
            </div>
          ) : isLoggedIn && !isPro ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--t-text-primary)]">Cloud sync</p>
                <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">Requires a Pro subscription</p>
              </div>
              <button
                onClick={() => openBillingCheckout("pro").catch(() => {})}
                className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0 bg-[var(--t-accent)] text-white hover:opacity-85 transition-opacity"
              >
                Upgrade
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--t-text-primary)]">Cloud account not connected</p>
                <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                  Sign in or create a cloud account to sync across devices.
                </p>
              </div>
              <button
                onClick={() => openCloudAuth("signin")}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 bg-[var(--t-bg-input)] text-[var(--t-text-primary)]"
              >
                Sign in
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Gist sync — pointer to plugins */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          GitHub Gist (E2EE)
        </h3>
        <div className="rounded-lg px-4 py-3 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--t-text-primary)]">Gist Sync plugin</p>
              <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">End-to-end encrypted sync via GitHub Gist</p>
            </div>
            <button
              onClick={() => openSettings("plugins", "plugin-gist-sync:gist-sync-settings")}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium shrink-0 bg-[var(--t-bg-input)] text-[var(--t-text-primary)] transition-opacity hover:opacity-75"
            >
              Configure →
            </button>
          </div>
        </div>
      </div>

      {/* Sync preferences */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Sync Preferences
        </h3>
        <div className="rounded-lg divide-y bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          {SYNC_OBJECT_TYPES.map(({ id, label, sub }, i) => {
            const value = syncTypes[id] ?? true;
            return (
              <div
                key={id}
                className="flex items-center justify-between gap-3 px-4 py-3"
                style={i > 0 ? { borderTop: "1px solid var(--t-border)" } : undefined}
              >
                <div>
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">{label}</p>
                  <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">{sub}</p>
                </div>
                <Toggle checked={value} onChange={(v) => setSyncType(id, v)} />
              </div>
            );
          })}
        </div>
        <p className="text-xs mt-2 px-1 text-[var(--t-text-muted)]">
          Disabled types won't trigger automatic syncs when changed. Individual objects can also be excluded via their edit panel.
        </p>
      </div>
    </div>
  );
}
