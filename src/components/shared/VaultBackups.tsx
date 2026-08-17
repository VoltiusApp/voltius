import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { listVaultBackups, restoreVaultBackup, type VaultBackup } from "@/services/vault";
import { formatSize } from "@/components/filetransfer/SFTPTypes";
import { useNotificationStore } from "@/stores/notificationStore";

interface Props {
  /** True when the live vault can be read, so restoring displaces something usable. */
  currentReadable: boolean;
  /** Render nothing rather than an empty state — for the recovery screen. */
  hideWhenEmpty?: boolean;
  className?: string;
}

/**
 * Lists the vault files quarantine set aside and offers to put one back. Without
 * this the backups are reachable only through a file manager, which is no help
 * to someone whose re-download came back empty.
 */
export function VaultBackups({ currentReadable, hideWhenEmpty, className }: Props) {
  const { t } = useTranslation();
  const [backups, setBackups] = useState<VaultBackup[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const addToast = useNotificationStore((s) => s.addToast);

  useEffect(() => {
    listVaultBackups()
      .then(setBackups)
      .catch(() => setBackups([]));
  }, []);

  if (backups === null) return null;
  if (backups.length === 0 && hideWhenEmpty) return null;

  const restore = async (file: string) => {
    setBusy(true);
    setError("");
    try {
      const setAside = await restoreVaultBackup(file);
      addToast({
        source: { kind: "plugin", id: "system", name: "Voltius" },
        type: "toast",
        message: setAside
          ? t("shared.vaultBackups.restoredToast", { file: setAside })
          : t("shared.vaultBackups.restoredToastNoPrevious"),
        severity: "info",
        duration: 8000,
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <p className="text-xs text-(--t-text-muted)">{t("shared.vaultBackups.description")}</p>

      {error && <p className="text-xs text-(--t-status-error)">{error}</p>}

      {backups.length === 0 && (
        <p className="text-xs text-(--t-text-dim)">{t("shared.vaultBackups.empty")}</p>
      )}

      {backups.map((b) => (
        <div key={b.file} className="rounded-lg px-3 py-2 bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="flex items-center gap-3">
            <Icon icon="lucide:archive-restore" width={14} className="shrink-0 text-(--t-text-dim)" />
            <div className="flex-1 min-w-0">
              <p className="text-xs truncate text-(--t-text-primary)">{b.file}</p>
              <p className="text-[11px] text-(--t-text-dim)">
                {new Date(b.stamp_millis).toLocaleString()} · {formatSize(b.size)}
              </p>
            </div>
            {confirming !== b.file && (
              <button
                type="button"
                onClick={() => { setConfirming(b.file); setError(""); }}
                className="text-xs px-2.5 py-1 rounded-md transition-colors bg-(--t-bg-card-hover) text-(--t-text-secondary)"
              >
                {t("shared.vaultBackups.restore")}
              </button>
            )}
          </div>

          {confirming === b.file && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] leading-relaxed text-(--t-text-muted)">
                {t(currentReadable ? "shared.vaultBackups.warnReadable" : "shared.vaultBackups.warn")}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                  className="flex-1 text-xs px-3 py-1.5 rounded-md transition-colors bg-(--t-bg-card-hover) text-(--t-text-muted)"
                >
                  {t("shared.vaultBackups.cancel")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void restore(b.file)}
                  className="flex-1 text-xs px-3 py-1.5 rounded-md font-medium transition-opacity bg-(--t-accent) text-white hover:opacity-80"
                >
                  {t("shared.vaultBackups.confirm")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
