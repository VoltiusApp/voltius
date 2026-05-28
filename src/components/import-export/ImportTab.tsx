import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import LogoSvg from "/logo.svg?react";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { decryptText, fromJSON } from "@/services/import-export/formats";
import type { ConnectionExport, ExportBundle } from "@/services/import-export/formats";
import { runImport, reloadAll } from "@/services/import-export/registry";
import { existingConnectionsForVault } from "@/services/import-export/context";
import { IMPORTERS, parseImport } from "@/services/import-export/importers";
import { useImportStores, useReloadFns, useStoreSlices } from "./useStores";
import { ActionBtn, Checkbox, VaultChipSelect } from "./shared";
import { FileInputArea } from "./FileInputArea";

type ImportStatus =
  | { type: "idle" }
  | { type: "parsing" }
  | { type: "error"; message: string }
  | { type: "needs-password" }
  | { type: "ready"; bundle: ExportBundle; connections: ConnectionExport[]; skippedKeys: number; skippedIdentities: number; skippedSnippets: number; skippedPfRules: number };

export function ImportTab() {
  const storeSlices = useStoreSlices();
  const { connections: existingConnections } = storeSlices;
  const importStores = useImportStores();
  const reloaders = useReloadFns();
  const defaultVaultId = useDefaultVaultId();

  const [selectedSource, setSelectedSource] = useState(IMPORTERS[0].key);
  const [targetVaultIds, setTargetVaultIds] = useState<string[]>([defaultVaultId]);
  const [text, setText] = useState("");
  const [skipDupes, setSkipDupes] = useState(true);
  const [addTag, setAddTag] = useState("");
  const [status, setStatus] = useState<ImportStatus>({ type: "idle" });
  const [decryptPassword, setDecryptPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [mobaDetected, setMobaDetected] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const source = IMPORTERS.find(i => i.key === selectedSource)!;

  const applyBundle = (bundle: ExportBundle) => {
    const targetVaultSaveIds = targetVaultIds.map(resolveVaultIdForSave);
    const existingConnSets = targetVaultSaveIds.map((vaultId) => new Set(
      existingConnectionsForVault(existingConnections, vaultId).map(c => `${c.host}:${c.port}:${c.username}`),
    ));
    const existingKeySets = targetVaultSaveIds.map(vId => new Set(
      storeSlices.keys.filter(k => !k.deleted_at && (k.vault_id ?? "personal") === vId).map(k => k.name),
    ));
    const existingIdentitySets = targetVaultSaveIds.map(vId => new Set(
      storeSlices.identities.filter(i => !i.deleted_at && (i.vault_id ?? "personal") === vId).map(i => i.name),
    ));
    const existingSnippetSets = targetVaultSaveIds.map(vId => new Set(
      storeSlices.snippets.filter(s => !s.deleted_at && (s.vault_id ?? "personal") === vId).map(s => s.name),
    ));
    const existingPfSets = targetVaultSaveIds.map(vId => new Set(
      storeSlices.pfRules.filter(r => !r.deleted_at && (r.vault_id ?? "personal") === vId).map(r => r.name),
    ));
    const connections = skipDupes
      ? bundle.connections.filter(c => existingConnSets.some((s) => !s.has(`${c.host}:${c.port}:${c.username}`)))
      : bundle.connections;
    const skippedKeys = skipDupes
      ? bundle.keys.filter(k => k.name && existingKeySets.every(s => s.has(k.name!))).length
      : 0;
    const skippedIdentities = skipDupes
      ? bundle.identities.filter(i => i.name && existingIdentitySets.every(s => s.has(i.name!))).length
      : 0;
    const skippedSnippets = skipDupes
      ? bundle.snippets.filter(s => existingSnippetSets.every(es => es.has(s.name))).length
      : 0;
    const skippedPfRules = skipDupes
      ? bundle.portForwardingRules.filter(r => existingPfSets.every(s => s.has(r.name))).length
      : 0;
    setStatus({ type: "ready", bundle, connections, skippedKeys, skippedIdentities, skippedSnippets, skippedPfRules });
  };

  const parse = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) { setStatus({ type: "idle" }); return; }
    setStatus({ type: "parsing" });
    try {
      const result = parseImport(trimmed);
      if (result === "encrypted") {
        setDecryptPassword("");
        setStatus({ type: "needs-password" });
        return;
      }
      applyBundle(result);
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingConnections, storeSlices.keys, storeSlices.identities, storeSlices.snippets, storeSlices.pfRules, skipDupes, targetVaultIds]);

  useEffect(() => { parse(text); }, [text, skipDupes, parse]);

  useEffect(() => {
    if (selectedSource !== "mobaxterm") return;
    setMobaDetected(null);
    invoke<string | null>("read_mobaxterm_config")
      .then(content => setMobaDetected(content ?? null))
      .catch(() => {});
  }, [selectedSource]);

  const handleAutoExtract = useCallback(async () => {
    if (!source.autoExtract) return;
    setExtracting(true);
    setImportResult(null);
    setStatus({ type: "parsing" });
    try {
      const bundle = await source.autoExtract();
      applyBundle(bundle);
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    } finally {
      setExtracting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, existingConnections, storeSlices.keys, storeSlices.identities, storeSlices.snippets, storeSlices.pfRules, skipDupes, targetVaultIds]);

  const handleDecrypt = useCallback(async () => {
    if (!decryptPassword) return;
    setStatus({ type: "parsing" });
    try {
      const decrypted = await decryptText(text, decryptPassword);
      const bundle = fromJSON(decrypted);
      applyBundle(bundle);
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decryptPassword, text, existingConnections, storeSlices.keys, storeSlices.identities, storeSlices.snippets, storeSlices.pfRules, skipDupes, targetVaultIds]);

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
          existingKeys: storeSlices.keys,
          existingIdentities: storeSlices.identities,
          existingSnippets: storeSlices.snippets,
          existingPfRules: storeSlices.pfRules,
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
      + (readyStatus.bundle.identities.length - readyStatus.skippedIdentities)
      + (readyStatus.bundle.keys.length - readyStatus.skippedKeys)
      + readyStatus.bundle.folders.length
      + (readyStatus.bundle.snippets.length - readyStatus.skippedSnippets)
      + (readyStatus.bundle.portForwardingRules.length - readyStatus.skippedPfRules)
    : 0;
  const totalToImport = itemsPerVault * targetVaultIds.length;

  return (
    <div className="flex flex-col gap-4 h-full">

      <div className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">Import from</p>
        <div className="flex flex-wrap gap-1.5">
          {IMPORTERS.map(importer => {
            const active = selectedSource === importer.key;
            return (
              <button
                key={importer.key}
                type="button"
                onClick={() => setSelectedSource(importer.key)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: active ? "color-mix(in srgb, var(--t-accent) 12%, transparent)" : "var(--t-bg-elevated)",
                  border: `1px solid ${active ? "var(--t-accent)" : "var(--t-border-hover)"}`,
                  color: active ? "var(--t-accent)" : "var(--t-text-primary)",
                }}
              >
                {importer.key === "voltius"
                  ? <LogoSvg style={{ height: 14, width: "auto" }} />
                  : <Icon icon={importer.icon} width={14} />}
                {importer.label}
              </button>
            );
          })}
        </div>
        {source.hint && (
          <p className="text-xs text-[var(--t-text-dim)] flex items-center gap-1.5 mt-0.5">
            <Icon icon="lucide:info" width={11} />
            {source.hint}
          </p>
        )}
      </div>

      {selectedSource === "mobaxterm" && mobaDetected && !text.trim() && (
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style={{ background: "color-mix(in srgb, var(--t-accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--t-accent) 35%, transparent)" }}
        >
          <Icon icon="lucide:circle-check" width={15} style={{ color: "var(--t-accent)", flexShrink: 0 }} />
          <span className="text-sm flex-1" style={{ color: "var(--t-text-primary)" }}>MobaXterm installation detected</span>
          <button
            onClick={() => setText(mobaDetected)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium shrink-0 transition-opacity hover:opacity-80"
            style={{ background: "var(--t-accent)", color: "#fff" }}
          >
            <Icon icon="lucide:download" width={12} />
            Import now
          </button>
        </div>
      )}

      {source.autoExtract && !text.trim() && status.type !== "ready" && (
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style={{ background: "color-mix(in srgb, var(--t-accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--t-accent) 35%, transparent)" }}
        >
          <Icon icon="lucide:database" width={15} style={{ color: "var(--t-accent)", flexShrink: 0 }} />
          <span className="text-sm flex-1" style={{ color: "var(--t-text-primary)" }}>
            Read and decrypt the local {source.label} database
          </span>
          <button
            onClick={handleAutoExtract}
            disabled={extracting}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium shrink-0 transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: "var(--t-accent)", color: "#fff" }}
          >
            <Icon icon={extracting ? "lucide:loader-2" : "lucide:download"} width={12} className={extracting ? "animate-spin" : ""} />
            {extracting ? "Extracting…" : `Extract from ${source.label}`}
          </button>
        </div>
      )}

      {selectedSource !== "termius" && (
        <FileInputArea
          text={text}
          onChange={setText}
          placeholder={source.placeholder}
          fileAccept={source.fileAccept}
          openLabel={`Open ${source.sub} file…`}
          hasError={status.type === "error"}
          onClear={() => { setStatus({ type: "idle" }); setImportResult(null); }}
        />
      )}

      {status.type === "error" && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.12)", color: "var(--t-status-error)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <Icon icon="lucide:alert-circle" width={15} className="mt-0.5 shrink-0" />
          {status.message}
        </div>
      )}

      {status.type === "needs-password" && (
        <div className="flex flex-col gap-3 p-3 rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--t-text-primary)" }}>
            <Icon icon="lucide:lock" width={14} style={{ color: "var(--t-accent)" }} />
            Encrypted backup — enter your password to unlock
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={decryptPassword}
              onChange={e => setDecryptPassword(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void handleDecrypt(); }}
              placeholder="Password"
              autoFocus
              className="flex-1 px-2.5 py-1.5 rounded-lg text-sm outline-none bg-[var(--t-bg-input)] border border-[var(--t-border-hover)] text-[var(--t-text-primary)]"
            />
            <ActionBtn icon="lucide:unlock" label="Unlock" onClick={handleDecrypt} primary disabled={!decryptPassword} />
          </div>
        </div>
      )}

      {status.type === "ready" && (
        <div className="flex flex-col gap-3 p-3 rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
          <div className="flex items-center gap-2 text-sm text-[var(--t-text-primary)]">
            <Icon icon="lucide:check-circle" width={15} className="text-[var(--t-status-ok)]" />
            <span>
              {(() => {
                const effConn = status.connections.length;
                const effIdent = status.bundle.identities.length - status.skippedIdentities;
                const effKeys = status.bundle.keys.length - status.skippedKeys;
                const effSnippets = status.bundle.snippets.length - status.skippedSnippets;
                const effPf = status.bundle.portForwardingRules.length - status.skippedPfRules;
                const totalSkipped = (status.bundle.connections.length - status.connections.length)
                  + status.skippedKeys + status.skippedIdentities + status.skippedSnippets + status.skippedPfRules;
                return (
                  <>
                    {"Found "}
                    {[
                      effConn > 0 && `${effConn} connection${effConn !== 1 ? "s" : ""}`,
                      effIdent > 0 && `${effIdent} identit${effIdent !== 1 ? "ies" : "y"}`,
                      effKeys > 0 && `${effKeys} key${effKeys !== 1 ? "s" : ""}`,
                      effSnippets > 0 && `${effSnippets} snippet${effSnippets !== 1 ? "s" : ""}`,
                      effPf > 0 && `${effPf} port rule${effPf !== 1 ? "s" : ""}`,
                    ].filter(Boolean).join(", ") || "no items"}
                    {skipDupes && totalSkipped > 0 && (
                      <span className="text-[var(--t-text-muted)]">
                        {" "}({totalSkipped} duplicate{totalSkipped !== 1 ? "s" : ""} skipped)
                      </span>
                    )}
                  </>
                );
              })()}
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

      <div className="mt-auto flex flex-col gap-3 pt-3 border-t border-[var(--t-border)]">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">Import into</p>
          <VaultChipSelect selectedIds={targetVaultIds} onChange={setTargetVaultIds} writableOnly />
        </div>
        <ActionBtn
          icon={importing ? "lucide:loader" : "lucide:download"}
          label={importing ? "Importing…" : totalToImport > 0 ? `Import ${totalToImport} item${totalToImport !== 1 ? "s" : ""}${targetVaultIds.length > 1 ? ` × ${targetVaultIds.length} vaults` : ""}` : "Import"}
          onClick={handleImport}
          primary
          disabled={totalToImport === 0 || importing}
        />
      </div>
    </div>
  );
}
