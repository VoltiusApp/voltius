import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useThemeStore } from "@/stores/themeStore";
import { sunTimes, type ThemeMode } from "@/services/themeAutomation";

const MODES: { id: ThemeMode; icon: string; labelKey: string; descKey: string }[] = [
  { id: "manual", icon: "lucide:hand", labelKey: "omni.theme.modeManual", descKey: "omni.theme.modeManualDesc" },
  { id: "system", icon: "lucide:monitor", labelKey: "omni.theme.modeSystem", descKey: "omni.theme.modeSystemDesc" },
  { id: "schedule", icon: "lucide:clock", labelKey: "omni.theme.modeSchedule", descKey: "omni.theme.modeScheduleDesc" },
  { id: "sunset", icon: "lucide:sunrise", labelKey: "omni.theme.modeSunset", descKey: "omni.theme.modeSunsetDesc" },
];

export default function OmniThemeAutomation({ onBack, onClose: _onClose }: { onBack: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { mode, setMode, scheduleLightStart, scheduleDarkStart, setSchedule, location, setLocation } = useThemeStore();
  const [geoBusy, setGeoBusy] = useState(false);
  const [latText, setLatText] = useState(location ? String(location.lat) : "");
  const [lngText, setLngText] = useState(location ? String(location.lng) : "");

  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: t("omni.theme.useMyLocation"), source: "geo" });
        setLatText(String(pos.coords.latitude));
        setLngText(String(pos.coords.longitude));
        setGeoBusy(false);
      },
      () => setGeoBusy(false),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const sun = location ? sunTimes(new Date(), location.lat, location.lng) : null;
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const parse = (s: string) => (s.trim() === "" ? NaN : Number(s));

  const inputCls = "w-24 px-2 py-1 rounded-md text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) outline-none";

  return (
    <div className="overflow-y-auto py-2" style={{ maxHeight: "420px" }}>
      <button onClick={onBack} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-(--t-text-muted) hover:text-(--t-text-primary)">
        <Icon icon="lucide:arrow-left" width={14} />
        {t("omni.theme.backAutomation")}
      </button>

      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <div key={m.id}>
            <button
              onClick={() => setMode(m.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
              style={{ background: active ? "var(--t-border-hover)" : "transparent" }}
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-(--t-bg-toolbar)">
                <Icon icon={m.icon} width={14} className="text-(--t-text-muted)" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium" style={{ color: active ? "var(--t-accent)" : "var(--t-text-primary)" }}>{t(m.labelKey)}</span>
                <p className="text-xs mt-0.5 text-(--t-text-dim)">{t(m.descKey)}</p>
              </div>
              <span className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center" style={{ border: `1.5px solid ${active ? "var(--t-accent)" : "var(--t-border)"}` }}>
                {active && <span className="w-2 h-2 rounded-full bg-(--t-accent)" />}
              </span>
            </button>

            {/* Inline config reveals */}
            {active && m.id === "schedule" && (
              <div className="px-4 pb-3 pl-14 flex items-center gap-4 text-xs text-(--t-text-dim)">
                <label className="flex items-center gap-2">{t("omni.theme.lightStarts")}
                  <input type="time" value={scheduleLightStart} onChange={(e) => setSchedule(e.target.value, scheduleDarkStart)} className={inputCls} />
                </label>
                <label className="flex items-center gap-2">{t("omni.theme.darkStarts")}
                  <input type="time" value={scheduleDarkStart} onChange={(e) => setSchedule(scheduleLightStart, e.target.value)} className={inputCls} />
                </label>
              </div>
            )}

            {active && m.id === "sunset" && (
              <div className="px-4 pb-3 pl-14 flex flex-col gap-2 text-xs text-(--t-text-dim)">
                <div className="flex items-center gap-2">
                  <button onClick={useMyLocation} disabled={geoBusy} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-(--t-bg-input) hover:bg-(--t-bg-input-hover) text-(--t-text-primary)">
                    <Icon icon="lucide:map-pin" width={12} /> {t("omni.theme.useMyLocation")}
                  </button>
                  <input type="number" step="0.0001" placeholder={t("omni.theme.latitude")} value={latText} onChange={(e) => {
                    setLatText(e.target.value);
                    const lat = parse(e.target.value);
                    const lng = parse(lngText);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) setLocation({ lat, lng, label: t("omni.theme.latitude"), source: "manual" });
                  }} className={inputCls} />
                  <input type="number" step="0.0001" placeholder={t("omni.theme.longitude")} value={lngText} onChange={(e) => {
                    setLngText(e.target.value);
                    const lng = parse(e.target.value);
                    const lat = parse(latText);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) setLocation({ lat, lng, label: t("omni.theme.longitude"), source: "manual" });
                  }} className={inputCls} />
                </div>
                {sun ? (
                  <span>{t("omni.theme.sunToday", { sunrise: fmt(sun.sunrise), sunset: fmt(sun.sunset) })}</span>
                ) : (
                  <span>{t("omni.theme.locationNeeded")}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
