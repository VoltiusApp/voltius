import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { Modal } from "@/components/shared/Modal";
import { getSettingsNav } from "@/components/settings/settingsNav";
import { renderSettingsSection } from "@/components/settings/settingsSections";
import { useIsAndroid } from "@/utils/platform";
import { useLocaleStore } from "@/stores/localeStore";
import MobileSettings from "@/components/settings/MobileSettings";
import { usePluginNavChildren, useResolvedPluginPage } from "@/components/settings/usePluginNavChildren";

export default function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const section = useUIStore((s) => s.settingsSection);
  const setSection = useUIStore((s) => s.setSettingsSection);
  const isAndroid = useIsAndroid();
  const { t } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const nav = useMemo(() => getSettingsNav(), [locale]);
  const pluginChildren = usePluginNavChildren();
  const activePluginPage = useResolvedPluginPage();
  const pluginPageId = useUIStore((s) => s.settingsPluginPageId);
  const selectPluginPage = useUIStore((s) => s.selectPluginPage);
  const navExpanded = useUIStore((s) => s.pluginsNavExpanded);
  const setNavExpanded = useUIStore((s) => s.setPluginsNavExpanded);
  // A selected child force-expands, or the highlighted row would be invisible.
  const showChildren = pluginChildren.length > 0 && (navExpanded || pluginPageId !== null);

  if (!open) return null;
  if (isAndroid) return <MobileSettings />;

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
          style={{ width: "13.333rem" }}
        >
          <div className="px-5 mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
              {t("settings.chrome.title")}
            </span>
          </div>

          <div className="flex-1 px-2 space-y-0.5 overflow-y-auto">
            {nav.map((item) => {
              const isPlugins = item.id === "plugins";
              const active = section === item.id && (!isPlugins || pluginPageId === null);
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
                  style={{
                    background: active ? "var(--t-bg-input)" : "transparent",
                    color: active ? "var(--t-text-bright)" : "var(--t-text-secondary)",
                    fontWeight: active ? 500 : 400,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon icon={item.icon} width={15} className="shrink-0" style={{ color: active ? "var(--t-accent)" : "inherit" }} />
                  {item.label}
                </button>
              );

              return (
                <div key={item.id}>
                  <div className="flex items-center">
                    {hasGroup && (
                      <button
                        onClick={() => setNavExpanded(!navExpanded)}
                        aria-expanded={showChildren}
                        aria-label={t(showChildren ? "settings.chrome.collapsePluginGroup" : "settings.chrome.expandPluginGroup")}
                        className="p-1 rounded-md shrink-0 text-(--t-text-dim) transition-colors"
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; }}
                      >
                        <Icon icon={showChildren ? "lucide:chevron-down" : "lucide:chevron-right"} width={13} />
                      </button>
                    )}
                    {rowButton}
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
                            <span className="truncate">{child.label}</span>
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
            <span className="text-xs text-(--t-text-dim)">{t("settings.chrome.openHint")}</span>
          </div>
        </nav>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4 shrink-0 border-b border-b-(--t-border)"
          >
            <span className="text-sm font-semibold text-(--t-text-bright)">
              {activePluginPage ? activePluginPage.label : nav.find((n) => n.id === section)?.label}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg transition-colors text-(--t-text-muted)"
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
            >
              <Icon icon="lucide:x" width={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {activePluginPage ? <activePluginPage.component /> : renderSettingsSection(section)}
          </div>
        </div>
      </div>
    </Modal>
  );
}
