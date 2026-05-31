import { useState, useEffect, useCallback, useRef } from "react";
import { Toggle } from "@/components/shared/Toggle";
import { Icon } from "@iconify/react";
import { usePluginStore } from "@/stores/pluginStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { useUIStore } from "@/stores/uiStore";
import { BUNDLED_PLUGINS } from "@/plugins/bundled";
import { useFilterShortcut } from "@/components/shared/ToolbarViewControls";
import { setPluginActive, getLoadedPlugins, pluginStorageGet, pluginStorageSet } from "@/plugins/runtime";
import type { PluginManifest, PluginConfigField } from "@/plugins/api";

// ─── Auto-generated settings form ─────────────────────────────────────────

/**
 * Derive a human label from a config key so the host guarantees a readable
 * baseline regardless of plugin-author effort: camelCase, snake_case and
 * kebab-case all become Title Case. `field.label` overrides this when the
 * derivation is wrong (e.g. acronyms or unit hints).
 */
function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function PluginConfigForm({ manifest }: { manifest: PluginManifest }) {
  const config = manifest.contributes?.configuration ?? {};
  const keys = Object.keys(config);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      keys.map(async (key) => {
        const val = await pluginStorageGet(manifest.id, key);
        return [key, val ?? config[key].default] as [string, unknown];
      }),
    ).then((entries) => {
      if (!cancelled) setValues(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest.id]);

  const save = useCallback(async (key: string, value: unknown) => {
    setSaving((s) => ({ ...s, [key]: true }));
    setValues((s) => ({ ...s, [key]: value }));
    await pluginStorageSet(manifest.id, key, value);
    setSaving((s) => ({ ...s, [key]: false }));
  }, [manifest.id]);

  if (keys.length === 0) {
    return <p className="text-sm text-[var(--t-text-dim)]">No configurable settings.</p>;
  }

  return (
    <div className="space-y-4">
      {keys.map((key) => {
        const field: PluginConfigField = config[key];
        const value = values[key] ?? field.default;
        const isSaving = saving[key] ?? false;

        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-[var(--t-text-primary)]">{field.label ?? humanizeKey(key)}</label>
              {isSaving && <Icon icon="lucide:loader" width={13} className="animate-spin text-[var(--t-text-muted)]" />}
            </div>
            <p className="text-xs text-[var(--t-text-dim)]">{field.description}</p>

            {field.type === "boolean" && (
              <Toggle checked={!!value} onChange={(v) => void save(key, v)} />
            )}

            {(field.type === "string" || field.type === "number") && (
              <input
                type={field.secret ? "password" : field.type === "number" ? "number" : "text"}
                value={String(value ?? "")}
                min={field.type === "number" ? field.min : undefined}
                max={field.type === "number" ? field.max : undefined}
                onChange={(e) => {
                  if (field.type === "number") {
                    let n = Number(e.target.value);
                    if (field.min !== undefined) n = Math.max(field.min, n);
                    if (field.max !== undefined) n = Math.min(field.max, n);
                    void save(key, n);
                  } else {
                    void save(key, e.target.value);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--t-bg-elevated)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:outline-none focus:border-[var(--t-accent)]"
              />
            )}

            {field.type === "select" && (
              <select
                value={String(value ?? "")}
                onChange={(e) => void save(key, e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--t-bg-elevated)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:outline-none focus:border-[var(--t-accent)]"
              >
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Installed tab ─────────────────────────────────────────────────────────

function InstalledTab() {
  const settingsPages = usePluginStore((s) => s.settingsPages);
  const { setEnabled, isEnabled } = usePluginRegistryStore();
  const { installedMeta, uninstallPlugin, reloadPlugin, scanLocal } = useMarketplaceStore();
  const [loadedIds, setLoadedIds] = useState<Set<string>>(
    () => new Set(getLoadedPlugins().map((m) => m.id)),
  );
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const pendingPageId = useUIStore((s) => s.settingsPluginPageId);
  const setSettingsPluginPageId = useUIStore((s) => s.setSettingsPluginPageId);

  useEffect(() => {
    if (pendingPageId) {
      setActivePageId(pendingPageId);
      setSettingsPluginPageId(null);
    }
  }, [pendingPageId, setSettingsPluginPageId]);
  const [autoConfigManifest, setAutoConfigManifest] = useState<PluginManifest | null>(null);
  const [reloading, setReloading] = useState<Set<string>>(new Set());
  const [uninstalling, setUninstalling] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useFilterShortcut(searchRef);

  const refreshLoaded = () =>
    setLoadedIds(new Set(getLoadedPlugins().map((m) => m.id)));

  const handleToggle = (pluginId: string, currentlyEnabled: boolean) => {
    setPluginActive(pluginId, !currentlyEnabled);
    void setEnabled(pluginId, !currentlyEnabled);
    refreshLoaded();
  };

  const handleReload = async (id: string) => {
    setReloading((s) => new Set([...s, id]));
    try {
      await reloadPlugin(id);
      refreshLoaded();
    } catch (e) {
      console.error(`[plugins] reload failed for "${id}":`, e);
    } finally {
      setReloading((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const handleUninstall = async (id: string) => {
    setUninstalling((s) => new Set([...s, id]));
    try {
      await uninstallPlugin(id);
      refreshLoaded();
    } finally {
      setUninstalling((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try { await scanLocal(); refreshLoaded(); } finally { setScanning(false); }
  };

  if (autoConfigManifest) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-6 py-3 shrink-0 border-b border-b-[var(--t-border)]">
          <button
            onClick={() => setAutoConfigManifest(null)}
            className="p-1 rounded-lg transition-colors text-[var(--t-text-muted)]"
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
          >
            <Icon icon="lucide:arrow-left" width={15} />
          </button>
          <span className="text-sm font-medium text-[var(--t-text-primary)]">
            {autoConfigManifest.name} Settings
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <PluginConfigForm manifest={autoConfigManifest} />
        </div>
      </div>
    );
  }

  if (activePageId) {
    const page = settingsPages.get(activePageId);
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-6 py-3 shrink-0 border-b border-b-[var(--t-border)]">
          <button
            onClick={() => setActivePageId(null)}
            className="p-1 rounded-lg transition-colors text-[var(--t-text-muted)]"
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
          >
            <Icon icon="lucide:arrow-left" width={15} />
          </button>
          <span className="text-sm font-medium text-[var(--t-text-primary)]">
            {page?.label ?? activePageId}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {page ? <page.component /> : (
            <p className="text-sm text-[var(--t-text-dim)]">Page not found.</p>
          )}
        </div>
      </div>
    );
  }

  const externalPluginIds = new Set(installedMeta.map((m) => m.id));
  const externalManifests = getLoadedPlugins().filter((m) => externalPluginIds.has(m.id));

  const allBundled = BUNDLED_PLUGINS;
  const allExternal = installedMeta;

  const matchesSearch = (name: string, description?: string) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || (description ?? "").toLowerCase().includes(q);
  };

  const filteredBundled = allBundled.filter(({ manifest }) =>
    matchesSearch(manifest.name, manifest.description),
  );
  const filteredExternal = allExternal.filter((meta) => {
    const manifest = externalManifests.find((m) => m.id === meta.id);
    return matchesSearch(manifest?.name ?? meta.id, manifest?.description);
  });

  return (
    <div className="flex flex-col h-full">
    <div className="px-6 pt-4 pb-3 shrink-0 border-b border-b-[var(--t-border)]">
      <div className="relative flex items-center gap-2">
        <Icon icon="lucide:search" width={14} className="absolute left-3 text-[var(--t-text-dim)] pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Filter plugins…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-[var(--t-bg-elevated)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:outline-none focus:border-[var(--t-accent)]"
        />
        <button
          onClick={() => void handleScan()}
          disabled={scanning}
          className="p-2 rounded-lg text-[var(--t-text-dim)] transition-colors border border-[var(--t-border)] shrink-0"
          style={{ background: "var(--t-bg-elevated)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
          title="Scan for local plugins"
        >
          <Icon icon="lucide:refresh-cw" width={13} className={scanning ? "animate-spin" : ""} />
        </button>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="space-y-2">
        {/* Bundled plugins */}
        {filteredBundled.map(({ manifest }) => {
          const enabled = isEnabled(manifest.id, manifest.defaultEnabled ?? true) && loadedIds.has(manifest.id);
          const pluginPages = [...settingsPages.values()].filter((p) => p.id.startsWith(manifest.id));
          const hasAutoConfig = !!manifest.contributes?.configuration && Object.keys(manifest.contributes.configuration).length > 0;
          const showSettingsBtn = pluginPages.length > 0 || hasAutoConfig;

          return (
            <div
              key={manifest.id}
              className="rounded-xl overflow-hidden bg-[var(--t-bg-card)]"
              style={{ border: `1px solid ${enabled ? "var(--t-border-hover)" : "var(--t-border)"}`, opacity: enabled ? 1 : 0.6 }}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
                  <Icon icon="lucide:puzzle" width={15} style={{ color: enabled ? "var(--t-accent)" : "var(--t-text-dim)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate text-[var(--t-text-primary)]">{manifest.name}</p>
                    <span className="text-xs px-1.5 py-0.5 rounded shrink-0 bg-[var(--t-bg-elevated)] text-[var(--t-text-dim)] border border-[var(--t-border)]">
                      Bundled
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 truncate text-[var(--t-text-dim)]">v{manifest.version} · {manifest.description}</p>
                </div>
                {showSettingsBtn && (
                  <button
                    onClick={() => {
                      if (pluginPages.length > 0) setActivePageId(pluginPages[0].id);
                      else setAutoConfigManifest(manifest);
                    }}
                    className="p-1.5 rounded-lg transition-colors shrink-0 text-[var(--t-text-dim)]"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
                    title="Plugin settings"
                  >
                    <Icon icon="lucide:settings" width={15} />
                  </button>
                )}
                <Toggle checked={enabled} onChange={() => handleToggle(manifest.id, enabled)} />
              </div>
              {manifest.permissions.length > 0 && (
                <div className="flex flex-wrap gap-1 px-4 py-2 border-t border-t-[var(--t-border)]">
                  {manifest.permissions.map((perm) => (
                    <span key={perm} className="text-xs px-1.5 py-0.5 rounded bg-[var(--t-bg-base)] text-[var(--t-text-dim)]">{perm}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Externally installed plugins */}
        {filteredExternal.map((meta) => {
          const manifest = externalManifests.find((m) => m.id === meta.id);
          const isLoaded = loadedIds.has(meta.id);
          const isReloading = reloading.has(meta.id);
          const isUninstalling = uninstalling.has(meta.id);

          return (
            <div
              key={meta.id}
              className="rounded-xl overflow-hidden bg-[var(--t-bg-card)]"
              style={{ border: `1px solid ${isLoaded ? "var(--t-border-hover)" : "var(--t-border)"}`, opacity: isLoaded ? 1 : 0.7 }}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
                  <Icon icon="lucide:puzzle" width={15} style={{ color: isLoaded ? "var(--t-accent)" : "var(--t-text-dim)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate text-[var(--t-text-primary)]">
                      {manifest?.name ?? meta.id}
                    </p>
                    <span className="text-xs px-1.5 py-0.5 rounded shrink-0 bg-[var(--t-bg-elevated)] text-[var(--t-text-dim)] border border-[var(--t-border)]">
                      {meta.sourceId === "local" ? "Local" : meta.sourceId === "url" ? "URL" : "Installed"}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded shrink-0 bg-[var(--t-bg-base)] text-[var(--t-text-dim)]">
                      v{meta.version}
                    </span>
                  </div>
                  {manifest && (
                    <p className="text-xs mt-0.5 truncate text-[var(--t-text-dim)]">{manifest.description}</p>
                  )}
                </div>
                <button
                  onClick={() => void handleReload(meta.id)}
                  disabled={isReloading}
                  className="p-1.5 rounded-lg transition-colors shrink-0 text-[var(--t-text-dim)]"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
                  title="Reload plugin"
                >
                  <Icon icon="lucide:refresh-cw" width={14} className={isReloading ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={() => void handleUninstall(meta.id)}
                  disabled={isUninstalling}
                  className="p-1.5 rounded-lg transition-colors shrink-0 text-[var(--t-text-dim)]"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--t-status-error) 15%, transparent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
                  title="Uninstall plugin"
                >
                  <Icon icon={isUninstalling ? "lucide:loader" : "lucide:trash-2"} width={14} className={isUninstalling ? "animate-spin" : ""} />
                </button>
              </div>
              {manifest && manifest.permissions.length > 0 && (
                <div className="flex flex-wrap gap-1 px-4 py-2 border-t border-t-[var(--t-border)]">
                  {manifest.permissions.map((perm) => (
                    <span key={perm} className="text-xs px-1.5 py-0.5 rounded bg-[var(--t-bg-base)] text-[var(--t-text-dim)]">{perm}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {filteredBundled.length === 0 && filteredExternal.length === 0 && (
          <p className="text-sm text-center py-8 text-[var(--t-text-dim)]">
            {search ? "No plugins match your search." : "No plugins installed."}
          </p>
        )}
      </div>
    </div>
    </div>
  );
}

// ─── Browse tab ────────────────────────────────────────────────────────────

function BrowseTab() {
  const {
    catalog, catalogLoading, catalogError, fetchCatalog,
    sources, addSource, removeSource, toggleSource,
    installedMeta, installing, installPlugin, uninstallPlugin,
  } = useMarketplaceStore();

  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [uninstalling, setUninstalling] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  useFilterShortcut(searchRef);

  const handleUninstall = async (id: string) => {
    setUninstalling((s) => new Set([...s, id]));
    try { await uninstallPlugin(id); } finally {
      setUninstalling((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [addSourceError, setAddSourceError] = useState<string | null>(null);

  useEffect(() => {
    if (catalog.length === 0 && !catalogLoading) {
      void fetchCatalog();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installedIds = new Set(installedMeta.map((m) => m.id));

  const allTags = [...new Set(catalog.flatMap((p) => p.tags))].sort();

  const filtered = catalog.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());
    const matchTag = !activeTag || p.tags.includes(activeTag);
    return matchSearch && matchTag;
  });

  const handleAddSource = async () => {
    if (!newSourceUrl.trim()) return;
    setAddingSource(true);
    setAddSourceError(null);
    try {
      await addSource(newSourceUrl.trim());
      setNewSourceUrl("");
      await fetchCatalog();
    } catch (e) {
      setAddSourceError(String(e));
    } finally {
      setAddingSource(false);
    }
  };

  if (showSources) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-6 py-3 shrink-0 border-b border-b-[var(--t-border)]">
          <button
            onClick={() => setShowSources(false)}
            className="p-1 rounded-lg transition-colors text-[var(--t-text-muted)]"
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
          >
            <Icon icon="lucide:arrow-left" width={15} />
          </button>
          <span className="text-sm font-medium text-[var(--t-text-primary)]">Plugin Sources</span>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-2">
            {sources.map((source) => (
              <div key={source.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--t-bg-card)] border border-[var(--t-border)]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--t-text-primary)] truncate">{source.name}</p>
                  <p className="text-xs text-[var(--t-text-dim)] truncate">{source.url}</p>
                </div>
                <Toggle checked={source.enabled} onChange={() => toggleSource(source.id)} />
                {source.deletable && (
                  <button
                    onClick={() => removeSource(source.id)}
                    className="p-1.5 rounded-lg text-[var(--t-text-dim)] transition-colors"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
                  >
                    <Icon icon="lucide:trash-2" width={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--t-text-dim)]">Add source</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://example.com/plugins.json"
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleAddSource(); }}
                className="flex-1 px-3 py-2 rounded-lg text-sm bg-[var(--t-bg-elevated)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:outline-none focus:border-[var(--t-accent)]"
              />
              <button
                onClick={() => void handleAddSource()}
                disabled={addingSource || !newSourceUrl.trim()}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: "var(--t-accent)", color: "var(--t-bg-base)", opacity: addingSource ? 0.6 : 1 }}
              >
                {addingSource ? <Icon icon="lucide:loader" width={14} className="animate-spin" /> : "Add"}
              </button>
            </div>
            {addSourceError && (
              <p className="text-xs text-[var(--t-status-error)]">{addSourceError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 space-y-3 shrink-0 border-b border-b-[var(--t-border)]">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon icon="lucide:search" width={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t-text-dim)]" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search plugins…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-[var(--t-bg-elevated)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:outline-none focus:border-[var(--t-accent)]"
            />
          </div>
          <button
            onClick={() => void fetchCatalog()}
            disabled={catalogLoading}
            className="p-2 rounded-lg text-[var(--t-text-dim)] transition-colors border border-[var(--t-border)]"
            style={{ background: "var(--t-bg-elevated)" }}
            title="Refresh catalog"
          >
            <Icon icon="lucide:refresh-cw" width={14} className={catalogLoading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowSources(true)}
            className="p-2 rounded-lg text-[var(--t-text-dim)] transition-colors border border-[var(--t-border)]"
            style={{ background: "var(--t-bg-elevated)" }}
            title="Manage sources"
          >
            <Icon icon="lucide:settings-2" width={14} />
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className="px-2 py-0.5 rounded-full text-xs transition-colors"
                style={{
                  background: activeTag === tag ? "var(--t-accent)" : "var(--t-bg-elevated)",
                  color: activeTag === tag ? "var(--t-bg-base)" : "var(--t-text-dim)",
                  border: `1px solid ${activeTag === tag ? "var(--t-accent)" : "var(--t-border)"}`,
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {catalogError && (
          <p className="text-sm text-[var(--t-status-error)] mb-4">{catalogError}</p>
        )}

        {catalogLoading && filtered.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Icon icon="lucide:loader" width={20} className="animate-spin text-[var(--t-text-dim)]" />
          </div>
        )}

        {!catalogLoading && filtered.length === 0 && (
          <p className="text-sm text-center py-8 text-[var(--t-text-dim)]">
            {catalog.length === 0 ? "No plugins in catalog." : "No results."}
          </p>
        )}

        <div className="space-y-2">
          {filtered.map((plugin) => {
            const isInstalled = installedIds.has(plugin.id);
            const isInstalling = installing.has(plugin.id);
            const isUninstalling = uninstalling.has(plugin.id);

            return (
              <div key={plugin.id} className="rounded-xl bg-[var(--t-bg-card)] border border-[var(--t-border)] px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--t-bg-elevated)] border border-[var(--t-border)] mt-0.5">
                    <Icon icon={plugin.theme ? "lucide:palette" : "lucide:puzzle"} width={15} className="text-[var(--t-accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-[var(--t-text-primary)]">{plugin.name}</p>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--t-bg-elevated)] text-[var(--t-text-dim)] border border-[var(--t-border)]">
                        {plugin.sourceId}
                      </span>
                      {isInstalled && (
                        <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)", color: "var(--t-accent)" }}>
                          Installed
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">{plugin.description}</p>
                    <p className="text-xs mt-1 text-[var(--t-text-dim)]">
                      by {plugin.author} · v{plugin.version}
                    </p>
                    {plugin.tags.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {plugin.tags.map((tag) => (
                          <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-[var(--t-bg-base)] text-[var(--t-text-dim)]">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {isInstalled ? (
                    <button
                      onClick={() => void handleUninstall(plugin.id)}
                      disabled={isUninstalling}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors"
                      style={{ background: "color-mix(in srgb, var(--t-status-error) 15%, transparent)", color: "var(--t-status-error)", opacity: isUninstalling ? 0.6 : 1 }}
                    >
                      {isUninstalling
                        ? <><Icon icon="lucide:loader" width={12} className="animate-spin" /> Removing…</>
                        : <><Icon icon="lucide:trash-2" width={12} /> Uninstall</>
                      }
                    </button>
                  ) : (
                    <button
                      onClick={() => void installPlugin(plugin)}
                      disabled={isInstalling}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors"
                      style={{ background: "var(--t-accent)", color: "var(--t-bg-base)", opacity: isInstalling ? 0.7 : 1 }}
                    >
                      {isInstalling
                        ? <><Icon icon="lucide:loader" width={12} className="animate-spin" /> Installing…</>
                        : <><Icon icon="lucide:download" width={12} /> Install</>
                      }
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main section ──────────────────────────────────────────────────────────

type Tab = "installed" | "browse";

export default function PluginsSection() {
  const [tab, setTab] = useState<Tab>("installed");
  const installedMeta = useMarketplaceStore((s) => s.installedMeta);
  const totalCount = BUNDLED_PLUGINS.length + installedMeta.length;

  const tabLabel = (t: Tab) =>
    t === "installed" ? `Installed (${totalCount})` : "Browse";

  return (
    <div className="flex flex-col h-full">
      <div className="flex px-6 pt-4 gap-1 shrink-0 border-b border-b-[var(--t-border)]">
        {(["installed", "browse"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium transition-colors rounded-t-lg -mb-px"
            style={{
              color: tab === t ? "var(--t-text-primary)" : "var(--t-text-dim)",
              borderBottom: tab === t ? "2px solid var(--t-accent)" : "2px solid transparent",
            }}
          >
            {tabLabel(t)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "installed" ? <InstalledTab /> : <BrowseTab />}
      </div>
    </div>
  );
}
