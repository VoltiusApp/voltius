import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/themeStore";
import { usePluginStore } from "@/stores/pluginStore";
import { BUILT_IN_THEMES } from "@/themes/presets";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { DEFAULT_SCROLLBACK_LINES, MAX_SCROLLBACK_LINES, MIN_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import { sunTimes, type ThemeMode } from "@/services/themeAutomation";
import type { AppTheme } from "@/themes/types";
import ScaleSection from "./ScaleSection";
import { DirtyDot, ResetButton } from "./shared";
import { useLocaleStore, SUPPORTED_LOCALES } from "@/stores/localeStore";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTheme(theme: AppTheme) {
  downloadJson(
    `${theme.name.toLowerCase().replace(/\s+/g, "-")}.voltius-theme.json`,
    { type: "voltius-theme", version: 1, theme },
  );
}

const parse = (s: string) => (s.trim() === "" ? NaN : Number(s));

export default function AppearanceSection() {
  const {
    activeThemeId, customThemes, setTheme, deleteCustomTheme,
    mode, setMode, lightThemeId, setLightThemeId, darkThemeId, setDarkThemeId,
    scheduleLightStart, scheduleDarkStart, setSchedule, location, setLocation,
  } = useThemeStore();
  const [latText, setLatText] = useState(location ? String(location.lat) : "");
  const [lngText, setLngText] = useState(location ? String(location.lng) : "");
  useEffect(() => {
    if (!location) return;
    if (parse(latText) !== location.lat || parse(lngText) !== location.lng) {
      setLatText(String(location.lat));
      setLngText(String(location.lng));
    }
  }, [location?.lat, location?.lng]);
  const { openThemeCreator, openThemeImportExport } = useUIStore();
  const pluginThemeMap = usePluginStore((s) => s.pluginThemes);
  const [scrollMinimapEnabled, setScrollMinimapEnabled] = useToggle("scroll-minimap");
  const [selectToCopy, setSelectToCopy] = useToggle("select-to-copy");
  const [ignoreBracketedPaste, setIgnoreBracketedPaste] = useToggle("ignore-bracketed-paste");
  const scrollbackLines = useTerminalSettingsStore((s) => s.scrollbackLines);
  const setScrollbackLines = useTerminalSettingsStore((s) => s.setScrollbackLines);

  const { t } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const pluginThemes: AppTheme[] = [...pluginThemeMap.values()].map((theme) => ({ ...theme, builtIn: true }));
  const allThemes = [...BUILT_IN_THEMES, ...customThemes, ...pluginThemes];
  const scrollbackOptions = [1_000, 10_000, 50_000, 100_000, 250_000]
    .filter((value) => value >= MIN_SCROLLBACK_LINES && value <= MAX_SCROLLBACK_LINES)
    .map((value) => ({ value: String(value), label: t("settings.appearance.scrollback.option", { count: value }) }));

  const handleDelete = (id: string) => {
    deleteCustomTheme(id);
    if (activeThemeId === id) setTheme("abyss");
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
          {t("settings.appearance.interface")}
        </h3>
        <ScaleSection />
        <div className="group mt-4 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.appearance.language.title")}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <FormSelect
              className="w-44 shrink-0"
              value={locale}
              options={SUPPORTED_LOCALES}
              onChange={(value) => setLocale(value as typeof locale)}
            />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.appearance.scrollback.title")}</div>
            <div className="text-xs mt-1 text-(--t-text-dim)">
              {t("settings.appearance.scrollback.desc")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scrollbackLines !== DEFAULT_SCROLLBACK_LINES && (
              <ResetButton onReset={() => setScrollbackLines(DEFAULT_SCROLLBACK_LINES)} />
            )}
            {scrollbackLines !== DEFAULT_SCROLLBACK_LINES && <DirtyDot />}
            <FormSelect
              className="w-44 shrink-0"
              value={String(scrollbackLines)}
              options={scrollbackOptions}
              onChange={(value) => setScrollbackLines(Number(value))}
            />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.appearance.minimap.title")}</div>
            <div className="text-xs mt-1 text-(--t-text-dim)">
              {t("settings.appearance.minimap.desc")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scrollMinimapEnabled !== TOGGLE_DEFS["scroll-minimap"].default && (
              <ResetButton onReset={() => setScrollMinimapEnabled(TOGGLE_DEFS["scroll-minimap"].default)} />
            )}
            {scrollMinimapEnabled !== TOGGLE_DEFS["scroll-minimap"].default && <DirtyDot />}
            <Toggle checked={scrollMinimapEnabled} onChange={setScrollMinimapEnabled} />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.appearance.selectToCopy.title")}</div>
            <div className="text-xs mt-1 text-(--t-text-dim)">
              {t("settings.appearance.selectToCopy.desc")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {selectToCopy !== TOGGLE_DEFS["select-to-copy"].default && (
              <ResetButton onReset={() => setSelectToCopy(TOGGLE_DEFS["select-to-copy"].default)} />
            )}
            {selectToCopy !== TOGGLE_DEFS["select-to-copy"].default && <DirtyDot />}
            <Toggle checked={selectToCopy} onChange={setSelectToCopy} />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--t-text-primary)">{t("settings.appearance.ignoreBracketedPaste.title")}</div>
            <div className="text-xs mt-1 text-(--t-text-dim)">
              {t("settings.appearance.ignoreBracketedPaste.desc")}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ignoreBracketedPaste !== TOGGLE_DEFS["ignore-bracketed-paste"].default && (
              <ResetButton onReset={() => setIgnoreBracketedPaste(TOGGLE_DEFS["ignore-bracketed-paste"].default)} />
            )}
            {ignoreBracketedPaste !== TOGGLE_DEFS["ignore-bracketed-paste"].default && <DirtyDot />}
            <Toggle checked={ignoreBracketedPaste} onChange={setIgnoreBracketedPaste} />
          </div>
        </div>
      </div>

      {(() => {
        const themeOptions = allThemes.map((th) => ({ value: th.id, label: th.name }));
        const modeOptions: { value: ThemeMode; label: string }[] = [
          { value: "manual", label: t("settings.appearance.automation.modeManual") },
          { value: "system", label: t("settings.appearance.automation.modeSystem") },
          { value: "schedule", label: t("settings.appearance.automation.modeSchedule") },
          { value: "sunset", label: t("settings.appearance.automation.modeSunset") },
        ];
        const sun = location ? sunTimes(new Date(), location.lat, location.lng) : null;
        const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const useMyLocation = () => {
          if (typeof navigator === "undefined" || !navigator.geolocation) return;
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: t("settings.appearance.automation.useMyLocation"), source: "geo" });
              setLatText(String(pos.coords.latitude));
              setLngText(String(pos.coords.longitude));
            },
            () => {},
            { enableHighAccuracy: false, timeout: 10000 },
          );
        };
        return (
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-(--t-text-dim)">
              {t("settings.appearance.automation.title")}
            </h3>
            <div className="rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 space-y-4">
              <p className="text-xs text-(--t-text-dim)">{t("settings.appearance.automation.desc")}</p>

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
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={useMyLocation} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-(--t-bg-elevated) hover:bg-(--t-bg-input-hover) text-(--t-text-primary)">
                      <Icon icon="lucide:map-pin" width={12} /> {t("settings.appearance.automation.useMyLocation")}
                    </button>
                    <input type="number" step="0.0001" placeholder={t("settings.appearance.automation.latitude")} value={latText} onChange={(e) => {
                      setLatText(e.target.value);
                      const lat = parse(e.target.value);
                      const lng = parse(lngText);
                      if (Number.isFinite(lat) && Number.isFinite(lng)) setLocation({ lat, lng, label: "manual", source: "manual" });
                    }} className="w-28 px-2 py-1 rounded-md text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) outline-none" />
                    <input type="number" step="0.0001" placeholder={t("settings.appearance.automation.longitude")} value={lngText} onChange={(e) => {
                      setLngText(e.target.value);
                      const lng = parse(e.target.value);
                      const lat = parse(latText);
                      if (Number.isFinite(lat) && Number.isFinite(lng)) setLocation({ lat, lng, label: "manual", source: "manual" });
                    }} className="w-28 px-2 py-1 rounded-md text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) outline-none" />
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors text-(--t-text-muted) hover:text-(--t-text-primary) bg-(--t-bg-card) hover:bg-(--t-bg-elevated)"
              title={t("settings.appearance.importTitle")}
            >
              <Icon icon="lucide:download" width={12} />
              {t("settings.appearance.import")}
            </button>
            {customThemes.length > 0 && (
              <button
                onClick={() => openThemeImportExport("export")}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors text-(--t-text-muted) hover:text-(--t-text-primary) bg-(--t-bg-card) hover:bg-(--t-bg-elevated)"
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
            return (
              <button
                key={theme.id}
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
                <div className="flex gap-1.5">
                  {[theme.ui.bgTerminal, theme.ui.accent, theme.ui.tabActiveText, theme.ui.statusConnected].map((color, i) => (
                    <span key={i} className="w-5 h-5 rounded-md shrink-0" style={{ background: color, border: "1px solid rgba(255,255,255,0.08)" }} />
                  ))}
                </div>
                <span className="text-xs font-medium leading-tight" style={{ color: isActive ? "var(--t-text-bright)" : "var(--t-text-primary)" }}>
                  {theme.name}
                </span>
                {!theme.builtIn && (
                  <div className="absolute bottom-2 right-2 flex gap-1">
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
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(theme.id); }}
                      className="p-1 rounded-sm opacity-0 group-hover:opacity-50 hover:opacity-100! transition-opacity text-(--t-status-error)"
                      title={t("settings.appearance.deleteTheme")}
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
      </div>
    </div>
  );
}
