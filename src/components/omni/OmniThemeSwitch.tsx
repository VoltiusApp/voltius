import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useThemeStore } from "@/stores/themeStore";
import { usePluginStore } from "@/stores/pluginStore";
import { BUILT_IN_THEMES } from "@/themes/presets";
import { applyThemeToDom } from "@/hooks/useApplyTheme";
import { resolveThemePhase, nextTransition } from "@/services/themeAutomation";
import { getSystemPrefersDark } from "@/services/systemAppearance";
import type { AppTheme } from "@/themes/types";

export default function OmniThemeSwitch({ query, onBack, onClose }: { query: string; onBack: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { customThemes, lightThemeId, darkThemeId, mode,
    setTheme, setLightThemeId, setDarkThemeId, toggleLightDark, getActiveTheme, getEffectiveThemeId } = useThemeStore();
  const pluginThemeMap = usePluginStore((s) => s.pluginThemes);

  const allThemes: AppTheme[] = useMemo(() => {
    const plugin = [...pluginThemeMap.values()].map((th) => ({ ...th, builtIn: true }));
    return [...BUILT_IN_THEMES, ...customThemes, ...plugin];
  }, [customThemes, pluginThemeMap]);

  const themes = useMemo(
    () => allThemes.filter((th) => !query || th.name.toLowerCase().includes(query)),
    [allThemes, query],
  );

  // Navigable rows: 0 = pair hero, 1..N = themes
  const rows = themes.length + 1;
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [query]);

  // Snapshot the committed effective theme so any non-commit exit can revert to it.
  const committedRef = useRef<AppTheme>(getActiveTheme());
  const committedFlag = useRef(false);

  // Live preview as selection moves (row 0 = revert to the committed snapshot).
  useEffect(() => {
    applyThemeToDom(sel === 0 ? committedRef.current : (themes[sel - 1] ?? committedRef.current));
  }, [sel, themes]);

  // Revert on unmount unless the user committed a pick.
  useEffect(() => () => { if (!committedFlag.current) applyThemeToDom(committedRef.current); }, []);

  const commit = (th: AppTheme) => {
    committedFlag.current = true;
    setTheme(th.id); // setTheme only sets activeThemeId — force manual mode explicitly
    useThemeStore.getState().setMode("manual");
    committedRef.current = th;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (sel === 0) { committedFlag.current = true; toggleLightDark(); onClose(); }
        else { const th = themes[sel - 1]; if (th) commit(th); }
      } else if (e.altKey && (e.key === "l" || e.key === "L") && sel > 0) {
        e.preventDefault();
        const th = themes[sel - 1]; if (th) setLightThemeId(th.id);
      } else if (e.altKey && (e.key === "d" || e.key === "D") && sel > 0) {
        e.preventDefault();
        const th = themes[sel - 1]; if (th) setDarkThemeId(th.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, rows, themes]);

  const byId = (id: string) => allThemes.find((th) => th.id === id);
  const light = byId(lightThemeId);
  const dark = byId(darkThemeId);
  const effectiveId = getEffectiveThemeId();

  const statusText = () => {
    if (mode === "manual") return t("omni.theme.statusManual");
    if (mode === "system") return t("omni.theme.statusSystem");
    const cfg = useThemeStore.getState().getAutomationConfig();
    const nt = nextTransition(cfg, new Date(), getSystemPrefersDark());
    const phase = resolveThemePhase(cfg, new Date(), getSystemPrefersDark());
    if (!nt) return t("omni.theme.statusSystem");
    return t("omni.theme.statusUntil", {
      phase: phase === "dark" ? t("omni.theme.roleDark") : t("omni.theme.roleLight"),
      time: nt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  };

  const Swatches = ({ th }: { th: AppTheme }) => (
    <div className="flex gap-1 shrink-0">
      {[th.ui.bgTerminal, th.ui.accent, th.ui.tabActiveText, th.ui.statusConnected].map((c, i) => (
        <span key={i} className="w-4 h-4 rounded-sm" style={{ background: c, border: "1px solid rgba(255,255,255,0.08)" }} />
      ))}
    </div>
  );

  return (
    <div className="overflow-y-auto py-2" style={{ maxHeight: "420px" }}>
      <button onClick={onBack} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-(--t-text-muted) hover:text-(--t-text-primary)">
        <Icon icon="lucide:arrow-left" width={14} />
        {t("omni.theme.backSwitch")}
      </button>

      {/* Pair hero: one tap flips light/dark */}
      <button
        data-idx={0}
        onMouseEnter={() => setSel(0)}
        onClick={() => { committedFlag.current = true; toggleLightDark(); onClose(); }}
        className="w-full flex items-center gap-3 px-4 py-3 transition-colors"
        style={{ background: sel === 0 ? "var(--t-border-hover)" : "transparent" }}
      >
        <span className="flex items-center gap-2 flex-1 min-w-0 text-sm">
          <Icon icon="lucide:sun" width={14} className="text-(--t-text-muted)" />
          <span className="truncate" style={{ color: "var(--t-text-primary)" }}>{light?.name ?? lightThemeId}</span>
        </span>
        <Icon icon="lucide:arrow-left-right" width={14} className="text-(--t-accent) shrink-0" />
        <span className="flex items-center gap-2 flex-1 min-w-0 justify-end text-sm">
          <span className="truncate" style={{ color: "var(--t-text-primary)" }}>{dark?.name ?? darkThemeId}</span>
          <Icon icon="lucide:moon" width={14} className="text-(--t-text-muted)" />
        </span>
      </button>

      <div className="border-t border-t-(--t-border) my-1" />

      {themes.map((th, i) => {
        const idx = i + 1;
        const isSel = sel === idx;
        const isLight = th.id === lightThemeId;
        const isDark = th.id === darkThemeId;
        return (
          <button
            key={th.id}
            data-idx={idx}
            onMouseEnter={() => setSel(idx)}
            onClick={() => commit(th)}
            className="group w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
            style={{ background: isSel ? "var(--t-border-hover)" : "transparent" }}
          >
            <Swatches th={th} />
            <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: isSel ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {th.name}
            </span>
            {isLight && <Icon icon="lucide:sun" width={13} className="text-(--t-text-muted) shrink-0" />}
            {isDark && <Icon icon="lucide:moon" width={13} className="text-(--t-text-muted) shrink-0" />}
            {th.id === effectiveId && <Icon icon="lucide:check" width={14} className="text-(--t-accent) shrink-0" />}
            <span className="hidden group-hover:flex items-center gap-1 shrink-0">
              <span onClick={(e) => { e.stopPropagation(); setLightThemeId(th.id); }} title={t("omni.theme.setAsLight")} className="p-1 rounded-sm text-(--t-text-dim) hover:text-(--t-text-primary)"><Icon icon="lucide:sun" width={12} /></span>
              <span onClick={(e) => { e.stopPropagation(); setDarkThemeId(th.id); }} title={t("omni.theme.setAsDark")} className="p-1 rounded-sm text-(--t-text-dim) hover:text-(--t-text-primary)"><Icon icon="lucide:moon" width={12} /></span>
            </span>
          </button>
        );
      })}

      <div className="border-t border-t-(--t-border) mt-1 px-4 py-2 flex items-center justify-between text-xs text-(--t-text-dim)">
        <span>{statusText()}</span>
        <span>{t("omni.theme.keyHints")}</span>
      </div>
    </div>
  );
}
