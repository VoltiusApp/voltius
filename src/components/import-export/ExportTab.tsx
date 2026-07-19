import { writeClipboard } from "../../utils/clipboard";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useVaultContents } from "@/hooks/useVaultContents";
import { ContentCounts } from "@/components/shared/ContentCounts";
import { encryptText, toJSON } from "@/services/import-export/formats";
import { connectionsToCSV } from "@/services/import-export/parsers/csv";
import type { ExportBundle } from "@/services/import-export/formats";
import { HANDLERS, buildBundle } from "@/services/import-export/registry";
import { useStoreSlices } from "./useStores";
import type { SelectionProps } from "@/services/import-export/context";
import { hasSelection, isSingleSelection } from "@/services/import-export/context";
import { ActionBtn, Checkbox, VaultChipSelect } from "./shared";
import { Toggle } from "@/components/shared/Toggle";

export function ExportTab({ selection, preselectedTypes }: {
  selection: SelectionProps;
  preselectedTypes?: string[];
}) {
  const { t } = useTranslation();
  const stores = useStoreSlices();
  const accessibleVaultIds = useAccessibleVaultIds();
  const vaultContentCounts = useVaultContents();

  const isSingleItem = !!selection.single;
  const isBulk = !!selection.bulk && hasSelection(selection);
  const bulkCount = Object.values(selection.bulk ?? {}).reduce((a, b) => a + (b?.length ?? 0), 0);
  // JSON-only single items (key, identity, snippet) can't be CSV — lock to JSON.
  const singleHandler = selection.single ? HANDLERS.find(h => h.key === selection.single!.key) : undefined;
  const lockJsonFormat = !!singleHandler?.jsonOnly;

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
  /** Bundle carries plaintext secrets (passwords, keys, host notes) → encrypt by default. */
  const [bundleHasSecrets, setBundleHasSecrets] = useState(false);
  /** Once the user touches the toggle, stop overriding their choice. */
  const encryptTouched = useRef(false);

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
      const hasSecrets =
        bundle.connections.some(c => c.password || c.private_key || c.passphrase || c.notes) ||
        bundle.identities.some(i => i.password) ||
        bundle.keys.some(k => k.private_key || k.passphrase);
      setBundleHasSecrets(hasSecrets);
      if (hasSecrets && !encryptTouched.current) setEncrypt(true);
      setPreview(isCsvOnly ? connectionsToCSV(bundle.connections) : toJSON(bundle));
      setBuilding(false);
    }).catch(() => { if (!cancelled) setBuilding(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [included, format, exportVaultIds, stores.connections, stores.identities, stores.keys, stores.snippets, stores.pfRules]);

  const totalItems = Object.values(bundleCounts).reduce((a, b) => a + b, 0);
  const recapCounts = vaultContentCounts.map((item) => ({
    ...item,
    count: bundleCounts[item.key] ?? 0,
  }));
  const encryptReady = !encrypt || (!!encryptPassword && encryptPassword === encryptConfirm);

  const getExportContent = async (): Promise<{ content: string; ext: string }> => {
    if (format !== "csv" && encrypt && encryptPassword) {
      return { content: await encryptText(preview, encryptPassword), ext: "json" };
    }
    return { content: preview, ext: format === "csv" ? "csv" : "json" };
  };

  const handleCopy = async () => {
    const { content } = await getExportContent();
    await writeClipboard(content);
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
    if ((bundleCounts["identities"] ?? 0) > 0 && !isSingleSelection("identities", selection)) autoIncludes.push(t("importExport.export.autoIncludeIdentity", { count: bundleCounts["identities"] }));
    if ((bundleCounts["keys"] ?? 0) > 0 && !isSingleSelection("keys", selection)) autoIncludes.push(t("importExport.export.autoIncludeKey", { count: bundleCounts["keys"] }));
  }

  return (
    <div className="flex flex-col gap-5 h-full">
      <VaultChipSelect selectedIds={exportVaultIds} onChange={setExportVaultIds} />

      <div className="flex gap-6">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">{t("importExport.include")}</p>
          <div className="flex flex-col gap-2.5">
            {HANDLERS.map(h => {
              if (!h.isActive(selection)) return null;
              const available = h.countAvailable(stores, exportVaultIds);
              const bundled = bundleCounts[h.key];
              const displayCount = bundled !== undefined ? bundled : available;
              const disabled = h.jsonOnly && isCsvOnly;
              return (
                <div key={h.key} className="flex items-center gap-2">
                  <Checkbox
                    checked={included[h.key] && !disabled}
                    onChange={v => !disabled && toggle(h.key, v)}
                    label={h.checkboxLabel(selection, displayCount)}
                  />
                  {bundled !== undefined && bundled !== available && (
                    <span className="text-xs text-(--t-text-muted)">/ {available}</span>
                  )}
                </div>
              );
            })}
            {isBulk && !isSingleItem && (
              <p className="text-xs text-(--t-text-muted)">
                {t("importExport.export.selectedItem", { count: bulkCount })}
              </p>
            )}
          </div>
        </div>

        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">{t("importExport.export.format")}</p>
          <div className="flex flex-col gap-2">
            {!lockJsonFormat ? (
              <div className="flex gap-0.5 p-0.5 rounded-lg w-fit" style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)" }}>
                {(["json", "csv"] as const).map(f => (
                  <button key={f} onClick={() => setFormat(f)}
                    className="px-4 py-1 rounded-md text-sm font-medium transition-colors"
                    style={{
                      background: format === f ? "var(--t-bg-elevated)" : "transparent",
                      color: format === f ? "var(--t-text-bright)" : "var(--t-text-muted)",
                      border: `1px solid ${format === f ? "var(--t-border-hover)" : "transparent"}`,
                    }}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-sm font-medium text-(--t-text-primary)">JSON</span>
            )}
            <p className="text-xs text-(--t-text-dim)">
              {format === "csv" ? t("importExport.export.formatCsvDescription") : t("importExport.export.formatJsonDescription")}
            </p>
            {format === "json" && (
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex items-center gap-2.5">
                  <Toggle checked={encrypt} onChange={v => { encryptTouched.current = true; setEncrypt(v); if (!v) { setEncryptPassword(""); setEncryptConfirm(""); } }} />
                  <span className="text-sm text-(--t-text-primary)">{t("importExport.export.encryptBackup")}</span>
                </div>
                {bundleHasSecrets && !encrypt && (
                  <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--t-status-error)" }}>
                    <Icon icon="lucide:shield-alert" width={12} className="mt-0.5 shrink-0" />
                    {t("importExport.export.plaintextSecretsWarning")}
                  </p>
                )}
                {encrypt && (
                  <div className="flex flex-col gap-2 ml-6">
                    <div className="flex flex-col gap-1.5">
                      <input
                        type="password"
                        value={encryptPassword}
                        onChange={e => setEncryptPassword(e.target.value)}
                        placeholder={t("importExport.passwordPlaceholder")}
                        className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border-hover) text-(--t-text-primary)"
                      />
                      <input
                        type="password"
                        value={encryptConfirm}
                        onChange={e => setEncryptConfirm(e.target.value)}
                        placeholder={t("importExport.export.confirmPasswordPlaceholder")}
                        className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border-hover) text-(--t-text-primary)"
                      />
                    </div>
                    {encryptPassword && encryptConfirm && encryptPassword !== encryptConfirm && (
                      <p className="text-xs" style={{ color: "var(--t-status-error)" }}>{t("importExport.export.passwordsDontMatch")}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 py-3 border-y border-(--t-border)">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {building ? (
            <span className="text-xs text-(--t-text-dim) flex items-center gap-1.5">
              <Icon icon="lucide:loader" width={12} className="animate-spin" />
              {t("importExport.export.building")}
            </span>
          ) : (
            <>
              {totalItems > 0 ? (
                <ContentCounts counts={recapCounts} />
              ) : (
                <span className="text-sm text-(--t-text-muted) truncate">{t("importExport.export.nothingToExport")}</span>
              )}
              {autoIncludes.length > 0 && (
                <span className="text-xs flex items-center gap-1 text-(--t-text-dim) shrink-0">
                  <Icon icon="lucide:link" width={11} />
                  +{autoIncludes.join(" + ")}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ActionBtn icon={copied ? "lucide:check" : "lucide:clipboard-copy"} label={copied ? t("importExport.copied") : t("common.action.copy")} onClick={handleCopy} disabled={totalItems === 0 || building || !encryptReady} />
          <ActionBtn icon={encrypt ? "lucide:lock" : "lucide:download"} label={encrypt ? t("importExport.export.downloadEncrypted") : t("importExport.downloadExt", { ext: format })} onClick={handleDownload} primary disabled={totalItems === 0 || building || !encryptReady} />
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <button onClick={() => setShowPreview(p => !p)}
          className="flex items-center gap-1.5 text-xs mb-2 w-fit transition-opacity hover:opacity-70"
          style={{ color: "var(--t-text-dim)" }}
        >
          <Icon icon={showPreview ? "lucide:chevron-down" : "lucide:chevron-right"} width={12} />
          {showPreview ? t("importExport.export.hidePreview") : t("importExport.export.showPreview")}
        </button>
        {showPreview && (
          <textarea readOnly value={preview}
            className="flex-1 w-full text-xs rounded-lg p-3 resize-none font-mono outline-hidden bg-(--t-bg-terminal) text-(--t-text-secondary) border border-(--t-border)"
            style={{ minHeight: 160 }}
          />
        )}
      </div>
    </div>
  );
}
