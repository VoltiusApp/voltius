import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import LogoSvg from "/logo.svg?react";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { decryptText, fromJSON } from "@/services/import-export/formats";
import type { ConnectionExport, ExportBundle, FolderExport, IdentityExport, KeyExport, PortForwardingRuleExport, SnippetExport } from "@/services/import-export/formats";
import { runImport, reloadAll } from "@/services/import-export/registry";
import { existingConnectionsForVault } from "@/services/import-export/context";
import { IMPORTERS, parseImport } from "@/services/import-export/importers";
import { useImportStores, useReloadFns, useStoreSlices, useDeleteStores } from "./useStores";
import { ActionBtn, VaultChipSelect, useVaultList } from "./shared";
import { FileInputArea } from "./FileInputArea";

type ItemAction = "include" | "skip" | "overwrite";
type ItemMeta = { isDupe: boolean };

type ImportStatus =
  | { type: "idle" }
  | { type: "parsing" }
  | { type: "error"; message: string }
  | { type: "needs-password" }
  | { type: "ready";
      bundle: ExportBundle;
      connectionMeta: ItemMeta[];
      keyMeta: ItemMeta[];
      identityMeta: ItemMeta[];
      snippetMeta: ItemMeta[];
      pfRuleMeta: ItemMeta[];
    };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFolderPath(eid: string | undefined, folders: FolderExport[]): string {
  if (!eid) return "";
  const folder = folders.find(f => f._eid === eid);
  if (!folder) return "";
  const parent = getFolderPath(folder.parent_folder_eid, folders);
  return parent ? `${parent} / ${folder.name}` : folder.name;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ItemCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className="flex items-center justify-center w-4 h-4 rounded shrink-0 transition-colors"
      style={{
        background: checked ? "var(--t-accent)" : "var(--t-bg-input)",
        border: `1px solid ${checked ? "var(--t-accent)" : "var(--t-border-hover)"}`,
      }}
    >
      {checked && <Icon icon="lucide:check" width={10} color="white" />}
    </span>
  );
}

