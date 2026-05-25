import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { encryptText, toJSON } from "@/services/import-export/formats";
import { connectionsToCSV } from "@/services/import-export/parsers/csv";
import type { ExportBundle } from "@/services/import-export/formats";
import { HANDLERS, buildBundle } from "@/services/import-export/registry";
import { useStoreSlices } from "./useStores";
import type { SelectionProps } from "@/services/import-export/context";
import { ActionBtn, Checkbox, Radio, VaultChipSelect } from "./shared";

export function ExportTab({ singleConnectionId, singleKeyId, singleIdentityId, connectionIds, keyIds, identityIds, preselectedTypes }: {
  singleConnectionId?: string; singleKeyId?: string; singleIdentityId?: string;
  connectionIds?: string[]; keyIds?: string[]; identityIds?: string[];
  preselectedTypes?: string[];
}) {
  const stores = useStoreSlices();
  const accessibleVaultIds = useAccessibleVaultIds();

  const selection: SelectionProps = { singleConnectionId, singleKeyId, singleIdentityId, connectionIds, keyIds, identityIds };
  const isSingleItem = !!(singleConnectionId ?? singleKeyId ?? singleIdentityId);
  const isBulk = !!(connectionIds ?? keyIds ?? identityIds);

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
  const [encrypt, setEncrypt] = useState(false);
  const [encryptPassword, setEncryptPassword] = useState("");
  const [encryptConfirm, setEncryptConfirm] = useState("");

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
  const encryptReady = !encrypt || (!!encryptPassword && encryptPassword === encryptConfirm);

  const getExportContent = async (): Promise<{ content: string; ext: string }> => {
    if (format !== "csv" && encrypt && encryptPassword) {
      return { content: await encryptText(preview, encryptPassword), ext: "json" };
    }
    return { content: preview, ext: format === "csv" ? "csv" : "json" };
  };

  const handleCopy = async () => {
    const { content } = await getExportContent();
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    const { content, ext } = await getExportContent();
    const blob = new Blob([content], { type: ext === "csv" ? "text/csv" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voltius-export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

      {format === "json" && (
        <div className="flex flex-col gap-2">
          <Checkbox checked={encrypt} onChange={v => { setEncrypt(v); if (!v) { setEncryptPassword(""); setEncryptConfirm(""); } }} label="Encrypt backup" />
          {encrypt && (
            <div className="flex flex-col gap-2 ml-6">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={encryptPassword}
                  onChange={e => setEncryptPassword(e.target.value)}
                  placeholder="Password"
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-sm outline-none bg-[var(--t-bg-input)] border border-[var(--t-border-hover)] text-[var(--t-text-primary)]"
                />
                <input
                  type="password"
                  value={encryptConfirm}
                  onChange={e => setEncryptConfirm(e.target.value)}
                  placeholder="Confirm"
                  className="flex-1 px-2.5 py-1.5 rounded-lg text-sm outline-none bg-[var(--t-bg-input)] border border-[var(--t-border-hover)] text-[var(--t-text-primary)]"
                />
              </div>
              {encryptPassword && encryptConfirm && encryptPassword !== encryptConfirm && (
                <p className="text-xs" style={{ color: "var(--t-status-error)" }}>Passwords don't match</p>
              )}
            </div>
          )}
        </div>
      )}

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
          <ActionBtn icon={copied ? "lucide:check" : "lucide:clipboard-copy"} label={copied ? "Copied!" : "Copy"} onClick={handleCopy} disabled={totalItems === 0 || building || !encryptReady} />
          <ActionBtn icon={encrypt ? "lucide:lock" : "lucide:download"} label={encrypt ? "Download encrypted" : `Download .${format}`} onClick={handleDownload} primary disabled={totalItems === 0 || building || !encryptReady} />
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
