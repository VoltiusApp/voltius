import { resolveLabel } from "@/plugins/resolveLabel";
import { useMemo, useRef, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { getSettingsNav } from "@/components/settings/settingsNav";
import { renderSettingsSection } from "@/components/settings/settingsSections";
import { mobileSettingsNav, MOBILE_HIDDEN_SECTIONS } from "@/components/settings/settingsMobileCore";
import { useUiLanguage } from "@/i18n";
import { usePluginNavChildren, useResolvedPluginPage } from "@/components/settings/usePluginNavChildren";
import { pickLayers, stackLayers, useLayerTransition, useOverlayTransition } from "@/hooks/pageTransition";
import { useBackPeekStore } from "@/hooks/predictiveBack";

const ROOT_BODY = "root";

/** Full-screen settings (Android). `open` drives its push / pop transition; it unmounts when closed. */
export default function MobileSettings({ open = true }: { open?: boolean }) {
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const rawSubPage = useUIStore((s) => s.settingsSubPage);
  const setSubPage = useUIStore((s) => s.setSettingsSubPage);
  // Hardware back drives this via the store; hidden sections fall back to the list.
  const liveSubPage = rawSubPage && !MOBILE_HIDDEN_SECTIONS.has(rawSubPage) ? rawSubPage : null;
  const { t } = useTranslation();
  const locale = useUiLanguage();
  const nav = useMemo(() => mobileSettingsNav(getSettingsNav()), [locale]);
  const pluginChildren = usePluginNavChildren();
  const liveActivePluginPage = useResolvedPluginPage();
  const pluginPageId = useUIStore((s) => s.settingsPluginPageId);
  const selectPluginPage = useUIStore((s) => s.selectPluginPage);
  const navExpanded = useUIStore((s) => s.pluginsNavExpanded);
  const setNavExpanded = useUIStore((s) => s.setPluginsNavExpanded);
  const showChildren = pluginChildren.length > 0 && (navExpanded || pluginPageId !== null);

  const { mounted, ref } = useOverlayTransition(open);
  // Closing resets the sub-page: keep showing what was on screen while the overlay slides out.
  const view = useRef({ subPage: liveSubPage, activePluginPage: liveActivePluginPage });
  if (open || !mounted) view.current = { subPage: liveSubPage, activePluginPage: liveActivePluginPage };
  const { subPage, activePluginPage } = view.current;
  const current = nav.find((n) => n.id === subPage);

  const bodyKey = activePluginPage ? `plugin:${pluginPageId}` : (subPage ?? ROOT_BODY);
  const bodyStack = useMemo(() => (bodyKey === ROOT_BODY ? [ROOT_BODY] : [ROOT_BODY, bodyKey]), [bodyKey]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyTransition = useLayerTransition(bodyStack, bodyStack.length, (t) =>
    pickLayers(t.dir, (role) => bodyRef.current?.querySelector<HTMLElement>(`[data-mobile-settings-layer="${role}"]`), () => null));
  // A predictive back from a sub-page reveals the list under it.
  const peek = useBackPeekStore((s) => s.peek === "settings");
  const bodies = stackLayers(bodyStack, bodyTransition, peek);
  const bodyCache = useRef(new Map<string, ReactNode>());
  const currentBody = activePluginPage ? (
    <div className="p-6">
      <activePluginPage.component />
    </div>
  ) : subPage ? renderSettingsSection(subPage) : null;
  if (bodyKey !== ROOT_BODY) bodyCache.current.set(bodyKey, currentBody);

  const rootList = (
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
  );
  // Bodies other than the current one: the list, or a sub-page kept from when it was current.
  const renderBody = (key: string) =>
    key === ROOT_BODY ? rootList : key === bodyKey ? currentBody : (bodyCache.current.get(key) ?? null);

  if (!mounted) return null;
  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex flex-col surface-modal-solid"
      data-mobile-settings
      style={{
        paddingTop: "var(--vt-safe-top)",
        paddingBottom: "var(--vt-safe-bottom)",
        paddingLeft: "var(--vt-safe-left)",
        paddingRight: "var(--vt-safe-right)",
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
          {activePluginPage ? resolveLabel(activePluginPage.label) : current ? current.label : t("settings.chrome.title")}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="p-1.5 -mr-1.5 rounded-lg text-(--t-text-muted) active:bg-(--t-bg-card-hover)"
          aria-label={t("settings.chrome.close")}
        >
          <Icon icon="lucide:x" width={18} />
        </button>
      </div>

      {/* Body: one layer per level (list, sub-page), so a sub-page slides over the list and back. */}
      <div ref={bodyRef} className="flex-1 relative overflow-hidden">
        {bodies.map(({ item, index, role }) => (
          <div
            key={`${index}:${item}`}
            className="absolute inset-0 overflow-y-auto bg-(--t-bg-base)"
            data-mobile-settings-layer={role}
            data-mobile-settings-body={role === "top" ? "" : undefined}
          >
            {renderBody(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
