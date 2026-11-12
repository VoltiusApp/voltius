import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/themeStore";
import { useInstalledThemes } from "@/hooks/useInstalledThemes";
import { useMarketplaceThemes, type ThemeRemoval } from "@/hooks/useMarketplaceThemes";
import { openMarketplaceThemes, paletteOf } from "@/themes/marketplaceThemes";
import {
  BrowseMarketplaceThemesButton, MarketplaceSourceBadge, MarketplaceThemeStatus, ThemeCardSwatches,
} from "@/components/shared/ThemeParts";
import { useUIStore } from "@/stores/uiStore";
import { FormSelect } from "@/components/shared/FormSelect";
import { sunTimes, type ThemeMode } from "@/services/themeAutomation";
import type { AppTheme } from "@/themes/types";
import ScaleSection from "./ScaleSection";
import TerminalFontSizeSection from "./TerminalFontSizeSection";
import { localeSetting, useLocaleStore, SUPPORTED_LOCALES, type Locale } from "@/stores/localeStore";
import { ManagedWhen, useRangeSelect } from "@/components/shared/ManagedNote";
import { useLocationFields } from "@/hooks/useLocationFields";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { SETTINGS_SURFACE, SettingRow, SyncKeyButton } from "./shared";
import { saveTextFile } from "@/services/saveFile";
import { formatTime, HOUR_MINUTE } from "@/utils/localeFormat";
import { useIsMobile } from "@/utils/platform";
import { MOBILE_HIDDEN_TOGGLES } from "@/components/settings/settingsMobileCore";
import BottomSheet from "@/components/mobile/sheets/BottomSheet";
import { SheetActionRow } from "@/components/mobile/sheets/SheetActionRow";
import { DYNAMIC_THEME_ID } from "@/themes/dynamic";

function exportTheme(theme: AppTheme) {
  void saveTextFile(
    `${theme.name.toLowerCase().replace(/\s+/g, "-")}.voltius-theme.json`,
    JSON.stringify({ type: "voltius-theme", version: 1, theme }, null, 2),
  );
}

const LOCALE_VALUES = SUPPORTED_LOCALES.map((l) => l.value);
const localeLabel = (v: Locale) => SUPPORTED_LOCALES.find((l) => l.value === v)?.label ?? v;

