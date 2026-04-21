import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { Modal } from "@/components/shared/Modal";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useThemeStore } from "@/stores/themeStore";
import { getMyUserId } from "@/services/teamService";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { useConnectionStore } from "@/stores/connectionStore";
import {
  connectionsFromCSV, connectionsToCSV, detectFormat, fromJSON, toJSON,
  type ConnectionExport, type ExportBundle,
} from "@/services/import-export/formats";
import { HANDLERS, buildBundle, runImport, reloadAll } from "@/services/import-export/registry";
import { useStoreSlices, useImportStores, useReloadFns } from "./useStores";
import type { SelectionProps } from "@/services/import-export/context";
import type { AppTheme } from "@/themes/types";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type ThemeBundle =
  | { type: "voltius-theme"; version: 1; theme: AppTheme }
  | { type: "voltius-user-data"; version: 1; customThemes: AppTheme[] };

function parseThemeBundle(text: string): AppTheme[] {
  const data = JSON.parse(text) as ThemeBundle;
  if (data.type === "voltius-theme" && data.theme) return [data.theme];
  if (data.type === "voltius-user-data" && Array.isArray(data.customThemes)) return data.customThemes;
  throw new Error("Not a Voltius theme file");
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-[var(--t-text-primary)]">
      <span
        onClick={() => onChange(!checked)}
        className="flex items-center justify-center w-4 h-4 rounded transition-colors shrink-0"
        style={{
          background: checked ? "var(--t-accent)" : "var(--t-bg-input)",
          border: `1px solid ${checked ? "var(--t-accent)" : "var(--t-border-hover)"}`,
        }}
      >
        {checked && <Icon icon="lucide:check" width={10} color="white" />}
      </span>
      {label}
    </label>
  );
}

// ─── Radio ────────────────────────────────────────────────────────────────────

