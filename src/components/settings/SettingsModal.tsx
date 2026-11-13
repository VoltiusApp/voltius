import { resolveLabel } from "@/plugins/resolveLabel";
import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useShortcutHint } from "@/stores/shortcutStore";
import { useUIStore } from "@/stores/uiStore";
import { Modal } from "@/components/shared/Modal";
import { getSettingsNav } from "@/components/settings/settingsNav";
import { renderSettingsSection } from "@/components/settings/settingsSections";
import { useIsMobile } from "@/utils/platform";
import { useUiLanguage } from "@/i18n";
import MobileSettings from "@/components/settings/MobileSettings";
import { usePluginNavChildren, useResolvedPluginPage } from "@/components/settings/usePluginNavChildren";
import { SettingsSearchField } from "@/components/settings/SettingsSearchField";
import { ResetAllButton, SettingsList, sectionOf, useSearchHits } from "@/components/settings/SettingsList";
import { useChangedSettings } from "@/components/settings/useChangedSettings";
import { Toggle } from "@/components/shared/Toggle";

export default function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const isMobile = useIsMobile();
  if (isMobile) return <MobileSettings open={open} />;
  if (!open) return null;
  return <DesktopSettings />;
}

function DesktopSettings() {
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const section = useUIStore((s) => s.settingsSection);
  const setSection = useUIStore((s) => s.setSettingsSection);
  const { t } = useTranslation();
  const openShortcut = useShortcutHint("themes");
  const locale = useUiLanguage();
  const nav = useMemo(() => getSettingsNav(), [locale]);
  const pluginChildren = usePluginNavChildren();
  const activePluginPage = useResolvedPluginPage();
  const pluginPageId = useUIStore((s) => s.settingsPluginPageId);
  const selectPluginPage = useUIStore((s) => s.selectPluginPage);
  const navExpanded = useUIStore((s) => s.pluginsNavExpanded);
  const setNavExpanded = useUIStore((s) => s.setPluginsNavExpanded);
  // A selected child force-expands, or the highlighted row would be invisible.
  const showChildren = pluginChildren.length > 0 && (navExpanded || pluginPageId !== null);
  const query = useUIStore((s) => s.settingsQuery);
  const changedOnly = useUIStore((s) => s.settingsChangedOnly);
  const setChangedOnly = useUIStore((s) => s.setSettingsChangedOnly);
  const searching = query.trim() !== "";
  const listMode = searching || changedOnly;
  const changedView = changedOnly && !searching;
  const changedCount = useChangedSettings().count;
  const hits = useSearchHits(query, changedOnly);
  const matchCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of hits) counts.set(sectionOf(h), (counts.get(sectionOf(h)) ?? 0) + 1);
    return counts;
  }, [hits]);

  return (
    <Modal onClose={() => setOpen(false)} blur>
      <div
        className="surface-modal-solid rounded-[var(--r-lg)] flex overflow-hidden animate-fadeIn"
        style={{
          width: "min(60rem, 92vw)",
          height: "min(38.667rem, 88vh)",
        }}
      >
        <nav
          className="flex flex-col shrink-0 py-4 bg-(--t-bg-toolbar) border-r border-r-(--t-border)"
          style={{ width: "15rem" }}
        >
          <div className="px-5 mb-3">
            <span className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
              {t("settings.chrome.title")}
            </span>
          </div>
          <div className="px-3 mb-3">
            <SettingsSearchField />
          </div>

          <div className="flex-1 px-2 space-y-0.5 overflow-y-auto">
            <button
              data-settings-nav="changed"
              onClick={() => { useUIStore.getState().setSettingsQuery(""); setChangedOnly(true); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors"
              style={{
                background: changedView ? "var(--t-bg-input)" : "transparent",
                color: changedView ? "var(--t-text-bright)" : "var(--t-text-secondary)",
                fontWeight: changedView ? 500 : 400,
              }}
              onMouseEnter={(e) => { if (!changedView) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
              onMouseLeave={(e) => { if (!changedView) e.currentTarget.style.background = "transparent"; }}
            >
              <Icon icon="lucide:list-restart" width={15} className="shrink-0" style={{ color: changedView ? "var(--t-accent)" : "inherit" }} />
              <span className="flex-1 min-w-0">{t("settings.search.changed")}</span>
              <span className="text-[10px] font-semibold tabular-nums px-1.5 rounded-full bg-(--t-bg-input) text-(--t-text-dim)">{changedCount}</span>
            </button>
            <div className="mx-3 my-1.5 border-t border-t-(--t-border)" />
            {nav.map((item) => {
              const isPlugins = item.id === "plugins";
              const active = !listMode && section === item.id && (!isPlugins || pluginPageId === null);
              const matches = matchCount.get(item.id) ?? 0;
              const hasGroup = isPlugins && pluginChildren.length > 0;

              // Two hit targets on one row means two SIBLING buttons — a <button>
              // nested in a <button> is invalid HTML and its clicks misbehave.
              const rowButton = (
                <button
                  onClick={() => {
                    setSection(item.id);
                    if (isPlugins) setNavExpanded(true); // navigating never collapses
                  }}
                  className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                  data-settings-nav={item.id}
                  style={{
                    background: active ? "var(--t-bg-input)" : "transparent",
                    color: active ? "var(--t-text-bright)" : "var(--t-text-secondary)",
                    fontWeight: active ? 500 : 400,
                    opacity: searching && matches === 0 ? 0.45 : undefined,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon icon={item.icon} width={15} className="shrink-0" style={{ color: active ? "var(--t-accent)" : "inherit" }} />
                  <span className="flex-1 min-w-0">{item.label}</span>
                  {searching && matches > 0 && <span className="text-[10px] tabular-nums text-(--t-text-dim)">{matches}</span>}
                </button>
              );

              return (
                <div key={item.id}>
                  <div className="flex items-center">
                    {rowButton}
                    {hasGroup && (
                      <button
                        onClick={() => setNavExpanded(!navExpanded)}
                        aria-expanded={showChildren}
                        aria-label={t(showChildren ? "settings.chrome.collapsePluginGroup" : "settings.chrome.expandPluginGroup")}
                        className="p-1 mr-1 rounded-md shrink-0 text-(--t-text-dim) transition-colors"
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; }}
                      >
                        <Icon icon={showChildren ? "lucide:chevron-down" : "lucide:chevron-right"} width={13} />
                      </button>
                    )}
                  </div>

                  {hasGroup && showChildren && (
                    <div className="mt-0.5 space-y-0.5">
                      {pluginChildren.map((child) => {
                        const childActive = pluginPageId === child.pageId;
                        return (
                          <button
                            key={child.pageId}
                            onClick={() => selectPluginPage(child.pageId)}
                            className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-lg text-sm text-left transition-colors"
                            style={{
                              background: childActive ? "var(--t-bg-input)" : "transparent",
                              color: childActive ? "var(--t-text-bright)" : "var(--t-text-secondary)",
                              fontWeight: childActive ? 500 : 400,
                            }}
                            onMouseEnter={(e) => { if (!childActive) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
                            onMouseLeave={(e) => { if (!childActive) e.currentTarget.style.background = "transparent"; }}
                          >
                            <Icon icon={child.icon} width={14} className="shrink-0" style={{ color: childActive ? "var(--t-accent)" : "inherit" }} />
                            <span className="min-w-0 wrap-break-word">{child.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-4 pt-3 border-t border-t-(--t-border)">
            <span className="text-xs text-(--t-text-dim)">{t("settings.chrome.openHint", { shortcut: openShortcut })}</span>
          </div>
        </nav>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4 shrink-0 border-b border-b-(--t-border)"
          >
            <span className="text-sm font-semibold text-(--t-text-bright)">
              {changedView
                ? t("settings.search.changedTitle")
                : searching
                  ? t("settings.search.results", { count: hits.length })
                  : activePluginPage ? resolveLabel(activePluginPage.label) : nav.find((n) => n.id === section)?.label}
            </span>
            <div className="flex items-center gap-3">
            {changedView && <ResetAllButton />}
            {searching && (
              <label className="flex items-center gap-2 text-xs text-(--t-text-secondary)">
                {t("settings.search.changedOnly")}
                <Toggle checked={changedOnly} onChange={setChangedOnly} aria-label={t("settings.search.changedOnly")} />
              </label>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg transition-colors text-(--t-text-muted)"
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
            >
              <Icon icon="lucide:x" width={15} />
            </button>
            </div>
          </div>

          {listMode ? (
            <div className="flex-1 overflow-y-auto"><SettingsList query={query} changedOnly={changedOnly} /></div>
          ) : activePluginPage ? (
            <div className="flex-1 overflow-y-auto p-6">
              <activePluginPage.component />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">{renderSettingsSection(section)}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
