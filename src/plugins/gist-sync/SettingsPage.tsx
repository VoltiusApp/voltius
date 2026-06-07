import { writeClipboard } from "../../utils/clipboard";
import React, { useEffect, useRef, useState } from "react";
import { useAutosave, type SaveState } from "@/hooks/useAutosave";
import { Icon } from "@iconify/react";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import type { PluginAPI } from "@/plugins/api";
import {
  setupNewGist,
  linkExistingGist,
  unlinkGist,
  deleteGist,
  removeDevice,
  syncNow,
  startPoll,
  getRegisteredGists,
  getImportSourceId,
  getExportDestinationIds,
  setImportSource,
  setExportDestinations,
  type GistRegistration,
} from "./sync-engine";
import { getManifest, listVoltiusGists, GistApiError, type GistDevice, type GistManifest } from "./gist-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  small,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
}) {
  const base =
    "rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default";
  const size = small ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm";
  const colors =
    variant === "primary"
      ? "bg-(--t-accent) text-white hover:bg-(--t-accent-hover)"
      : variant === "danger"
        ? "bg-transparent border border-(--t-status-error) text-(--t-status-error) hover:bg-[color-mix(in_srgb,var(--t-status-error)_10%,transparent)]"
        : "bg-(--t-bg-elevated) border border-(--t-border) text-(--t-text-muted) hover:border-(--t-border-hover)";
  return (
    <button className={`${base} ${size} ${colors}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function SaveIndicator({ saveState }: { saveState: SaveState }) {
  if (saveState === "dirty" || saveState === "saving")
    return <Icon icon="lucide:loader-circle" width={13} className="animate-spin text-(--t-text-dim)" />;
  if (saveState === "saved")
    return <Icon icon="lucide:check" width={13} className="text-(--t-status-connected)" />;
  return null;
}

function SecretInput({
  label,
  labelSuffix,
  value,
  onChange,
  placeholder,
  hint,
  saveState,
}: {
  label: string;
  labelSuffix?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  saveState?: SaveState;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-(--t-text-muted)">
        {label}{labelSuffix}
      </label>
      <div className="relative flex items-center">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="form-input w-full px-3 py-2 pr-16 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
        />
        <div className="absolute right-2 flex items-center gap-1.5">
          {saveState && <SaveIndicator saveState={saveState} />}
          <button
            type="button"
            className="text-(--t-text-dim) hover:text-(--t-text-muted)"
            onClick={() => setShow((s) => !s)}
            tabIndex={-1}
          >
            <Icon icon={show ? "lucide:eye-off" : "lucide:eye"} width={14} />
          </button>
        </div>
      </div>
      {hint && <p className="text-xs text-(--t-text-dim)">{hint}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-(--t-text-muted) shrink-0">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ background: ok ? "var(--t-status-connected)" : "var(--t-status-error)" }}
    />
  );
}

// ─── RolePill ─────────────────────────────────────────────────────────────────

function RolePill({
  icon,
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={[
        "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors",
        active
          ? "bg-[color-mix(in_srgb,var(--t-accent)_14%,transparent)] text-(--t-accent) border-(--t-accent)"
          : disabled
          ? "opacity-40 cursor-not-allowed text-(--t-text-dim) border-(--t-border)"
          : "cursor-pointer text-(--t-text-dim) border-(--t-border) hover:border-(--t-border-hover) hover:text-(--t-text-muted)",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <Icon icon={icon} width={11} />
      {label}
    </button>
  );
}

// ─── GistRow ──────────────────────────────────────────────────────────────────

function GistRow({
  gist,
  isImportSource,
  isExportDest,
  isConfirmingDelete,
  isDeleting,
  isLastExport,
  onSetImportSource,
  onToggleExportDest,
  onUnlink,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  gist: GistRegistration;
  isImportSource: boolean;
  isExportDest: boolean;
  isConfirmingDelete: boolean;
  isDeleting: boolean;
  isLastExport: boolean;
  onSetImportSource: () => void;
  onToggleExportDest: (checked: boolean) => void;
  onUnlink: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const url = `https://gist.github.com/${gist.id}`;
  const shortId = `${gist.id.slice(0, 8)}…`;
  const [copied, setCopied] = useState(false);
  const handleCopyLink = () => {
    writeClipboard(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (isConfirmingDelete) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-(--t-status-error) bg-[color-mix(in_srgb,var(--t-status-error)_6%,transparent)]">
        <span className="text-xs text-(--t-status-error)">
          Permanently delete <span className="font-mono">{shortId}</span> from GitHub?
        </span>
        <div className="flex gap-1.5 shrink-0">
          <Btn variant="secondary" small onClick={onDeleteCancel} disabled={isDeleting}>
            Cancel
          </Btn>
          <Btn variant="danger" small onClick={onDeleteConfirm} disabled={isDeleting}>
            {isDeleting ? (
              <span className="flex items-center gap-1">
                <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
                Deleting…
              </span>
            ) : "Delete"}
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-(--t-border) bg-(--t-bg-base) hover:border-(--t-border-hover) group transition-colors">
      {/* Gist ID + link */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <Icon icon="mdi:github" width={13} className="shrink-0 text-(--t-text-dim)" />
        <span className="text-sm font-mono text-(--t-text-primary)">{shortId}</span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-(--t-text-dim) hover:text-(--t-accent) transition-colors"
          title="Open on GitHub"
        >
          <Icon icon="lucide:external-link" width={11} />
        </a>
      </div>

      {/* Role pills */}
      <div className="flex items-center gap-1.5 shrink-0">
        <RolePill
          icon="lucide:arrow-down-to-line"
          label="Import"
          active={isImportSource}
          disabled={isImportSource}
          title="Read from this gist (import source)"
          onClick={onSetImportSource}
        />
        <RolePill
          icon="lucide:arrow-up-from-line"
          label="Export"
          active={isExportDest}
          disabled={isLastExport}
          title={isLastExport ? "At least one export destination required" : "Write to this gist (export destination)"}
          onClick={() => onToggleExportDest(!isExportDest)}
        />
      </div>

      {/* Actions — visible on hover */}
      <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={handleCopyLink}
          title="Copy gist URL"
          className="p-1 rounded-sm text-(--t-text-dim) hover:text-(--t-text-muted) hover:bg-(--t-bg-hover) transition-colors cursor-pointer"
        >
          <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={13} className={copied ? "text-(--t-status-connected)" : ""} />
        </button>
        <button
          type="button"
          onClick={onUnlink}
          title="Unlink (keep gist on GitHub)"
          className="p-1 rounded-sm text-(--t-text-dim) hover:text-(--t-text-muted) hover:bg-(--t-bg-hover) transition-colors cursor-pointer"
        >
          <Icon icon="lucide:unlink" width={13} />
        </button>
        <button
          type="button"
          onClick={onDeleteRequest}
          title="Delete gist from GitHub"
          className="p-1 rounded-sm text-(--t-text-dim) hover:text-(--t-status-error) hover:bg-[color-mix(in_srgb,var(--t-status-error)_8%,transparent)] transition-colors cursor-pointer"
        >
          <Icon icon="lucide:trash-2" width={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSettingsPage(api: PluginAPI): React.FC {
  return function GistSyncSettings() {
    // Credentials
    const [pat, setPat] = useState("");
    const [passphrase, setPassphrase] = useState("");

    // Gists
    const [gists, setGists] = useState<GistRegistration[]>([]);
    const [importSourceId, setImportSourceId] = useState<string | null>(null);
    const [exportDestIds, setExportDestIds] = useState<string[]>([]);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Add gist
    const [linkInput, setLinkInput] = useState("");
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [detectedGists, setDetectedGists] = useState<{ id: string; url: string }[] | null>(null);
    const [detecting, setDetecting] = useState(false);

    // Sync
    const [lastSync, setLastSync] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [interval, setIntervalVal] = useState(60);

    // Devices (import source gist only)
    const [myDeviceId, setMyDeviceId] = useState<string>("");
    const [sourceManifest, setSourceManifest] = useState<GistManifest | null>(null);

    const loadedRef = useRef(false);

    // ─── Autosave ──────────────────────────────────────────────────────────────

    const patSave = useAutosave({
      onSave: () => api.vault.set("pat", pat.trim()),
      canSave: () => !!pat.trim() && loadedRef.current,
    });
    const passphraseSave = useAutosave({
      onSave: () =>
        passphrase.trim()
          ? api.vault.set("passphrase", passphrase.trim())
          : api.vault.delete("passphrase"),
      canSave: () => loadedRef.current,
    });
    const intervalSave = useAutosave({
      onSave: () => api.storage.set("pollIntervalSeconds", interval).then(() => startPoll(interval)),
      canSave: () => loadedRef.current,
      delay: 800,
    });

    useEffect(() => { patSave.markDirty(); return patSave.schedule(); }, [pat]);
    useEffect(() => { passphraseSave.markDirty(); return passphraseSave.schedule(); }, [passphrase]);
    useEffect(() => { intervalSave.markDirty(); return intervalSave.schedule(); }, [interval]);

    // ─── Load ──────────────────────────────────────────────────────────────────

    useEffect(() => {
      let active = true;
      (async () => {
        const [storedPat, storedPass, gistList, importId, exportIds, storedInterval, storedLastSync, deviceId] =
          await Promise.all([
            api.vault.get("pat"),
            api.vault.get("passphrase"),
            getRegisteredGists(),
            getImportSourceId(),
            getExportDestinationIds(),
            api.storage.get<number>("pollIntervalSeconds"),
            api.storage.get<string>("lastSync"),
            api.storage.get<string>("deviceId"),
          ]);

        if (!active) return;
        if (storedPat) setPat(storedPat);
        if (storedPass) setPassphrase(storedPass);
        setGists(gistList);
        setImportSourceId(importId);
        setExportDestIds(exportIds);
        if (storedInterval) setIntervalVal(storedInterval);
        if (storedLastSync) setLastSync(storedLastSync);
        if (deviceId) setMyDeviceId(deviceId);
        loadedRef.current = true;

        // Load manifest for import source (for devices list)
        if (importId && storedPat) {
          try {
            const m = await getManifest(storedPat, importId);
            if (active) setSourceManifest(m);
          } catch (e) {
            if (active && e instanceof GistApiError && e.status === 404)
              setError("Import source gist not found — it may have been deleted.");
          }
        }
      })();
      return () => { active = false; };
    }, []);

    // ─── Helpers ───────────────────────────────────────────────────────────────

    const refreshGistState = async () => {
      const [gistList, importId, exportIds] = await Promise.all([
        getRegisteredGists(),
        getImportSourceId(),
        getExportDestinationIds(),
      ]);
      setGists(gistList);
      setImportSourceId(importId);
      setExportDestIds(exportIds);
      return { gistList, importId, exportIds };
    };

    const loadManifestForSource = async (gistId: string, pat: string) => {
      try {
        const m = await getManifest(pat, gistId);
        setSourceManifest(m);
      } catch {
        setSourceManifest(null);
      }
    };

    // ─── Handlers ─────────────────────────────────────────────────────────────

    const handleCreateGist = async () => {
      const currentPat = await api.vault.get("pat");
      if (!currentPat) { setError("Enter your GitHub PAT first."); return; }
      setSaving(true); setError(null);
      try {
        const { id } = await setupNewGist(currentPat);
        const { importId } = await refreshGistState().then((s) => ({ importId: s.importId }));
        api.notifications.toast("Gist created and registered", { severity: "success" });
        if (importId === id) await loadManifestForSource(id, currentPat);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    };

    const handleLinkGist = async () => {
      if (!linkInput.trim()) return;
      const currentPat = await api.vault.get("pat");
      if (!currentPat) { setError("Enter your GitHub PAT first."); return; }
      setSaving(true); setError(null);
      try {
        await linkExistingGist(currentPat, linkInput.trim());
        const { importId } = await refreshGistState().then((s) => ({ importId: s.importId }));
        setShowLinkInput(false); setLinkInput("");
        api.notifications.toast("Gist linked", { severity: "success" });
        if (importId === linkInput.trim()) await loadManifestForSource(linkInput.trim(), currentPat);
        syncNow().catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    };

    const handleDetect = async () => {
      const currentPat = await api.vault.get("pat");
      if (!currentPat) { setError("Enter your GitHub PAT first."); return; }
      setDetecting(true); setError(null); setDetectedGists(null); setShowLinkInput(false);
      try {
        const found = await listVoltiusGists(currentPat);
        setDetectedGists(found);
        if (found.length === 0) setError("No Voltius gists found on this account.");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDetecting(false);
      }
    };

    const handleLinkDetected = async (gistId: string) => {
      const currentPat = await api.vault.get("pat");
      if (!currentPat) return;
      setSaving(true); setError(null);
      try {
        await linkExistingGist(currentPat, gistId);
        const { importId } = await refreshGistState().then((s) => ({ importId: s.importId }));
        api.notifications.toast("Gist linked", { severity: "success" });
        if (importId === gistId) await loadManifestForSource(gistId, currentPat);
        syncNow().catch(() => {});
        // Remove the linked gist from the detected list
        setDetectedGists((prev) => prev?.filter((g) => g.id !== gistId) ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    };

    const handleUnlink = async (gistId: string) => {
      await unlinkGist(gistId);
      const { importId } = await refreshGistState().then((s) => ({ importId: s.importId }));
      if (gistId === importSourceId) {
        if (importId) {
          const currentPat = await api.vault.get("pat");
          if (currentPat) await loadManifestForSource(importId, currentPat);
        } else {
          setSourceManifest(null);
        }
      }
    };

    const handleDeleteRequest = (gistId: string) => setConfirmDeleteId(gistId);
    const handleDeleteCancel = () => setConfirmDeleteId(null);

    const handleDeleteConfirm = async (gistId: string) => {
      const currentPat = await api.vault.get("pat");
      if (!currentPat) return;
      setDeletingId(gistId);
      try {
        await deleteGist(currentPat, gistId);
        const { importId } = await refreshGistState().then((s) => ({ importId: s.importId }));
        setConfirmDeleteId(null);
        if (gistId === importSourceId) {
          if (importId) {
            await loadManifestForSource(importId, currentPat);
          } else {
            setSourceManifest(null);
          }
        }
        api.notifications.toast("Gist deleted", { severity: "success" });
      } catch (e) {
        api.notifications.toast(
          `Failed to delete: ${e instanceof Error ? e.message : String(e)}`,
          { severity: "error" },
        );
      } finally {
        setDeletingId(null);
      }
    };

    const handleSetImportSource = async (gistId: string) => {
      await setImportSource(gistId);
      setImportSourceId(gistId);
      const currentPat = await api.vault.get("pat");
      if (currentPat) await loadManifestForSource(gistId, currentPat);
    };

    const handleToggleExportDest = async (gistId: string, checked: boolean) => {
      if (!checked && exportDestIds.length === 1) return; // must keep at least one
      const newIds = checked
        ? [...exportDestIds, gistId]
        : exportDestIds.filter((id) => id !== gistId);
      await setExportDestinations(newIds);
      setExportDestIds(newIds);
    };

    const handleSyncNow = async () => {
      setSyncing(true); setSyncError(null);
      try {
        await syncNow({ showProgress: false });
        const ts = await api.storage.get<string>("lastSync");
        if (ts) setLastSync(ts);
        setSyncing(false);
        if (importSourceId) {
          const currentPat = await api.vault.get("pat");
          if (currentPat) {
            const m = await getManifest(currentPat, importSourceId).catch(() => null);
            if (m) setSourceManifest(m);
          }
        }
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : String(e));
        setSyncing(false);
      }
    };

    const handleRemoveDevice = async (device: GistDevice) => {
      const currentPat = await api.vault.get("pat");
      if (!currentPat || !importSourceId) return;
      try {
        await removeDevice(currentPat, importSourceId, device.id);
        setSourceManifest((m) =>
          m ? { ...m, devices: m.devices.filter((d) => d.id !== device.id) } : m,
        );
        api.notifications.toast(`Removed device: ${device.label}`, { severity: "info" });
      } catch (e) {
        api.notifications.toast(
          `Failed to remove device: ${e instanceof Error ? e.message : String(e)}`,
          { severity: "error" },
        );
      }
    };

    const formatRelative = (iso: string) => {
      const diff = Date.now() - new Date(iso).getTime();
      if (diff < 60_000) return "just now";
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
      return new Date(iso).toLocaleDateString();
    };

    const configured = gists.length > 0;

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
      <div className="flex flex-col gap-6 max-w-lg">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Icon icon="mdi:github" width={20} className="text-(--t-text-primary)" />
          <h2 className="text-base font-semibold text-(--t-text-primary)">GitHub Gist Sync</h2>
          {configured && <StatusDot ok={!syncError} />}
        </div>

        <p className="text-sm text-(--t-text-dim) -mt-4">
          Sync your data across devices via encrypted GitHub Gist — no Voltius account required.
          Data is XChaCha20-Poly1305 encrypted client-side before upload.
        </p>

        {error && (
          <div className="px-3 py-2 rounded-lg text-sm text-(--t-status-error) border border-(--t-status-error) bg-[color-mix(in_srgb,var(--t-status-error)_8%,transparent)]">
            {error}
          </div>
        )}

        {/* Credentials */}
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-(--t-bg-elevated) border border-(--t-border)">
          <p className="text-xs font-semibold text-(--t-text-muted) uppercase tracking-wide">
            Credentials
          </p>
          <SecretInput
            label="GitHub Personal Access Token"
            value={pat}
            onChange={setPat}
            placeholder="github_pat_…"
            saveState={patSave.saveState}
            hint={
              <>
                Needs <code className="text-(--t-accent)">gist</code> scope.{" "}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-(--t-accent) hover:underline"
                >
                  github.com/settings/tokens
                </a>
              </>
            }
          />
          <SecretInput
            label="Sync Passphrase"
            labelSuffix={
              <>
                <span className="font-normal text-(--t-text-dim)">— optional</span>
                <InfoTooltip text="Without a passphrase, data is encrypted using your PAT as the key. If your PAT is compromised, your synced data (including SSH private keys) is also exposed." />
              </>
            }
            value={passphrase}
            onChange={setPassphrase}
            placeholder="Leave empty to use PAT-derived encryption…"
            saveState={passphraseSave.saveState}
            hint="Adds an independent encryption layer. Recommended if syncing SSH private keys."
          />
        </div>

        {/* Registered Gists */}
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-(--t-text-muted) uppercase tracking-wide">
              Gists {gists.length > 0 && `(${gists.length})`}
            </p>
            {gists.length > 0 && (
              <p className="text-[10px] text-(--t-text-dim)">
                Toggle <span className="font-medium">Import</span> / <span className="font-medium">Export</span> roles per gist
              </p>
            )}
          </div>

          {gists.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {gists.map((gist) => (
                <GistRow
                  key={gist.id}
                  gist={gist}
                  isImportSource={importSourceId === gist.id}
                  isExportDest={exportDestIds.includes(gist.id)}
                  isLastExport={exportDestIds.length === 1 && exportDestIds[0] === gist.id}
                  isConfirmingDelete={confirmDeleteId === gist.id}
                  isDeleting={deletingId === gist.id}
                  onSetImportSource={() => handleSetImportSource(gist.id)}
                  onToggleExportDest={(checked) => handleToggleExportDest(gist.id, checked)}
                  onUnlink={() => handleUnlink(gist.id)}
                  onDeleteRequest={() => handleDeleteRequest(gist.id)}
                  onDeleteConfirm={() => handleDeleteConfirm(gist.id)}
                  onDeleteCancel={handleDeleteCancel}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <Icon icon="mdi:github" width={28} className="text-(--t-text-dim) opacity-40" />
              <p className="text-sm text-(--t-text-dim)">No gists registered yet.</p>
              <p className="text-xs text-(--t-text-dim) opacity-70">Create a new gist or link an existing one below.</p>
            </div>
          )}

          <div className="flex gap-2 flex-wrap pt-1 border-t border-(--t-border)">
            <Btn onClick={handleCreateGist} disabled={saving || detecting}>
              {saving && !showLinkInput ? (
                <span className="flex items-center gap-1.5">
                  <Icon icon="lucide:loader-circle" width={13} className="animate-spin" />
                  Creating…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Icon icon="lucide:plus" width={13} />
                  New Gist
                </span>
              )}
            </Btn>
            <Btn variant="secondary" onClick={handleDetect} disabled={detecting || saving}>
              {detecting ? (
                <span className="flex items-center gap-1.5">
                  <Icon icon="lucide:loader-circle" width={13} className="animate-spin" />
                  Detecting…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Icon icon="lucide:scan-search" width={13} />
                  Auto-detect
                </span>
              )}
            </Btn>
            <button
              type="button"
              onClick={() => { setShowLinkInput((v) => !v); setDetectedGists(null); }}
              className="text-xs text-(--t-text-dim) hover:text-(--t-text-muted) underline underline-offset-2 transition-colors"
            >
              {showLinkInput ? "Cancel" : "Enter ID manually"}
            </button>
          </div>

          {/* Auto-detected gists */}
          {detectedGists !== null && detectedGists.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-(--t-text-dim)">
                Found {detectedGists.length} Voltius gist{detectedGists.length !== 1 ? "s" : ""} — select to link:
              </p>
              {detectedGists.map((g) => {
                const alreadyLinked = gists.some((r) => r.id === g.id);
                return (
                  <div
                    key={g.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-(--t-border) bg-(--t-bg-base)"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon icon="mdi:github" width={13} className="shrink-0 text-(--t-text-dim)" />
                      <span className="text-sm font-mono text-(--t-text-primary)">{g.id.slice(0, 8)}…</span>
                      <a
                        href={g.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-(--t-text-dim) hover:text-(--t-accent) transition-colors"
                        title="Open on GitHub"
                      >
                        <Icon icon="lucide:external-link" width={11} />
                      </a>
                    </div>
                    {alreadyLinked ? (
                      <span className="text-xs text-(--t-text-dim) opacity-60">linked</span>
                    ) : (
                      <Btn small onClick={() => handleLinkDetected(g.id)} disabled={saving}>
                        Link
                      </Btn>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {showLinkInput && (
            <div className="flex gap-2 items-center">
              <input
                autoFocus
                type="text"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLinkGist()}
                placeholder="Gist ID or URL (e.g. a1b2c3d4e5f6…)"
                className="form-input flex-1 px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
              />
              <Btn onClick={handleLinkGist} disabled={!linkInput.trim() || saving}>
                {saving ? <Icon icon="lucide:loader-circle" width={13} className="animate-spin" /> : "Link"}
              </Btn>
            </div>
          )}
        </div>

        {/* Sync */}
        {configured && (
          <div className="flex flex-col gap-3 p-4 rounded-xl bg-(--t-bg-elevated) border border-(--t-border)">
            <p className="text-xs font-semibold text-(--t-text-muted) uppercase tracking-wide">
              Sync
            </p>
            <Row label="Status">
              <StatusDot ok={!syncError} />
              <span className="text-sm text-(--t-text-primary)">
                {syncError
                  ? syncError
                  : lastSync
                    ? `Synced ${formatRelative(lastSync)}`
                    : "Not yet synced"}
              </span>
            </Row>
            <Row label="Poll interval">
              <input
                type="number"
                min={10}
                max={3600}
                value={interval}
                onChange={(e) => setIntervalVal(Number(e.target.value))}
                className="w-20 px-2 py-1 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
              />
              <span className="text-sm text-(--t-text-dim)">seconds</span>
              <SaveIndicator saveState={intervalSave.saveState} />
            </Row>
            <div className="flex justify-end">
              <Btn onClick={handleSyncNow} disabled={syncing}>
                {syncing ? (
                  <span className="flex items-center gap-1.5">
                    <Icon icon="lucide:loader-circle" width={13} className="animate-spin" />
                    Syncing…
                  </span>
                ) : "Sync Now"}
              </Btn>
            </div>
          </div>
        )}

        {/* Devices (import source gist only) */}
        {configured && sourceManifest && sourceManifest.devices.length > 0 && (
          <div className="flex flex-col gap-3 p-4 rounded-xl bg-(--t-bg-elevated) border border-(--t-border)">
            <p className="text-xs font-semibold text-(--t-text-muted) uppercase tracking-wide">
              Devices — import source ({sourceManifest.devices.length})
            </p>
            <div className="flex flex-col gap-1">
              {sourceManifest.devices.map((device) => {
                const isMe = device.id === myDeviceId;
                return (
                  <div
                    key={device.id}
                    className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg"
                    style={{
                      background: isMe
                        ? "color-mix(in srgb, var(--t-accent) 8%, transparent)"
                        : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon
                        icon={isMe ? "lucide:monitor-check" : "lucide:monitor"}
                        width={14}
                        className="shrink-0 text-(--t-text-dim)"
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-(--t-text-primary) truncate">
                          {device.label}
                          {isMe && (
                            <span className="ml-1.5 text-xs text-(--t-accent)">
                              (this device)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-(--t-text-dim)">
                          last push: {formatRelative(device.pushedAt)}
                        </p>
                      </div>
                    </div>
                    {!isMe && (
                      <Btn variant="danger" small onClick={() => handleRemoveDevice(device)}>
                        Remove
                      </Btn>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };
}