function Radio({ checked, onChange, label, sub }: { checked: boolean; onChange: () => void; label: string; sub?: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none" onClick={onChange}>
      <span
        className="flex items-center justify-center w-4 h-4 rounded-full mt-0.5 shrink-0 transition-colors"
        style={{
          border: `2px solid ${checked ? "var(--t-accent)" : "var(--t-border-hover)"}`,
          background: checked ? "var(--t-accent)" : "transparent",
        }}
      >
        {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
      </span>
      <div>
        <span className="text-sm text-[var(--t-text-primary)]">{label}</span>
        {sub && <p className="text-xs mt-0.5 text-[var(--t-text-muted)]">{sub}</p>}
      </div>
    </label>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({ icon, label, onClick, primary, disabled }: { icon: string; label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      style={{
        background: primary ? "var(--t-accent)" : "var(--t-bg-elevated)",
        color: primary ? "#fff" : "var(--t-text-primary)",
        border: primary ? "none" : "1px solid var(--t-border-hover)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.opacity = "0.85"; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.opacity = "1"; }}
    >
      <Icon icon={icon} width={15} />
      {label}
    </button>
  );
}

// ─── Vault chip multi-select ──────────────────────────────────────────────────

const WRITE_ROLES = new Set(["owner", "manager", "editor"]);

function VaultChipSelect({ selectedIds, onChange, writableOnly = false }: { selectedIds: string[]; onChange: (ids: string[]) => void; writableOnly?: boolean }) {
  const { vaults } = useVaultStore();
  const { teams, membersByTeam } = useTeamStore();
  const [myUserId, setMyUserId] = useState("");

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
  }, []);

  const myRoleIn = (teamId: string) => membersByTeam[teamId]?.find(m => m.user_id === myUserId)?.role ?? "";
  const canWrite = (vId: string) => vId === "personal" || !WRITE_ROLES.size || WRITE_ROLES.has(myRoleIn(vId)) || myRoleIn(vId) === "";

  const linkedTeamIds = new Set(vaults.map(v => v.teamId).filter(Boolean));
  const allVaults = [
    ...vaults.map(v => ({ id: v.teamId ?? v.id, name: v.name })),
    ...teams.filter(t => !linkedTeamIds.has(t.id)).map(t => ({ id: t.id, name: t.name })),
  ].filter(v => !writableOnly || canWrite(v.id));

  if (allVaults.length <= 1) return null;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      if (selectedIds.length === 1) return;
      onChange(selectedIds.filter(v => v !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {allVaults.map(v => {
        const active = selectedIds.includes(v.id);
        return (
          <button key={v.id} type="button" onClick={() => toggle(v.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: active ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-elevated)",
              border: `1px solid ${active ? "var(--t-accent)" : "var(--t-border-hover)"}`,
              color: active ? "var(--t-accent)" : "var(--t-text-muted)",
            }}
          >
            <Icon icon="lucide:vault" width={11} />
            {v.name}
          </button>
        );
      })}
    </div>
  );
}

// ─── Export tab ───────────────────────────────────────────────────────────────

function ExportTab({ singleConnectionId, singleKeyId, singleIdentityId, connectionIds, keyIds, identityIds, preselectedTypes }: {
  singleConnectionId?: string; singleKeyId?: string; singleIdentityId?: string;
  connectionIds?: string[]; keyIds?: string[]; identityIds?: string[];
  preselectedTypes?: string[];
}) {
  const stores = useStoreSlices();
  const accessibleVaultIds = useAccessibleVaultIds();

  const selection: SelectionProps = { singleConnectionId, singleKeyId, singleIdentityId, connectionIds, keyIds, identityIds };
  const isSingleItem = !!(singleConnectionId ?? singleKeyId ?? singleIdentityId);
  const isBulk = !!(connectionIds ?? keyIds ?? identityIds);

  // One checked state per handler, keyed by handler.key
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(HANDLERS.map(h => [
      h.key,
      preselectedTypes ? preselectedTypes.includes(h.key) : h.isActive(selection),
    ]))
  );
  const toggle = (key: string, v: boolean) => setIncluded(prev => ({ ...prev, [key]: v }));

  const [format, setFormat] = useState<"json" | "csv">("json");
  const isCsvOnly = format === "csv";

  const [preview, setPreview] = useState("");
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bundleCounts, setBundleCounts] = useState<Record<string, number>>({});
  const [showPreview, setShowPreview] = useState(false);

  const [exportVaultIds, setExportVaultIds] = useState<string[]>(
    accessibleVaultIds.length > 0 ? accessibleVaultIds : ["personal"]
  );
  const didInitExport = useRef(false);
  useEffect(() => {
    if (!didInitExport.current && accessibleVaultIds.length > 0) {
      setExportVaultIds(accessibleVaultIds);
      didInitExport.current = true;
    }
  }, [accessibleVaultIds]);

  useEffect(() => {
    let cancelled = false;
    setBuilding(true);
    const enabled: Record<string, boolean> = Object.fromEntries(
      HANDLERS.map(h => [h.key, included[h.key] && (!h.jsonOnly || !isCsvOnly)])
    );
    buildBundle(enabled, stores, exportVaultIds, selection).then(bundle => {
      if (cancelled) return;
      const counts: Record<string, number> = { folders: bundle.folders.length };
      for (const h of HANDLERS) counts[h.key] = (bundle[h.key as keyof ExportBundle] as unknown[])?.length ?? 0;
      setBundleCounts(counts);
      setPreview(isCsvOnly ? connectionsToCSV(bundle.connections) : toJSON(bundle));
      setBuilding(false);
    }).catch(() => { if (!cancelled) setBuilding(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [included, format, exportVaultIds, stores.connections, stores.identities, stores.keys, stores.snippets, stores.pfRules]);

  const totalItems = Object.values(bundleCounts).reduce((a, b) => a + b, 0);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(preview);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = format === "csv" ? "csv" : "json";
    const blob = new Blob([preview], { type: format === "csv" ? "text/csv" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voltius-export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Auto-included cascade (single connection export pulls in identity + key)
  const autoIncludes: string[] = [];
  if (isSingleItem && !isCsvOnly) {
    if ((bundleCounts["identities"] ?? 0) > 0 && !singleIdentityId) autoIncludes.push(`${bundleCounts["identities"]} identity`);
    if ((bundleCounts["keys"] ?? 0) > 0 && !singleKeyId) autoIncludes.push(`${bundleCounts["keys"]} key`);
  }

  const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`;
  const summaryParts = HANDLERS
    .map(h => ({ h, n: bundleCounts[h.key] ?? 0 }))
    .filter(({ n }) => n > 0)
    .map(({ h, n }) => {
      if (h.key === "identities") return `${n} identit${n !== 1 ? "ies" : "y"}`;
      if (h.key === "portForwardingRules") return plural(n, "port rule");
      return plural(n, h.label.toLowerCase().replace(/s$/, ""));
    });
  if ((bundleCounts["folders"] ?? 0) > 0) summaryParts.push(plural(bundleCounts["folders"], "folder"));

  return (
    <div className="flex flex-col gap-5 h-full">
      <VaultChipSelect selectedIds={exportVaultIds} onChange={setExportVaultIds} />

      <div className="flex gap-6">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">Include</p>
          <div className="flex flex-col gap-2.5">
            {HANDLERS.map(h => {
              if (!h.isActive(selection)) return null;
              const count = h.countAvailable(stores, exportVaultIds);
              const disabled = h.jsonOnly && isCsvOnly;
              return (
                <Checkbox
                  key={h.key}
                  checked={included[h.key] && !disabled}
                  onChange={v => !disabled && toggle(h.key, v)}
                  label={h.checkboxLabel(selection, count)}
                />
              );
            })}
            {isBulk && !isSingleItem && (
              <p className="text-xs text-[var(--t-text-muted)]">
                {(connectionIds?.length ?? 0) + (identityIds?.length ?? 0) + (keyIds?.length ?? 0)} selected item{((connectionIds?.length ?? 0) + (identityIds?.length ?? 0) + (keyIds?.length ?? 0)) !== 1 ? "s" : ""}
              </p>
            )}
            {isCsvOnly && !isSingleItem && (
              <p className="text-xs mt-1 text-[var(--t-text-muted)]">CSV supports connections only</p>
            )}
          </div>
        </div>

        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">Format</p>
          <div className="flex flex-col gap-3">
            <Radio checked={format === "json"} onChange={() => setFormat("json")} label="JSON" sub="Full data including key content" />
            {!singleKeyId && !singleIdentityId && (
              <Radio checked={format === "csv"} onChange={() => setFormat("csv")} label="CSV" sub="Connections only — spreadsheet-friendly" />
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 py-3 border-y border-[var(--t-border)]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {building ? (
            <span className="text-xs text-[var(--t-text-dim)] flex items-center gap-1.5">
              <Icon icon="lucide:loader" width={12} className="animate-spin" />
              Building…
            </span>
          ) : (
            <>
              <span className="text-sm text-[var(--t-text-muted)] truncate">
                {summaryParts.length > 0 ? summaryParts.join(" · ") : "Nothing to export"}
              </span>
              {autoIncludes.length > 0 && (
                <span className="text-xs flex items-center gap-1 text-[var(--t-text-dim)] shrink-0">
                  <Icon icon="lucide:link" width={11} />
                  +{autoIncludes.join(" + ")}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ActionBtn icon={copied ? "lucide:check" : "lucide:clipboard-copy"} label={copied ? "Copied!" : "Copy"} onClick={handleCopy} disabled={totalItems === 0 || building} />
          <ActionBtn icon="lucide:download" label={`Download .${format}`} onClick={handleDownload} primary disabled={totalItems === 0 || building} />
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <button onClick={() => setShowPreview(p => !p)}
          className="flex items-center gap-1.5 text-xs mb-2 w-fit transition-opacity hover:opacity-70"
          style={{ color: "var(--t-text-dim)" }}
        >
          <Icon icon={showPreview ? "lucide:chevron-down" : "lucide:chevron-right"} width={12} />
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
        {showPreview && (
          <textarea readOnly value={preview}
            className="flex-1 w-full text-xs rounded-lg p-3 resize-none font-mono outline-none bg-[var(--t-bg-terminal)] text-[var(--t-text-secondary)] border border-[var(--t-border)]"
          />
        )}
      </div>
    </div>
  );
}

// ─── Import tab ───────────────────────────────────────────────────────────────

type ImportStatus =
  | { type: "idle" }
  | { type: "parsing" }
  | { type: "error"; message: string }
  | { type: "ready"; bundle: ExportBundle; connections: ConnectionExport[] };

function ImportTab() {
  const { connections: existingConnections } = useConnectionStore();
  const importStores = useImportStores();
  const reloaders = useReloadFns();
  const defaultVaultId = useDefaultVaultId();

  const [targetVaultIds, setTargetVaultIds] = useState<string[]>([defaultVaultId]);
  const [text, setText] = useState("");
  const [skipDupes, setSkipDupes] = useState(true);
  const [addTag, setAddTag] = useState("");
  const [status, setStatus] = useState<ImportStatus>({ type: "idle" });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const parse = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) { setStatus({ type: "idle" }); return; }
    setStatus({ type: "parsing" });
    try {
      const detected = detectFormat(trimmed);
      let bundle: ExportBundle;
      if (detected === "json") {
        bundle = fromJSON(trimmed);
      } else if (detected === "csv") {
        const conns = connectionsFromCSV(trimmed);
        bundle = { version: 1, exported_at: "", folders: [], connections: conns, identities: [], keys: [], snippets: [], portForwardingRules: [] };
      } else {
        setStatus({ type: "error", message: "Could not detect format. Make sure it's valid JSON or CSV." });
        return;
      }
      const existingSet = new Set(existingConnections.map(c => `${c.host}:${c.port}:${c.username}`));
      const filtered = skipDupes ? bundle.connections.filter(c => !existingSet.has(`${c.host}:${c.port}:${c.username}`)) : bundle.connections;
      setStatus({ type: "ready", bundle, connections: filtered });
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    }
  }, [existingConnections, skipDupes]);

  useEffect(() => { parse(text); }, [text, skipDupes, parse]);

  const handlePaste = async () => setText(await navigator.clipboard.readText());

  const handleFileOpen = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.csv,.txt";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => setText(String(e.target?.result ?? ""));
      reader.readAsText(file);
    };
    input.click();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setText(String(ev.target?.result ?? ""));
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (status.type !== "ready") return;
    setImporting(true);
    setImportResult(null);
    let imported = 0; let errors = 0;
    try {
      for (const vaultTargetId of targetVaultIds) {
        const vault_id = resolveVaultIdForSave(vaultTargetId);
        const result = await runImport(status.bundle, {
          vault_id,
          tag: addTag.trim(),
          skipDupes,
          existingConnections,
          folderEidMap: new Map(),
          snippetFolderEidMap: new Map(),
          keyEidMap: new Map(),
          identityEidMap: new Map(),
          connectionEidMap: new Map(),
          stores: importStores,
        });
        imported += result.imported;
        errors += result.errors;
      }
      await reloadAll(reloaders);
      const vaultNote = targetVaultIds.length > 1 ? ` across ${targetVaultIds.length} vaults` : "";
      setImportResult(errors > 0
        ? `Imported ${imported} items${vaultNote}, ${errors} failed.`
        : `Successfully imported ${imported} item${imported !== 1 ? "s" : ""}${vaultNote}.`
      );
      setText("");
    } catch (err) {
      setImportResult(`Error: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const readyStatus = status.type === "ready" ? status : null;
  const itemsPerVault = readyStatus
    ? readyStatus.connections.length
      + readyStatus.bundle.identities.length
      + readyStatus.bundle.keys.length
      + readyStatus.bundle.folders.length
      + readyStatus.bundle.snippets.length
      + readyStatus.bundle.portForwardingRules.length
    : 0;
  const totalToImport = itemsPerVault * targetVaultIds.length;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">Import into</p>
        <VaultChipSelect selectedIds={targetVaultIds} onChange={setTargetVaultIds} writableOnly />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ActionBtn icon="lucide:folder-open" label="Open File…" onClick={handleFileOpen} />
          <ActionBtn icon="lucide:clipboard" label="Paste from Clipboard" onClick={handlePaste} />
          {text.trim() && (
            <button onClick={() => { setText(""); setStatus({ type: "idle" }); setImportResult(null); }}
              className="ml-auto flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
              style={{ color: "var(--t-text-dim)" }}
            >
              <Icon icon="lucide:x" width={11} />
              Clear
            </button>
          )}
        </div>
        <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className="relative">
          <textarea
            value={text} onChange={e => setText(e.target.value)}
            placeholder={'Paste JSON or CSV here, or drop a file…\n\nJSON: { "version": 1, "connections": [...] }\nCSV: name,host,port,username,auth_type,tags'}
            className="w-full text-xs rounded-lg p-3 resize-none font-mono outline-none bg-[var(--t-bg-terminal)] text-[var(--t-text-secondary)] transition-colors"
            rows={7}
            style={{ border: `1px solid ${status.type === "error" ? "var(--t-status-error)" : dragging ? "var(--t-accent)" : "var(--t-border)"}` }}
          />
          {dragging && (
            <div className="absolute inset-0 rounded-lg flex items-center justify-center pointer-events-none"
              style={{ background: "color-mix(in srgb, var(--t-accent) 8%, transparent)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--t-accent)" }}>Drop to load</span>
            </div>
          )}
        </div>
      </div>

      {status.type === "error" && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.12)", color: "var(--t-status-error)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <Icon icon="lucide:alert-circle" width={15} className="mt-0.5 shrink-0" />
          {status.message}
        </div>
      )}

      {status.type === "ready" && (
        <div className="flex flex-col gap-3 p-3 rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="flex items-center gap-2 text-sm text-[var(--t-text-primary)]">
            <Icon icon="lucide:check-circle" width={15} className="text-[var(--t-status-ok)]" />
            <span>
              Found{" "}
              {[
                status.connections.length > 0 && `${status.connections.length} connection${status.connections.length !== 1 ? "s" : ""}`,
                status.bundle.identities.length > 0 && `${status.bundle.identities.length} identit${status.bundle.identities.length !== 1 ? "ies" : "y"}`,
                status.bundle.keys.length > 0 && `${status.bundle.keys.length} key${status.bundle.keys.length !== 1 ? "s" : ""}`,
                status.bundle.snippets.length > 0 && `${status.bundle.snippets.length} snippet${status.bundle.snippets.length !== 1 ? "s" : ""}`,
                status.bundle.portForwardingRules.length > 0 && `${status.bundle.portForwardingRules.length} port rule${status.bundle.portForwardingRules.length !== 1 ? "s" : ""}`,
              ].filter(Boolean).join(", ") || "no items"}
              {skipDupes && status.bundle.connections.length !== status.connections.length && (
                <span className="text-[var(--t-text-muted)]">
                  {" "}({status.bundle.connections.length - status.connections.length} duplicate{status.bundle.connections.length - status.connections.length !== 1 ? "s" : ""} skipped)
                </span>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-t-[var(--t-border)]">
            <Checkbox checked={skipDupes} onChange={setSkipDupes} label="Skip duplicates" />
            <label className="flex items-center gap-2 text-sm text-[var(--t-text-primary)]">
              <span>Tag:</span>
              <input value={addTag} onChange={e => setAddTag(e.target.value)} placeholder="optional"
                className="px-2 py-0.5 rounded text-xs outline-none bg-[var(--t-bg-input)] border border-[var(--t-border-hover)] text-[var(--t-text-primary)]"
                style={{ width: 100 }}
              />
            </label>
          </div>
        </div>
      )}

      {importResult && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{
            background: importResult.includes("Error") ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.1)",
            color: importResult.includes("Error") ? "var(--t-status-error)" : "var(--t-status-ok)",
            border: `1px solid ${importResult.includes("Error") ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.2)"}`,
          }}
        >
          <Icon icon={importResult.includes("Error") ? "lucide:alert-circle" : "lucide:check-circle"} width={14} />
          {importResult}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-[var(--t-border)]">
        <ActionBtn
          icon={importing ? "lucide:loader" : "lucide:upload"}
          label={importing ? "Importing…" : totalToImport > 0 ? `Import ${totalToImport} item${totalToImport !== 1 ? "s" : ""}${targetVaultIds.length > 1 ? ` × ${targetVaultIds.length} vaults` : ""}` : "Import"}
          onClick={handleImport}
          primary
          disabled={totalToImport === 0 || importing}
        />
      </div>
    </div>
  );
}

// ─── User Data: Theme export tab ─────────────────────────────────────────────

function ThemeExportTab() {
  const { customThemes } = useThemeStore();
  const [copied, setCopied] = useState(false);
  const payload = JSON.stringify({ type: "voltius-user-data", version: 1, customThemes }, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-5 h-full">
      <p className="text-sm text-[var(--t-text-muted)]">
        {customThemes.length === 0
          ? "No custom themes to export."
          : `Exporting ${customThemes.length} custom theme${customThemes.length !== 1 ? "s" : ""}.`}
      </p>
      <textarea
        readOnly value={payload}
        className="flex-1 w-full text-xs rounded-lg p-3 resize-none font-mono outline-none bg-[var(--t-bg-terminal)] text-[var(--t-text-secondary)] border border-[var(--t-border)]"
      />
      <div className="flex items-center gap-2 pt-3 border-t border-[var(--t-border)]">
        <ActionBtn icon={copied ? "lucide:check" : "lucide:clipboard-copy"} label={copied ? "Copied!" : "Copy"} onClick={handleCopy} disabled={customThemes.length === 0} />
        <ActionBtn icon="lucide:download" label="Download .json" onClick={() => downloadJson("voltius-custom-themes.json", { type: "voltius-user-data", version: 1, customThemes })} primary disabled={customThemes.length === 0} />
      </div>
    </div>
  );
}

// ─── User Data: Theme import tab ─────────────────────────────────────────────

type ThemeImportStatus = { type: "idle" } | { type: "error"; message: string } | { type: "ready"; themes: AppTheme[] };

function ThemeImportTab({ onClose }: { onClose: () => void }) {
  const { saveCustomTheme } = useThemeStore();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<ThemeImportStatus>({ type: "idle" });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const parse = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) { setStatus({ type: "idle" }); return; }
    try { setStatus({ type: "ready", themes: parseThemeBundle(trimmed) }); }
    catch (err) { setStatus({ type: "error", message: String(err) }); }
  }, []);

  useEffect(() => { parse(text); }, [text, parse]);

  const handleFileOpen = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json";
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => setText(String(e.target?.result ?? ""));
      reader.readAsText(file);
    };
    input.click();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setText(String(ev.target?.result ?? ""));
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (status.type !== "ready") return;
    setImporting(true);
    try {
      for (const t of status.themes) saveCustomTheme({ ...t, builtIn: false });
      setImportResult(`Imported ${status.themes.length} theme${status.themes.length !== 1 ? "s" : ""}.`);
      setText("");
      setTimeout(onClose, 1200);
    } catch (err) {
      setImportResult(`Error: ${String(err)}`);
    } finally { setImporting(false); }
  };

  const totalToImport = status.type === "ready" ? status.themes.length : 0;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2">
        <ActionBtn icon="lucide:folder-open" label="Open File…" onClick={handleFileOpen} />
        <ActionBtn icon="lucide:clipboard" label="Paste from Clipboard" onClick={async () => setText(await navigator.clipboard.readText())} />
        {text.trim() && (
          <button onClick={() => { setText(""); setStatus({ type: "idle" }); setImportResult(null); }}
            className="ml-auto flex items-center gap-1 text-xs transition-opacity hover:opacity-70" style={{ color: "var(--t-text-dim)" }}>
            <Icon icon="lucide:x" width={11} /> Clear
          </button>
        )}
      </div>

      <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className="relative">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7}
          placeholder={'Paste a Voltius theme JSON here, or drop a file…\n\n{ "type": "voltius-theme", "version": 1, "theme": { ... } }'}
          className="w-full text-xs rounded-lg p-3 resize-none font-mono outline-none bg-[var(--t-bg-terminal)] text-[var(--t-text-secondary)] transition-colors"
          style={{ border: `1px solid ${status.type === "error" ? "var(--t-status-error)" : dragging ? "var(--t-accent)" : "var(--t-border)"}` }}
        />
        {dragging && (
          <div className="absolute inset-0 rounded-lg flex items-center justify-center pointer-events-none"
            style={{ background: "color-mix(in srgb, var(--t-accent) 8%, transparent)" }}>
            <span className="text-sm font-medium" style={{ color: "var(--t-accent)" }}>Drop to load</span>
          </div>
        )}
      </div>

      {status.type === "error" && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm"
          style={{ background: "rgba(239,68,68,0.12)", color: "var(--t-status-error)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <Icon icon="lucide:alert-circle" width={15} className="mt-0.5 shrink-0" /> {status.message}
        </div>
      )}
      {status.type === "ready" && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm"
          style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}>
          <Icon icon="lucide:check-circle" width={15} className="text-[var(--t-status-ok)]" />
          <span className="text-[var(--t-text-primary)]">
            Found {status.themes.length} theme{status.themes.length !== 1 ? "s" : ""}:{" "}
            <span className="text-[var(--t-text-muted)]">{status.themes.map((t) => t.name).join(", ")}</span>
          </span>
        </div>
      )}
      {importResult && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{
            background: importResult.includes("Error") ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.1)",
            color: importResult.includes("Error") ? "var(--t-status-error)" : "var(--t-status-ok)",
            border: `1px solid ${importResult.includes("Error") ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.2)"}`,
          }}>
          <Icon icon={importResult.includes("Error") ? "lucide:alert-circle" : "lucide:check-circle"} width={14} />
          {importResult}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-[var(--t-border)]">
        <ActionBtn
          icon={importing ? "lucide:loader" : "lucide:upload"}
          label={importing ? "Importing…" : totalToImport > 0 ? `Import ${totalToImport} theme${totalToImport !== 1 ? "s" : ""}` : "Import"}
          onClick={handleImport} primary disabled={totalToImport === 0 || importing}
        />
      </div>
    </div>
  );
}