function DupeControl({ action, onChange }: { action: ItemAction; onChange: (a: ItemAction) => void }) {
  const opts: { key: ItemAction; label: string; activeColor: string }[] = [
    { key: "skip", label: "Skip", activeColor: "var(--t-status-error)" },
    { key: "include", label: "Import", activeColor: "var(--t-status-ok)" },
    { key: "overwrite", label: "Overwrite", activeColor: "var(--t-status-warn)" },
  ];
  return (
    <div
      className="flex gap-0.5 p-0.5 rounded-lg shrink-0"
      style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)" }}
    >
      {opts.map(o => (
        <button
          key={o.key}
          onClick={e => { e.stopPropagation(); onChange(o.key); }}
          className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
          style={{
            background: action === o.key ? "var(--t-bg-elevated)" : "transparent",
            color: action === o.key ? o.activeColor : "var(--t-text-muted)",
            border: `1px solid ${action === o.key ? "var(--t-border-hover)" : "transparent"}`,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ItemRow({ icon, title, sub, folderPath, isDupe, action, onToggle, onActionChange }: {
  icon: string;
  title: string;
  sub: string;
  folderPath?: string;
  isDupe: boolean;
  action: ItemAction;
  onToggle: () => void;
  onActionChange: (a: ItemAction) => void;
}) {
  return (
    <div
      onClick={isDupe ? undefined : onToggle}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-opacity select-none ${isDupe ? "" : "cursor-pointer"}`}
      style={{
        background: "var(--t-bg-elevated)",
        border: "1px solid var(--t-border)",
        opacity: action === "skip" ? 0.45 : 1,
      }}
    >
      {!isDupe && <ItemCheckbox checked={action !== "skip"} />}
      <Icon icon={icon} width={13} style={{ color: "var(--t-text-dim)", flexShrink: 0 }} />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm text-[var(--t-text-primary)] truncate">{title}</span>
        <span className="text-xs text-[var(--t-text-dim)] truncate">
          {folderPath ? `${folderPath} · ${sub}` : sub}
        </span>
      </div>
      {isDupe
        ? <DupeControl action={action} onChange={onActionChange} />
        : null}
    </div>
  );
}

function GroupHeader({ label, icon, included, total, allSkipped, collapsed, onToggleCollapse, onToggleAll }: {
  label: string; icon: string; included: number; total: number;
  allSkipped: boolean; collapsed: boolean;
  onToggleCollapse: () => void; onToggleAll: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
      >
        <Icon icon={collapsed ? "lucide:chevron-right" : "lucide:chevron-down"} width={11} style={{ color: "var(--t-text-dim)" }} />
        <Icon icon={icon} width={12} style={{ color: "var(--t-text-dim)" }} />
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">{label}</span>
        <span className="text-xs text-[var(--t-text-muted)]">{included}/{total}</span>
      </button>
      {!collapsed && (
        <button
          onClick={onToggleAll}
          className="ml-auto text-xs transition-opacity hover:opacity-70"
          style={{ color: "var(--t-text-dim)" }}
        >
          {allSkipped ? "Select all" : "Deselect all"}
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ImportTab() {
  const storeSlices = useStoreSlices();
  const { connections: existingConnections } = storeSlices;
  const importStores = useImportStores();
  const reloaders = useReloadFns();
  const deletes = useDeleteStores();
  const defaultVaultId = useDefaultVaultId();

  const [step, setStep] = useState<1 | 2>(1);
  const [itemAction, setItemAction] = useState<Map<string, ItemAction>>(new Map());
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedSource, setSelectedSource] = useState(IMPORTERS[0].key);
  const [targetVaultIds, setTargetVaultIds] = useState<string[]>([defaultVaultId]);
  const [text, setText] = useState("");
  const [addTag, setAddTag] = useState("");
  const [status, setStatus] = useState<ImportStatus>({ type: "idle" });
  const [decryptPassword, setDecryptPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const writableVaults = useVaultList(true);
  const source = IMPORTERS.find(i => i.key === selectedSource)!;

  const applyBundle = useCallback((bundle: ExportBundle) => {
    const targetVaultSaveIds = targetVaultIds.map(resolveVaultIdForSave);
    const existingConnSets = targetVaultSaveIds.map(vaultId =>
      new Set(existingConnectionsForVault(existingConnections, vaultId).map(c => `${c.host}:${c.port}:${c.username}`))
    );
    const existingKeySets = targetVaultSaveIds.map(vId =>
      new Set(storeSlices.keys.filter(k => !k.deleted_at && (k.vault_id ?? "personal") === vId).map(k => k.name))
    );
    const existingIdentitySets = targetVaultSaveIds.map(vId =>
      new Set(storeSlices.identities.filter(i => !i.deleted_at && (i.vault_id ?? "personal") === vId).map(i => i.name))
    );
    const existingSnippetSets = targetVaultSaveIds.map(vId =>
      new Set(storeSlices.snippets.filter(s => !s.deleted_at && (s.vault_id ?? "personal") === vId).map(s => s.name))
    );
    const existingPfSets = targetVaultSaveIds.map(vId =>
      new Set(storeSlices.pfRules.filter(r => !r.deleted_at && (r.vault_id ?? "personal") === vId).map(r => r.name))
    );

    const connectionMeta = bundle.connections.map(c => ({
      isDupe: existingConnSets.every(s => s.has(`${c.host}:${c.port}:${c.username}`)),
    }));
    const keyMeta = bundle.keys.map(k => ({
      isDupe: k.name ? existingKeySets.every(s => s.has(k.name!)) : false,
    }));
    const identityMeta = bundle.identities.map(i => ({
      isDupe: i.name ? existingIdentitySets.every(s => s.has(i.name!)) : false,
    }));
    const snippetMeta = bundle.snippets.map(s => ({
      isDupe: existingSnippetSets.every(es => es.has(s.name)),
    }));
    const pfRuleMeta = bundle.portForwardingRules.map(r => ({
      isDupe: existingPfSets.every(s => s.has(r.name)),
    }));

    const actions = new Map<string, ItemAction>();
    bundle.connections.forEach((_, i) => actions.set(`connections:${i}`, connectionMeta[i].isDupe ? "skip" : "include"));
    bundle.keys.forEach((_, i) => actions.set(`keys:${i}`, keyMeta[i].isDupe ? "skip" : "include"));
    bundle.identities.forEach((_, i) => actions.set(`identities:${i}`, identityMeta[i].isDupe ? "skip" : "include"));
    bundle.snippets.forEach((_, i) => actions.set(`snippets:${i}`, snippetMeta[i].isDupe ? "skip" : "include"));
    bundle.portForwardingRules.forEach((_, i) => actions.set(`pfRules:${i}`, pfRuleMeta[i].isDupe ? "skip" : "include"));
    setItemAction(actions);

    setStatus({ type: "ready", bundle, connectionMeta, keyMeta, identityMeta, snippetMeta, pfRuleMeta });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingConnections, storeSlices.keys, storeSlices.identities, storeSlices.snippets, storeSlices.pfRules, targetVaultIds]);

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
  }, [applyBundle]);

  useEffect(() => { parse(text); }, [text, parse]);

  const handleAutoExtract = useCallback(async () => {
    if (!source.autoExtract) return;
    setExtracting(true);
    setImportResult(null);
    setStatus({ type: "parsing" });
    try {
      applyBundle(await source.autoExtract());
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    } finally {
      setExtracting(false);
    }
  }, [source, applyBundle]);

  const handleDecrypt = useCallback(async () => {
    if (!decryptPassword) return;
    setStatus({ type: "parsing" });
    try {
      applyBundle(fromJSON(await decryptText(text, decryptPassword)));
    } catch (err) {
      setStatus({ type: "error", message: String(err) });
    }
  }, [decryptPassword, text, applyBundle]);

  // ── Action helpers ──────────────────────────────────────────────────────────

  const getAction = (key: string): ItemAction => itemAction.get(key) ?? "include";
  const setAction = (key: string, action: ItemAction) =>
    setItemAction(prev => new Map(prev).set(key, action));
  const toggleItem = (key: string) =>
    setAction(key, getAction(key) === "skip" ? "include" : "skip");

  const isGroupAllSkipped = (type: string, len: number) =>
    len > 0 && Array.from({ length: len }, (_, i) => getAction(`${type}:${i}`) === "skip").every(Boolean);

  const toggleGroup = (type: string, len: number) => {
    const allSkipped = isGroupAllSkipped(type, len);
    setItemAction(prev => {
      const next = new Map(prev);
      for (let i = 0; i < len; i++) next.set(`${type}:${i}`, allSkipped ? "include" : "skip");
      return next;
    });
  };

  const toggleCollapse = (type: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });

  const countIncluded = (type: string, len: number) =>
    Array.from({ length: len }, (_, i) => getAction(`${type}:${i}`) !== "skip").filter(Boolean).length;

  // ── Import ──────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (status.type !== "ready") return;
    setImporting(true);
    setImportResult(null);
    let imported = 0; let errors = 0;
    try {
      for (const vaultTargetId of targetVaultIds) {
        const vault_id = resolveVaultIdForSave(vaultTargetId);

        // Delete existing items marked as overwrite before re-importing
        const deleteOps: Promise<void>[] = [];
        status.bundle.connections.forEach((c, i) => {
          if (getAction(`connections:${i}`) === "overwrite") {
            const ex = storeSlices.connections.find(ec =>
              !ec.deleted_at && (ec.vault_id ?? "personal") === vault_id &&
              ec.host === c.host && ec.port === c.port && ec.username === c.username
            );
            if (ex) deleteOps.push(deletes.deleteConnection(ex.id));
          }
        });
        status.bundle.keys.forEach((k, i) => {
          if (getAction(`keys:${i}`) === "overwrite" && k.name) {
            const ex = storeSlices.keys.find(ek => !ek.deleted_at && (ek.vault_id ?? "personal") === vault_id && ek.name === k.name);
            if (ex) deleteOps.push(deletes.deleteKey(ex.id));
          }
        });
        status.bundle.identities.forEach((id, i) => {
          if (getAction(`identities:${i}`) === "overwrite" && id.name) {
            const ex = storeSlices.identities.find(ei => !ei.deleted_at && (ei.vault_id ?? "personal") === vault_id && ei.name === id.name);
            if (ex) deleteOps.push(deletes.deleteIdentity(ex.id));
          }
        });
        status.bundle.snippets.forEach((s, i) => {
          if (getAction(`snippets:${i}`) === "overwrite") {
            const ex = storeSlices.snippets.find(es => !es.deleted_at && (es.vault_id ?? "personal") === vault_id && es.name === s.name);
            if (ex) deleteOps.push(deletes.deleteSnippet(ex.id));
          }
        });
        status.bundle.portForwardingRules.forEach((r, i) => {
          if (getAction(`pfRules:${i}`) === "overwrite") {
            const ex = storeSlices.pfRules.find(er => !er.deleted_at && (er.vault_id ?? "personal") === vault_id && er.name === r.name);
            if (ex) deleteOps.push(deletes.deleteRule(ex.id));
          }
        });
        await Promise.all(deleteOps);

        const filteredBundle: ExportBundle = {
          ...status.bundle,
          connections: status.bundle.connections.filter((_, i) => getAction(`connections:${i}`) !== "skip"),
          keys: status.bundle.keys.filter((_, i) => getAction(`keys:${i}`) !== "skip"),
          identities: status.bundle.identities.filter((_, i) => getAction(`identities:${i}`) !== "skip"),
          snippets: status.bundle.snippets.filter((_, i) => getAction(`snippets:${i}`) !== "skip"),
          portForwardingRules: status.bundle.portForwardingRules.filter((_, i) => getAction(`pfRules:${i}`) !== "skip"),
        };

        const result = await runImport(filteredBundle, {
          vault_id,
          tag: addTag.trim(),
          skipDupes: false,
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
      setStep(1);
    } catch (err) {
      setImportResult(`Error: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  // ── Step 2: review ──────────────────────────────────────────────────────────

  if (step === 2 && status.type === "ready") {
    const { bundle, connectionMeta, keyMeta, identityMeta, snippetMeta, pfRuleMeta } = status;
    const q = search.toLowerCase();
    const matches = (strs: (string | undefined)[]) => !q || strs.some(s => s?.toLowerCase().includes(q));

    const totalDupes = [...connectionMeta, ...keyMeta, ...identityMeta, ...snippetMeta, ...pfRuleMeta].filter(m => m.isDupe).length;
    const allDupesSkipped = totalDupes > 0 && [
      ...connectionMeta.map((m, i) => !m.isDupe || getAction(`connections:${i}`) === "skip"),
      ...keyMeta.map((m, i) => !m.isDupe || getAction(`keys:${i}`) === "skip"),
      ...identityMeta.map((m, i) => !m.isDupe || getAction(`identities:${i}`) === "skip"),
      ...snippetMeta.map((m, i) => !m.isDupe || getAction(`snippets:${i}`) === "skip"),
      ...pfRuleMeta.map((m, i) => !m.isDupe || getAction(`pfRules:${i}`) === "skip"),
    ].every(Boolean);

    const toggleAllDupes = () => {
      const target: ItemAction = allDupesSkipped ? "include" : "skip";
      setItemAction(prev => {
        const next = new Map(prev);
        const apply = (meta: ItemMeta[], type: string) =>
          meta.forEach((m, i) => { if (m.isDupe) next.set(`${type}:${i}`, target); });
        apply(connectionMeta, "connections");
        apply(keyMeta, "keys");
        apply(identityMeta, "identities");
        apply(snippetMeta, "snippets");
        apply(pfRuleMeta, "pfRules");
        return next;
      });
    };

    const totalToImport = (
      countIncluded("connections", bundle.connections.length) +
      countIncluded("keys", bundle.keys.length) +
      countIncluded("identities", bundle.identities.length) +
      countIncluded("snippets", bundle.snippets.length) +
      countIncluded("pfRules", bundle.portForwardingRules.length)
    ) * targetVaultIds.length;

    const groups: { type: string; label: string; icon: string; meta: ItemMeta[]; rows: React.ReactNode[] }[] = [
      {
        type: "connections", label: "Connections", icon: "lucide:server",
        meta: connectionMeta,
        rows: bundle.connections.map((c: ConnectionExport, i: number) => {
          const fp = getFolderPath(c._folder_eid, bundle.folders);
          if (!matches([c.name, c.host, c.username, fp])) return null;
          return (
            <ItemRow key={i} icon="lucide:server"
              title={c.name || `${c.host}:${c.port}`}
              sub={`${c.host}:${c.port} · ${c.username}`}
              folderPath={fp || undefined}
              isDupe={connectionMeta[i].isDupe}
              action={getAction(`connections:${i}`)}
              onToggle={() => toggleItem(`connections:${i}`)}
              onActionChange={a => setAction(`connections:${i}`, a)}
            />
          );
        }),
      },
      {
        type: "keys", label: "SSH Keys", icon: "lucide:key",
        meta: keyMeta,
        rows: bundle.keys.map((k: KeyExport, i: number) => {
          const fp = getFolderPath(k._folder_eid, bundle.folders);
          if (!matches([k.name, k.key_type, fp])) return null;
          return (
            <ItemRow key={i} icon="lucide:key"
              title={k.name ?? "Unnamed key"}
              sub={k.key_type ?? "SSH Key"}
              folderPath={fp || undefined}
              isDupe={keyMeta[i].isDupe}
              action={getAction(`keys:${i}`)}
              onToggle={() => toggleItem(`keys:${i}`)}
              onActionChange={a => setAction(`keys:${i}`, a)}
            />
          );
        }),
      },
      {
        type: "identities", label: "Identities", icon: "lucide:user",
        meta: identityMeta,
        rows: bundle.identities.map((id: IdentityExport, i: number) => {
          const fp = getFolderPath(id._folder_eid, bundle.folders);
          if (!matches([id.name, id.username, fp])) return null;
          return (
            <ItemRow key={i} icon="lucide:user"
              title={id.name ?? id.username}
              sub={id.username}
              folderPath={fp || undefined}
              isDupe={identityMeta[i].isDupe}
              action={getAction(`identities:${i}`)}
              onToggle={() => toggleItem(`identities:${i}`)}
              onActionChange={a => setAction(`identities:${i}`, a)}
            />
          );
        }),
      },
      {
        type: "snippets", label: "Snippets", icon: "lucide:terminal",
        meta: snippetMeta,
        rows: bundle.snippets.map((s: SnippetExport, i: number) => {
          if (!matches([s.name])) return null;
          return (
            <ItemRow key={i} icon="lucide:terminal"
              title={s.name} sub="Snippet"
              isDupe={snippetMeta[i].isDupe}
              action={getAction(`snippets:${i}`)}
              onToggle={() => toggleItem(`snippets:${i}`)}
              onActionChange={a => setAction(`snippets:${i}`, a)}
            />
          );
        }),
      },
      {
        type: "pfRules", label: "Port Forwarding", icon: "lucide:arrow-right-left",
        meta: pfRuleMeta,
        rows: bundle.portForwardingRules.map((r: PortForwardingRuleExport, i: number) => {
          if (!matches([r.name, r.remote_host])) return null;
          return (
            <ItemRow key={i} icon="lucide:arrow-right-left"
              title={r.name}
              sub={`${r.local_port} → ${r.remote_host}:${r.remote_port}`}
              isDupe={pfRuleMeta[i].isDupe}
              action={getAction(`pfRules:${i}`)}
              onToggle={() => toggleItem(`pfRules:${i}`)}
              onActionChange={a => setAction(`pfRules:${i}`, a)}
            />
          );
        }),
      },
    ];

    return (
      <div className="flex flex-col gap-4 h-full">
        {/* Header */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStep(1)}
            className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
            style={{ color: "var(--t-text-dim)" }}
          >
            <Icon icon="lucide:arrow-left" width={13} />
            Back
          </button>
          <span className="text-sm font-semibold text-[var(--t-text-bright)] ml-1">Review import</span>
          {totalDupes > 0 && (
            <button
              onClick={toggleAllDupes}
              className="ml-auto text-xs px-2 py-0.5 rounded transition-opacity hover:opacity-70"
              style={{ color: "var(--t-text-dim)", border: "1px solid var(--t-border)" }}
            >
              {allDupesSkipped ? "Re-include duplicates" : "Skip all duplicates"}
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Icon icon="lucide:search" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--t-text-dim)" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter items…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-sm outline-none bg-[var(--t-bg-input)] border border-[var(--t-border-hover)] text-[var(--t-text-primary)]"
            style={{ fontSize: 13 }}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70">
              <Icon icon="lucide:x" width={12} style={{ color: "var(--t-text-dim)" }} />
            </button>
          )}
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 pr-0.5">
          {groups.map(g => {
            const visibleRows = g.rows.filter(Boolean);
            if (g.meta.length === 0 || visibleRows.length === 0) return null;
            const isCollapsed = collapsed.has(g.type);
            return (
              <div key={g.type}>
                <GroupHeader
                  label={g.label} icon={g.icon}
                  included={countIncluded(g.type, g.meta.length)}
                  total={g.meta.length}
                  allSkipped={isGroupAllSkipped(g.type, g.meta.length)}
                  collapsed={isCollapsed}
                  onToggleCollapse={() => toggleCollapse(g.type)}
                  onToggleAll={() => toggleGroup(g.type, g.meta.length)}
                />
                {!isCollapsed && (
                  <div className="flex flex-col gap-1">{visibleRows}</div>
                )}
              </div>
            );
          })}
        </div>

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

        <div className="flex flex-col gap-2 pt-3 border-t border-[var(--t-border)]">
          {showAdvanced && (
            <label className="flex items-center gap-2">
              <span className="text-xs text-[var(--t-text-dim)]">Tag:</span>
              <input value={addTag} onChange={e => setAddTag(e.target.value)} placeholder="optional"
                className="px-2 py-0.5 rounded text-xs outline-none bg-[var(--t-bg-input)] border border-[var(--t-border-hover)] text-[var(--t-text-primary)]"
                style={{ width: 100 }}
              />
            </label>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAdvanced(p => !p)}
              className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
              style={{ color: "var(--t-text-dim)" }}
            >
              <Icon icon={showAdvanced ? "lucide:chevron-down" : "lucide:chevron-right"} width={11} />
              Advanced
            </button>
            <div className="ml-auto">
              <ActionBtn
                icon={importing ? "lucide:loader" : "lucide:download"}
                label={importing
                  ? "Importing…"
                  : totalToImport > 0
                    ? `Import ${totalToImport} item${totalToImport !== 1 ? "s" : ""}${targetVaultIds.length > 1 ? ` × ${targetVaultIds.length} vaults` : ""}`
                    : "Nothing selected"}
                onClick={handleImport}
                primary
                disabled={totalToImport === 0 || importing}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: input ───────────────────────────────────────────────────────────

  const totalFound = status.type === "ready"
    ? status.bundle.connections.length + status.bundle.keys.length + status.bundle.identities.length
      + status.bundle.snippets.length + status.bundle.portForwardingRules.length
    : 0;

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

      {writableVaults.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">Import into</p>
          <VaultChipSelect selectedIds={targetVaultIds} onChange={setTargetVaultIds} writableOnly />
        </div>
      )}

      {source.autoExtract && !text.trim() && status.type !== "ready" && (
        <div
          className="flex flex-col gap-3 p-4 rounded-xl"
          style={{ background: "color-mix(in srgb, var(--t-accent) 8%, var(--t-bg-elevated))", border: "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)" }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
              style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)" }}
            >
              <Icon icon="lucide:database" width={18} style={{ color: "var(--t-accent)" }} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold" style={{ color: "var(--t-text-bright)" }}>
                Auto-extract from {source.label}
              </span>
              <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>
                Reads and decrypts your local {source.label} data — no manual export needed
              </span>
            </div>
          </div>
          <button
            onClick={handleAutoExtract}
            disabled={extracting}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: "var(--t-accent)", color: "#fff" }}
          >
            <Icon icon={extracting ? "lucide:loader-2" : "lucide:download"} width={14} className={extracting ? "animate-spin" : ""} />
            {extracting ? "Extracting…" : `Extract from ${source.label}`}
          </button>
        </div>
      )}

      {source.autoExtract && selectedSource !== "termius" && !text.trim() && status.type !== "ready" && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: "var(--t-border)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--t-text-dim)" }}>or import from file</span>
          <div className="flex-1 h-px" style={{ background: "var(--t-border)" }} />
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

      {status.type === "ready" && (
        <div className="mt-auto pt-3 border-t border-[var(--t-border)]">
          <ActionBtn
            icon="lucide:arrow-right"
            label={`Review ${totalFound} item${totalFound !== 1 ? "s" : ""}`}
            onClick={() => { setSearch(""); setStep(2); }}
            primary
          />
        </div>
      )}
    </div>
  );
}
