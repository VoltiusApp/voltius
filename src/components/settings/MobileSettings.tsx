import { resolveLabel } from "@/plugins/resolveLabel";
import { useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { cursorStyleSetting, useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { getSettingsNav } from "@/components/settings/settingsNav";
import { renderSettingsSection } from "@/components/settings/settingsSections";
import { mobileSettingsNav, MOBILE_HIDDEN_SECTIONS, rowTapControl } from "@/components/settings/settingsMobileCore";
import { useUiLanguage } from "@/i18n";
import { usePluginNavChildren, useResolvedPluginPage } from "@/components/settings/usePluginNavChildren";
import { pickLayers, stackLayers, useLayerTransition, useOverlayTransition } from "@/hooks/pageTransition";
import { useBackPeekStore } from "@/hooks/predictiveBack";
import { useCollapsingHeader } from "@/components/mobile/useCollapsingHeader";
import { APPBAR_TONAL } from "@/components/mobile/MobileHeader";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { SettingsSearchField } from "@/components/settings/SettingsSearchField";
import { ResetAllButton, SettingsList } from "@/components/settings/SettingsList";
import { useChangedSettings } from "@/components/settings/useChangedSettings";

const ROOT_BODY = "root";
const CHANGED_BODY = "changed";
const NO_TITLE = { current: null };

/** Live one-line summaries for the root rows that have a current value worth showing. */
function useNavSummaries(): Partial<Record<string, string>> {
  const { t } = useTranslation();
  const themeName = useThemeStore((s) => s.getActiveTheme().name);
  const cursorStyle = cursorStyleSetting.use();
  const scrollback = useTerminalSettingsStore((s) => s.scrollbackLines);
  return {
    appearance: themeName,
    terminal: `${t(`settings.terminal.cursorStyle.${cursorStyle}`)} · ${t("settings.terminal.scrollback.option", { count: scrollback })}`,
  };
}

function ChangedRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const { count } = useChangedSettings();
  return (
    <button
      data-mobile-settings-nav="changed"
      onClick={onOpen}
      className="w-full flex items-center gap-4 pl-4 pr-3 min-h-[72px] py-2 text-left"
    >
      <Icon icon="lucide:list-restart" width={24} className="shrink-0 text-(--t-accent)" />
      <span className="flex-1 min-w-0 flex flex-col">
        <span data-mobile-settings-nav-label className="text-base text-(--t-text-primary) truncate">{t("settings.search.changed")}</span>
        <span className="text-sm text-(--t-text-dim) truncate">{t("settings.search.changedSub", { count })}</span>
      </span>
      <Icon icon="lucide:chevron-right" width={20} className="shrink-0 text-(--t-text-dim)" />
    </button>
  );
}

/**
 * Full-screen settings (Android). `open` drives its push / pop transition; it unmounts when closed.
 * One back pattern: a top app bar with ← on the list (closes settings, large title that folds
 * into the bar on scroll) and on every sub-page (back to the list); system Back does the same.
 */
export default function MobileSettings({ open = true }: { open?: boolean }) {
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const rawSubPage = useUIStore((s) => s.settingsSubPage);
  const setSubPage = useUIStore((s) => s.setSettingsSubPage);
  // Hardware back drives this via the store; hidden sections fall back to the list.
  const liveSubPage = rawSubPage && !MOBILE_HIDDEN_SECTIONS.has(rawSubPage) ? rawSubPage : null;
  const { t } = useTranslation();
  const locale = useUiLanguage();
  const nav = useMemo(() => mobileSettingsNav(getSettingsNav()), [locale]);
  const summaries = useNavSummaries();
  const pluginChildren = usePluginNavChildren();
  const liveActivePluginPage = useResolvedPluginPage();
  const pluginPageId = useUIStore((s) => s.settingsPluginPageId);
  const selectPluginPage = useUIStore((s) => s.selectPluginPage);
  const navExpanded = useUIStore((s) => s.pluginsNavExpanded);
  const setNavExpanded = useUIStore((s) => s.setPluginsNavExpanded);
  const showChildren = pluginChildren.length > 0 && (navExpanded || pluginPageId !== null);
  const query = useUIStore((s) => s.settingsQuery);
  const setQuery = useUIStore((s) => s.setSettingsQuery);
  const changedOnly = useUIStore((s) => s.settingsChangedOnly);
  const setChangedOnly = useUIStore((s) => s.setSettingsChangedOnly);
  const searching = query.trim() !== "";
  const changedView = changedOnly && !searching;
  useBackInterceptor(open && (searching || changedView), () => (changedView ? setChangedOnly(false) : setQuery("")));

  const { mounted, ref } = useOverlayTransition(open);
  // Closing resets the sub-page: keep showing what was on screen while the overlay slides out.
  const view = useRef({ subPage: liveSubPage, activePluginPage: liveActivePluginPage });
  if (open || !mounted) view.current = { subPage: liveSubPage, activePluginPage: liveActivePluginPage };
  const { subPage, activePluginPage } = view.current;
  const current = nav.find((n) => n.id === subPage);

  const bodyKey = activePluginPage ? `plugin:${pluginPageId}` : changedView ? CHANGED_BODY : (subPage ?? ROOT_BODY);
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
  ) : changedView ? <SettingsList query="" changedOnly /> : subPage ? renderSettingsSection(subPage) : null;
  if (bodyKey !== ROOT_BODY) bodyCache.current.set(bodyKey, currentBody);

  // Top app bar: the list's large title folds into it; a sub-page only turns it tonal on scroll.
  const appbarRef = useRef<HTMLDivElement>(null);
  const largeTitleRef = useRef<HTMLHeadingElement>(null);
  const rootScroll = useCollapsingHeader(appbarRef, largeTitleRef);
  const pageScroll = useCollapsingHeader(appbarRef, NO_TITLE);
  const onRoot = bodyKey === ROOT_BODY;
  useEffect(() => {
    const el = appbarRef.current;
    if (!el) return;
    el.style.setProperty("--vt-fold", "0");
    el.dataset.folded = "false";
    el.dataset.scrolled = "false";
  }, [bodyKey, mounted]);

  const goBack = () => (onRoot ? setOpen(false) : changedView ? setChangedOnly(false) : setSubPage(null));
  const title = activePluginPage
    ? resolveLabel(activePluginPage.label)
    : changedView ? t("settings.search.changedTitle") : current ? current.label : t("settings.chrome.title");

  // M3 rows act as one target: a tap on a row's text runs its switch / picker.
  const forwardRowTap = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    rowTapControl(e.target as Element)?.click();
  };

  const rootList = (
    <div className="pb-4">
      <h1 ref={largeTitleRef} data-mobile-large-title className="px-4 pt-1 pb-4 text-3xl font-medium text-(--t-text-primary)" style={{ opacity: "calc(1 - var(--vt-fold, 0) * 0.6)" }}>
        {t("settings.chrome.title")}
      </h1>
      <div className="px-4 pb-3">
        <SettingsSearchField variant="mobile" />
      </div>
      {searching ? <SettingsList query={query} changedOnly={false} /> : <>
      <ChangedRow onOpen={() => setChangedOnly(true)} />
      {nav.map((item) => {
        const isPlugins = item.id === "plugins";
        const hasGroup = isPlugins && pluginChildren.length > 0;
        const sub = summaries[item.id] ?? item.sub;

        return (
          <div key={item.id}>
            <div className="flex items-center">
              <button
                data-mobile-settings-nav={item.id}
                onClick={() => setSubPage(item.id)}
                className="flex-1 min-w-0 flex items-center gap-4 pl-4 pr-3 min-h-[72px] py-2 text-left"
              >
                <Icon icon={item.icon} width={24} className="shrink-0 text-(--t-accent)" />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span data-mobile-settings-nav-label className="text-base text-(--t-text-primary) truncate">{item.label}</span>
                  {sub && <span className="text-sm text-(--t-text-dim) truncate">{sub}</span>}
                </span>
                {!hasGroup && <Icon icon="lucide:chevron-right" width={20} className="shrink-0 text-(--t-text-dim)" />}
              </button>
              {hasGroup && (
                <button
                  onClick={() => setNavExpanded(!navExpanded)}
                  aria-expanded={showChildren}
                  aria-label={t(showChildren ? "settings.chrome.collapsePluginGroup" : "settings.chrome.expandPluginGroup")}
                  className="w-12 h-12 mr-2 shrink-0 rounded-full flex items-center justify-center text-(--t-text-dim)"
                >
                  <Icon icon={showChildren ? "lucide:chevron-up" : "lucide:chevron-down"} width={20} />
                </button>
              )}
            </div>

            {hasGroup && showChildren && pluginChildren.map((child) => (
              <button
                key={child.pageId}
                data-mobile-settings-plugin-page={child.pageId}
                onClick={() => selectPluginPage(child.pageId)}
                className="w-full flex items-center gap-4 pl-14 pr-3 min-h-14 py-2 text-left"
              >
                <Icon icon={child.icon} width={20} className="shrink-0 text-(--t-accent)" />
                <span data-mobile-settings-nav-label className="flex-1 min-w-0 text-base text-(--t-text-primary) truncate">{child.label}</span>
                <Icon icon="lucide:chevron-right" width={20} className="shrink-0 text-(--t-text-dim)" />
              </button>
            ))}
          </div>
        );
      })}
      </>}
    </div>
  );
  // Bodies other than the current one: the list, or a sub-page kept from when it was current.
  const renderBody = (key: string) =>
    key === ROOT_BODY ? rootList : (
      <div data-settings-page>{key === bodyKey ? currentBody : (bodyCache.current.get(key) ?? null)}</div>
    );

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
      <div ref={appbarRef} className="group/appbar flex-1 min-h-0 flex flex-col">
        {/* M3 small top app bar: navigation icon + title. */}
        <header data-mobile-appbar data-mobile-settings-appbar={onRoot ? "root" : "page"} className={`shrink-0 h-16 flex items-center gap-1 pl-1 pr-4 bg-(--t-bg-base) ${APPBAR_TONAL}`}>
          <button
            onClick={goBack}
            data-mobile-settings-back
            className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center text-(--t-text-primary)"
            aria-label={t("settings.chrome.back")}
          >
            <Icon icon="lucide:arrow-left" width={24} />
          </button>
          <span
            className="flex-1 min-w-0 truncate text-xl font-medium text-(--t-text-primary)"
            style={onRoot ? { opacity: "clamp(0, calc((var(--vt-fold, 0) - 0.5) * 2), 1)" } : undefined}
          >
            {title}
          </span>
          {changedView && <ResetAllButton />}
        </header>

        {/* Body: one layer per level (list, sub-page), so a sub-page slides over the list and back. */}
        <div ref={bodyRef} className="flex-1 relative overflow-hidden" onClick={forwardRowTap}>
          {bodies.map(({ item, index, role }) => (
            <div
              key={`${index}:${item}`}
              className="absolute inset-0 overflow-y-auto scrollbar-none bg-(--t-bg-base)"
              data-mobile-settings-layer={role}
              data-mobile-settings-body={role === "top" ? "" : undefined}
              onScroll={role === "top" ? (item === ROOT_BODY ? rootScroll.onScroll : pageScroll.onScroll) : undefined}
            >
              {renderBody(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