// ─── Modal root ───────────────────────────────────────────────────────────────

export function ImportExportModal() {
  const state = useUIStore(s => s.importExportModal);
  const close = useUIStore(s => s.closeImportExport);
  const reloaders = useReloadFns();

  const [activeSection, setActiveSection] = useState<"vaults" | "user-data">(state?.section ?? "vaults");
  const [activeMode, setActiveMode] = useState<"export" | "import">(state?.mode ?? "export");
  const prevOpen = useRef(false);

  useEffect(() => {
    if (state?.open && !prevOpen.current) {
      setActiveSection(state.section ?? "vaults");
      setActiveMode(state.mode ?? "export");
    }
    prevOpen.current = !!state?.open;
  }, [state?.open, state?.mode, state?.section]);

  useEffect(() => {
    if (state?.open && activeSection === "vaults") void reloadAll(reloaders);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.open, activeSection]);

  if (!state?.open) return null;

  const SECTIONS = [
    { id: "vaults" as const, label: "Vaults", icon: "lucide:vault" },
    { id: "user-data" as const, label: "User Data", icon: "lucide:user" },
  ];

  return (
    <Modal onClose={close} blur>
      <div
        className="flex flex-col animate-fadeIn overflow-hidden bg-[var(--t-bg-base)] border border-[var(--t-border)]"
        style={{ width: "min(680px, 94vw)", height: "min(580px, 90vh)", borderRadius: 14, boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
      >
        {/* Header — section tabs in center */}
        <div className="grid grid-cols-3 items-center px-6 py-4 shrink-0 border-b border-b-[var(--t-border)]">
          <div className="flex items-center gap-3">
            <Icon icon="lucide:arrow-left-right" width={18} className="text-[var(--t-accent)]" />
            <span className="text-base font-semibold text-[var(--t-text-bright)]">Import / Export</span>
          </div>
          <div className="flex items-center justify-center gap-1">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: activeSection === s.id ? "var(--t-bg-input)" : "transparent",
                  color: activeSection === s.id ? "var(--t-text-bright)" : "var(--t-text-muted)",
                  border: `1px solid ${activeSection === s.id ? "var(--t-border-hover)" : "transparent"}`,
                }}
              >
                <Icon icon={s.icon} width={13} />
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={close}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors text-[var(--t-text-muted)]"
              onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}
            >
              <Icon icon="lucide:x" width={16} />
            </button>
          </div>
        </div>

        {/* Mode subtabs */}
        <div className="flex gap-1 px-6 pt-3 pb-0 shrink-0">
          {(["export", "import"] as const).map(mode => (
            <button key={mode} onClick={() => setActiveMode(mode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-sm font-medium transition-colors"
              style={{
                background: activeMode === mode ? "var(--t-bg-elevated)" : "transparent",
                color: activeMode === mode ? "var(--t-text-bright)" : "var(--t-text-muted)",
                borderBottom: activeMode === mode ? "2px solid var(--t-accent)" : "2px solid transparent",
              }}
            >
              <Icon icon={mode === "export" ? "lucide:download" : "lucide:upload"} width={13} />
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {activeSection === "vaults" ? (
            activeMode === "export" ? (
              <ExportTab
                singleConnectionId={state.singleConnectionId}
                singleKeyId={state.singleKeyId}
                singleIdentityId={state.singleIdentityId}
                connectionIds={state.connectionIds}
                keyIds={state.keyIds}
                identityIds={state.identityIds}
                preselectedTypes={state.preselectedTypes}
              />
            ) : (
              <ImportTab />
            )
          ) : (
            activeMode === "export" ? <ThemeExportTab /> : <ThemeImportTab onClose={close} />
          )}
        </div>
      </div>
    </Modal>
  );
}
