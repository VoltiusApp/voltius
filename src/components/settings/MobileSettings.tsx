import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { getSettingsNav } from "@/components/settings/settingsNav";
import { renderSettingsSection } from "@/components/settings/settingsSections";
import { mobileSettingsNav, MOBILE_HIDDEN_SECTIONS } from "@/components/settings/settingsMobileCore";
import { useLocaleStore } from "@/stores/localeStore";
import { usePluginNavChildren, useResolvedPluginPage } from "@/components/settings/usePluginNavChildren";

export default function MobileSettings() {
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const rawSubPage = useUIStore((s) => s.settingsSubPage);
  const setSubPage = useUIStore((s) => s.setSettingsSubPage);
  // Hardware back drives this via the store; hidden sections fall back to the list.
  const subPage = rawSubPage && !MOBILE_HIDDEN_SECTIONS.has(rawSubPage) ? rawSubPage : null;
  const { t } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const nav = useMemo(() => mobileSettingsNav(getSettingsNav()), [locale]);
  const current = nav.find((n) => n.id === subPage);
  const pluginChildren = usePluginNavChildren();
  const activePluginPage = useResolvedPluginPage();
  const pluginPageId = useUIStore((s) => s.settingsPluginPageId);
  const selectPluginPage = useUIStore((s) => s.selectPluginPage);
  const navExpanded = useUIStore((s) => s.pluginsNavExpanded);
  const setNavExpanded = useUIStore((s) => s.setPluginsNavExpanded);
  const showChildren = pluginChildren.length > 0 && (navExpanded || pluginPageId !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col surface-modal-solid animate-fadeIn"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0 border-b border-b-(--t-border)">
        {subPage || activePluginPage ? (
          <button
            onClick={() => setSubPage(null)}
            className="p-1.5 -ml-1.5 rounded-lg text-(--t-text-muted) active:bg-(--t-bg-card-hover)"
            aria-label={t("settings.chrome.back")}
          >
            <Icon icon="lucide:arrow-left" width={18} />
          </button>
        ) : null}
        <span className="flex-1 text-base font-semibold text-(--t-text-bright)">
          {activePluginPage ? activePluginPage.label : current ? current.label : t("settings.chrome.title")}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="p-1.5 -mr-1.5 rounded-lg text-(--t-text-muted) active:bg-(--t-bg-card-hover)"
          aria-label={t("settings.chrome.close")}
        >
          <Icon icon="lucide:x" width={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {activePluginPage ? (
          <div className="p-6">
            <activePluginPage.component />
          </div>
        ) : subPage ? (
          renderSettingsSection(subPage)
        ) : (
          <div className="py-2">
            {nav.map((item) => {
              const isPlugins = item.id === "plugins";
              const hasGroup = isPlugins && pluginChildren.length > 0;

              return (
                <div key={item.id}>
                  <div className="flex items-center border-b border-b-(--t-border)">
                    <button
                      onClick={() => setSubPage(item.id)}
                      className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5 text-left active:bg-(--t-bg-card-hover)"
                    >
                      <Icon icon={item.icon} width={18} className="shrink-0 text-(--t-accent)" />
                      <span className="flex-1 text-sm text-(--t-text-primary)">{item.label}</span>
                      <Icon icon="lucide:chevron-right" width={16} className="shrink-0 text-(--t-text-dim)" />
                    </button>
                    {hasGroup && (
                      <button
                        onClick={() => setNavExpanded(!navExpanded)}
                        aria-expanded={showChildren}
                        aria-label={t(showChildren ? "settings.chrome.collapsePluginGroup" : "settings.chrome.expandPluginGroup")}
                        className="px-4 py-3.5 shrink-0 text-(--t-text-dim) active:bg-(--t-bg-card-hover)"
                      >
                        <Icon icon={showChildren ? "lucide:chevron-down" : "lucide:chevron-right"} width={16} />
                      </button>
                    )}
                  </div>

                  {hasGroup && showChildren && pluginChildren.map((child) => (
                    <button
                      key={child.pageId}
                      onClick={() => selectPluginPage(child.pageId)}
                      className="w-full flex items-center gap-3 pl-10 pr-4 py-3 text-left active:bg-(--t-bg-card-hover) border-b border-b-(--t-border)"
                    >
                      <Icon icon={child.icon} width={16} className="shrink-0 text-(--t-accent)" />
                      <span className="flex-1 text-sm text-(--t-text-primary)">{child.label}</span>
                      <Icon icon="lucide:chevron-right" width={16} className="shrink-0 text-(--t-text-dim)" />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