export default function AppearanceSection() {
  const {
    activeThemeId, customThemes, setTheme,
    mode, setMode, lightThemeId, setLightThemeId, darkThemeId, setDarkThemeId,
    scheduleLightStart, scheduleDarkStart, setSchedule,
  } = useThemeStore();
  const loc = useLocationFields();
  const { openThemeCreator, openThemeImportExport } = useUIStore();

  const { t } = useTranslation();
  const locale = localeSetting.use();
  const setLocale = useLocaleStore((s) => s.setLocale);
  const localeSelect = useRangeSelect(localeSetting.key, LOCALE_VALUES, localeLabel);
  const [groupTabsByHost, setGroupTabsByHost] = useToggle("group-tabs-by-host");
  const isMobile = useIsMobile();
  // Android: a custom theme's export / edit / delete live in a sheet (no hover there).
  const [themeMenu, setThemeMenu] = useState<AppTheme | null>(null);

  const allThemes = useInstalledThemes();

  const marketplace = useMarketplaceThemes();
  const menuRemoval = themeMenu ? marketplace.removal(themeMenu) : null;
  const removalLabel = (removal: ThemeRemoval) =>
    removal.kind === "uninstall" ? t("settings.appearance.marketplace.remove") : t("settings.appearance.deleteTheme");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
          {t("settings.appearance.interface")}
        </h3>
        <ScaleSection />
        <div className="mt-4">
          <TerminalFontSizeSection />
        </div>
        <SettingRow variant="card" className="mt-4" syncKey={localeSetting.key} title={t("settings.appearance.language.title")} note={localeSelect.note}>
          <FormSelect
            className="w-44 shrink-0"
            value={locale}
            options={localeSelect.options}
            onChange={(value) => setLocale(value as Locale)}
          />
        </SettingRow>
        {!(isMobile && MOBILE_HIDDEN_TOGGLES.has("group-tabs-by-host")) && <SettingRow
          variant="card"
          className="mt-4"
          syncKey="appSettings.toggles.group-tabs-by-host"
          title={t("settings.appearance.groupTabsByHost.title")}
          desc={t("settings.appearance.groupTabsByHost.desc")}
          dirty={groupTabsByHost !== TOGGLE_DEFS["group-tabs-by-host"].default}
          onReset={() => setGroupTabsByHost(TOGGLE_DEFS["group-tabs-by-host"].default)}
        >
          <Toggle checked={groupTabsByHost} onChange={setGroupTabsByHost} />
        </SettingRow>}
      </div>

      {(() => {
        const themeOptions = allThemes.map((th) => ({ value: th.id, label: th.name }));
        const modeOptions: { value: ThemeMode; label: string }[] = [
          { value: "manual", label: t("settings.appearance.automation.modeManual") },
          { value: "system", label: t("settings.appearance.automation.modeSystem") },
          { value: "schedule", label: t("settings.appearance.automation.modeSchedule") },
          { value: "sunset", label: t("settings.appearance.automation.modeSunset") },
        ];
        const sun = loc.location ? sunTimes(new Date(), loc.location.lat, loc.location.lng) : null;
        const fmt = (d: Date) => formatTime(d, HOUR_MINUTE);
        return (
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
              {t("settings.appearance.automation.title")}
            </h3>
            <div data-settings-card className={`${SETTINGS_SURFACE} p-4 space-y-4`}>
              <p className="text-xs text-(--t-text-dim)">{t("settings.appearance.automation.desc")}</p>

              {isMobile ? (
                // M3 rows, the value trailing; each opens its picker sheet.
                <>
                  <SettingRow title={t("settings.appearance.automation.mode")}>
                    <FormSelect value={mode} options={modeOptions} onChange={(v) => setMode(v as ThemeMode)} />
                  </SettingRow>
                  <SettingRow title={t("settings.appearance.automation.lightTheme")}>
                    <FormSelect value={lightThemeId} options={themeOptions} onChange={setLightThemeId} />
                  </SettingRow>
                  <SettingRow title={t("settings.appearance.automation.darkTheme")}>
                    <FormSelect value={darkThemeId} options={themeOptions} onChange={setDarkThemeId} />
                  </SettingRow>
                </>
              ) : (<>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-(--t-text-dim)">
                  {t("settings.appearance.automation.lightTheme")}
                  <FormSelect value={lightThemeId} options={themeOptions} onChange={setLightThemeId} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-(--t-text-dim)">
                  {t("settings.appearance.automation.darkTheme")}
                  <FormSelect value={darkThemeId} options={themeOptions} onChange={setDarkThemeId} />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-xs text-(--t-text-dim)">
                {t("settings.appearance.automation.mode")}
                <FormSelect value={mode} options={modeOptions} onChange={(v) => setMode(v as ThemeMode)} />
              </label>
              </>)}

              {mode === "schedule" && (
                <div className="flex items-center gap-4">
                  <label className="flex flex-col gap-1 text-xs text-(--t-text-dim)">
                    {t("settings.appearance.automation.lightStarts")}
                    <input type="time" value={scheduleLightStart} onChange={(e) => setSchedule(e.target.value, scheduleDarkStart)} className="px-2 py-1 rounded-md text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) outline-none" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-(--t-text-dim)">
                    {t("settings.appearance.automation.darkStarts")}
                    <input type="time" value={scheduleDarkStart} onChange={(e) => setSchedule(scheduleLightStart, e.target.value)} className="px-2 py-1 rounded-md text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) outline-none" />
                  </label>
                </div>
              )}

              {mode === "sunset" && (
                // `group` so SyncKeyButton's hover-reveal has an ancestor to
                // hover: without it the control is unreachable once opted in.
                <div className="group flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!loc.locked && (
                      <button onClick={() => loc.locateMe(t("settings.appearance.automation.useMyLocation"))} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-(--t-bg-input) border border-(--t-border) hover:bg-(--t-bg-input-hover) text-(--t-text-primary)">
                        <Icon icon="lucide:map-pin" width={12} /> {t("settings.appearance.automation.useMyLocation")}
                      </button>
                    )}
                    <ManagedWhen locked={loc.locked}>
                      <input type="number" step="0.0001" placeholder={t("settings.appearance.automation.latitude")} value={loc.latText} onChange={(e) => loc.setLat(e.target.value)} className="w-28 px-2 py-1 rounded-md text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) outline-none" />
                      <input type="number" step="0.0001" placeholder={t("settings.appearance.automation.longitude")} value={loc.lngText} onChange={(e) => loc.setLng(e.target.value)} className="w-28 px-2 py-1 rounded-md text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) outline-none" />
                    </ManagedWhen>
                    {!loc.locked && <SyncKeyButton path="themes.location" />}
                  </div>
                  <span className="text-xs text-(--t-text-dim)">
                    {sun ? t("settings.appearance.automation.sunToday", { sunrise: fmt(sun.sunrise), sunset: fmt(sun.sunset) }) : t("settings.appearance.automation.locationNeeded")}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
            {t("settings.appearance.colorTheme")}
          </h3>
          <div className="flex gap-1">
            <button
              onClick={() => openThemeImportExport("import")}
              className="vt-hit flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors text-(--t-text-muted) hover:text-(--t-text-primary) bg-(--t-bg-card) hover:bg-(--t-bg-elevated)"
              title={t("settings.appearance.importTitle")}
            >
              <Icon icon="lucide:download" width={12} />
              {t("settings.appearance.import")}
            </button>
            {customThemes.length > 0 && (
              <button
                onClick={() => openThemeImportExport("export")}
                className="vt-hit flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors text-(--t-text-muted) hover:text-(--t-text-primary) bg-(--t-bg-card) hover:bg-(--t-bg-elevated)"
                title={t("settings.appearance.exportAllTitle")}
              >
                <Icon icon="lucide:upload" width={12} />
                {t("settings.appearance.exportAll")}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          {allThemes.map((theme) => {
            const isActive = theme.id === activeThemeId;
            const removal = marketplace.removal(theme);
            return (
              <button
                key={theme.id}
                data-theme-card={theme.id}
                onClick={() => setTheme(theme.id)}
                className="group relative flex flex-col gap-2.5 p-3 rounded-xl text-left transition-all"
                style={{
                  background: isActive ? "var(--t-bg-elevated)" : "var(--t-bg-card)",
                  border: `1.5px solid ${isActive ? "var(--t-accent)" : "var(--t-border)"}`,
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border-hover)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)"; }}
              >
                {isActive && (
                  <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center bg-(--t-accent)">
                    <Icon icon="lucide:check" width={9} className="text-white" />
                  </span>
                )}
                <ThemeCardSwatches colors={paletteOf(theme).ui} />
                <span className="text-xs font-medium leading-tight" style={{ color: isActive ? "var(--t-text-bright)" : "var(--t-text-primary)" }}>
                  {theme.name}
                </span>
                {theme.id === DYNAMIC_THEME_ID && (
                  <span data-theme-dynamic className="-mt-2 text-[11px] leading-tight text-(--t-text-dim)">
                    {t("settings.appearance.dynamicThemeHint")}
                  </span>
                )}
                {removal && isMobile && (
                  <span
                    role="button"
                    tabIndex={0}
                    data-theme-actions={theme.id}
                    aria-label={`${t("settings.appearance.themeActions")}: ${theme.name}`}
                    aria-haspopup="menu"
                    onClick={(e) => { e.stopPropagation(); setThemeMenu(theme); }}
                    className="absolute bottom-0.5 right-0.5 w-10 h-10 rounded-full flex items-center justify-center text-(--t-text-muted)"
                  >
                    <Icon icon="lucide:ellipsis-vertical" width={18} />
                  </span>
                )}
                {removal && !isMobile && (
                  <div className="absolute bottom-2 right-2 flex gap-1">
                    {!theme.builtIn && (
                      <>
                      <button
                        onClick={(e) => { e.stopPropagation(); exportTheme(theme); }}
                        className="p-1 rounded-sm opacity-0 group-hover:opacity-50 hover:opacity-100! transition-opacity text-(--t-text-muted)"
                        title={t("settings.appearance.exportTheme")}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
                      >
                        <Icon icon="lucide:share" width={11} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openThemeCreator(theme.id); }}
                        className="p-1 rounded-sm opacity-0 group-hover:opacity-50 hover:opacity-100! transition-opacity text-(--t-text-muted)"
                        title={t("settings.appearance.editTheme")}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
                      >
                        <Icon icon="lucide:pencil" width={11} />
                      </button>
                      </>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); removal.remove(); }}
                      disabled={removal.disabledReason !== null}
                      className="p-1 rounded-sm opacity-0 group-hover:opacity-50 hover:opacity-100! disabled:opacity-0 disabled:group-hover:opacity-30! disabled:cursor-not-allowed transition-opacity text-(--t-status-error)"
                      title={removal.disabledReason ?? removalLabel(removal)}
                    >
                      <Icon icon="lucide:trash-2" width={11} />
                    </button>
                  </div>
                )}
              </button>
            );
          })}

          <button
            onClick={() => openThemeCreator()}
            className="flex flex-col gap-2.5 p-3 rounded-xl text-left transition-all text-(--t-text-muted)"
            style={{ background: "var(--t-bg-card)", border: "1.5px dashed var(--t-border)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
          >
            <div className="h-5 flex items-center">
              <Icon icon="lucide:plus" width={14} />
            </div>
            <span className="text-xs font-medium leading-tight">{t("settings.appearance.newCustomTheme")}</span>
          </button>
        </div>

        <div className="flex items-center justify-between mt-6 mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
            {t("settings.appearance.marketplace.available")}
          </h3>
          <BrowseMarketplaceThemesButton onClick={openMarketplaceThemes} className="vt-hit" />
        </div>
        {marketplace.available.length > 0 && (
          <div className="grid gap-2.5 mb-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
            {marketplace.available.map((item) => {
              const busy = marketplace.busy.has(item.entry.id);
              const disabled = item.disabledReason !== null;
              return (
                <button
                  key={item.entry.id}
                  data-theme-available={item.entry.id}
                  aria-disabled={disabled || busy}
                  title={item.disabledReason ?? undefined}
                  onClick={() => { if (!disabled) marketplace.get(item); }}
                  className="flex flex-col gap-2.5 p-3 rounded-xl text-left transition-all bg-(--t-bg-card) border-[1.5px] border-(--t-border) enabled:hover:border-(--t-border-hover) aria-disabled:cursor-not-allowed"
                >
                  <div className={disabled ? "opacity-40" : undefined}>
                    <ThemeCardSwatches colors={item.preview?.ui ?? null} />
                  </div>
                  <span className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs font-medium leading-tight truncate text-(--t-text-primary)">{item.entry.name}</span>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 bg-(--t-accent) text-(--t-bg-base) ${disabled ? "opacity-40" : ""}`}
                      >
                        <Icon icon={busy ? "lucide:loader" : "lucide:download"} width={11} className={busy ? "animate-spin" : undefined} />
                        {t("settings.appearance.marketplace.get")}
                      </span>
                      <MarketplaceSourceBadge sourceName={item.sourceName} />
                    </span>
                    {item.disabledReason && <span className="text-[11px] leading-tight text-(--t-text-dim)">{item.disabledReason}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <MarketplaceThemeStatus loading={marketplace.loading} unreachableCount={marketplace.unreachableCount} />
        {marketplace.modal}
      </div>

      {menuRemoval && themeMenu && (
        <BottomSheet title={themeMenu.name} onClose={() => setThemeMenu(null)}>
          {[
            ...(themeMenu.builtIn ? [] : [
              { icon: "lucide:share", label: t("settings.appearance.exportTheme"), slug: "export", onTap: () => exportTheme(themeMenu) },
              { icon: "lucide:pencil", label: t("settings.appearance.editTheme"), slug: "edit", onTap: () => openThemeCreator(themeMenu.id) },
            ]),
            {
              icon: "lucide:trash-2", label: removalLabel(menuRemoval), slug: "delete", danger: true,
              disabledReason: menuRemoval.disabledReason ?? undefined, onTap: menuRemoval.remove,
            },
          ].map((it) => (
            <SheetActionRow key={it.slug} attr="theme-action" it={{ ...it, onTap: () => { setThemeMenu(null); it.onTap(); } }} />
          ))}
        </BottomSheet>
      )}
    </div>
  );
}
