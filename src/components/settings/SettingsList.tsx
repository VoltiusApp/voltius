import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { SETTINGS_SECTIONS, useUIStore, type SettingsSection } from "@/stores/uiStore";
import { useIsAndroid, useIsMobile } from "@/utils/platform";
import { useUiLanguage } from "@/i18n";
import { SETTINGS_ROW_BUTTON, SettingRow, SettingsGroup } from "./sections/shared";
import { Highlight, Setting } from "./Setting";
import { settingDef, settingDefs } from "./registry/entries";
import { searchSettings, type SearchHit } from "./registry/search";
import { resettableInBulk, restorable, useChangedSettings } from "./useChangedSettings";

interface UndoState {
  previous: Record<string, unknown>;
  remember(id: string, value: unknown): void;
  forget(id: string): void;
  clear(): void;
}

const useUndoStore = create<UndoState>((set) => ({
  previous: {},
  remember: (id, value) => set((s) => ({ previous: { ...s.previous, [id]: value } })),
  forget: (id) => set((s) => {
    const { [id]: _, ...rest } = s.previous;
    return { previous: rest };
  }),
  clear: () => set({ previous: {} }),
}));

function undo(id: string) {
  const { previous, forget } = useUndoStore.getState();
  if (!(id in previous)) return;
  settingDef(id)?.set?.(previous[id]);
  forget(id);
}

export function ResetAllButton() {
  const { t } = useTranslation();
  const { states } = useChangedSettings();
  const [confirming, setConfirming] = useState(false);
  const targets = states.filter(resettableInBulk);
  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-(--t-text-secondary)">{t("settings.search.resetAllConfirm", { count: targets.length })}</span>
        <button
          type="button"
          className={`${SETTINGS_ROW_BUTTON} text-(--t-status-error)`}
          onClick={() => {
            for (const s of targets) {
              useUndoStore.getState().remember(s.def.key, s.value);
              s.reset();
            }
            setConfirming(false);
          }}
        >
          {t("settings.search.resetAll")}
        </button>
        <button type="button" className={SETTINGS_ROW_BUTTON} onClick={() => setConfirming(false)}>
          {t("settings.search.cancel")}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${SETTINGS_ROW_BUTTON} inline-flex items-center gap-1.5`}
      disabled={targets.length === 0}
      onClick={() => setConfirming(true)}
    >
      <Icon icon="lucide:rotate-ccw" width={11} />
      {t("settings.search.resetAll")}
    </button>
  );
}

const registryIndex = (h: SearchHit) => (h.kind === "setting" ? settingDefs().indexOf(h.def) : -1);

export const sectionOf = (h: SearchHit) => (h.kind === "setting" ? h.def.section : h.panel.section);

/** Text-search hits, narrowed to changed settings when asked; empty without a query. */
export function useSearchHits(query: string, changedOnly: boolean, extra?: ReadonlySet<string> | null): SearchHit[] {
  const language = useUiLanguage();
  const isMobile = useIsMobile();
  const isAndroid = useIsAndroid();
  const { states } = useChangedSettings();
  const changedKeys = useMemo(() => new Set(states.map((s) => s.def.key)), [states]);
  return useMemo(() => {
    if (!query.trim()) return [];
    const found = searchSettings(query, { isMobile, isAndroid });
    if (!changedOnly) return found;
    return found.filter((h) => h.kind === "setting" && (changedKeys.has(h.def.key) || !!extra?.has(h.def.key)));
  }, [query, changedOnly, changedKeys, extra, isMobile, isAndroid, language]);
}
const keyOf = (h: SearchHit) => (h.kind === "setting" ? h.def.key : `panel:${h.panel.id}`);

function PanelRow({ hit, query }: { hit: Extract<SearchHit, { kind: "panel" }>; query: string }) {
  const { t } = useTranslation();
  const { panel } = hit;
  return (
    <SettingRow
      title={<Highlight text={t(panel.labelKey, { count: 0 })} query={query} />}
      desc={panel.descKey ? <Highlight text={t(panel.descKey)} query={query} /> : undefined}
    >
      <button type="button" className={SETTINGS_ROW_BUTTON} onClick={() => useUIStore.getState().openSettings(panel.section)}>
        {t("settings.search.open")}
      </button>
    </SettingRow>
  );
}

export function SettingsList({ query, changedOnly }: { query: string; changedOnly: boolean }) {
  const { t } = useTranslation();
  const { states } = useChangedSettings();
  const previous = useUndoStore((s) => s.previous);
  const [sticky, setSticky] = useState<Set<string> | null>(null);
  const [stickyFor, setStickyFor] = useState(false);
  if (changedOnly !== stickyFor) {
    setStickyFor(changedOnly);
    setSticky(changedOnly ? new Set(states.map((s) => s.def.key)) : null);
    if (!changedOnly) useUndoStore.getState().clear();
  }

  const changedKeys = useMemo(() => new Set(states.map((s) => s.def.key)), [states]);
  const searched = useSearchHits(query, changedOnly, sticky);
  const hits: SearchHit[] = useMemo(() => {
    if (query.trim() || !changedOnly) return searched;
    const keys = new Set([...changedKeys, ...(sticky ?? [])]);
    return [...keys]
      .map((k) => settingDef(k))
      .filter((d) => !!d)
      .map((def): SearchHit => ({ kind: "setting", def }))
      .sort((a, b) => SETTINGS_SECTIONS.indexOf(sectionOf(a)) - SETTINGS_SECTIONS.indexOf(sectionOf(b)) || registryIndex(a) - registryIndex(b));
  }, [query, changedOnly, changedKeys, sticky, searched]);

  if (!hits.length) {
    const empty = !query.trim()
      ? t("settings.search.emptyChanged")
      : t(changedOnly ? "settings.search.emptyQueryChanged" : "settings.search.emptyQuery", { query });
    return (
      <div className="p-10 flex flex-col items-center gap-2 text-center">
        <Icon icon="lucide:search" width={22} className="text-(--t-text-dim)" />
        <span className="text-sm text-(--t-text-dim)">{empty}</span>
      </div>
    );
  }

  const groups = new Map<SettingsSection, SearchHit[]>();
  for (const h of hits) groups.set(sectionOf(h), [...(groups.get(sectionOf(h)) ?? []), h]);

  return (
    <div className="p-6 space-y-6">
      {[...groups].map(([section, items]) => (
        <SettingsGroup
          key={section}
          divided
          title={
            <span className="flex items-center gap-1.5">
              {t(`settings.nav.${section}.label`)}
              <button
                type="button"
                onClick={() => useUIStore.getState().openSettings(section)}
                aria-label={t("settings.search.openSection", { section: t(`settings.nav.${section}.label`) })}
                title={t("settings.search.openSection", { section: t(`settings.nav.${section}.label`) })}
                className="p-0.5 rounded-sm text-(--t-text-dim) hover:text-(--t-accent)"
              >
                <Icon icon="lucide:arrow-up-right" width={13} />
              </button>
            </span>
          }
        >
          {items.map((h) => h.kind === "panel"
            ? <PanelRow key={keyOf(h)} hit={h} query={query} />
            : (
              <Setting
                key={keyOf(h)}
                id={h.def.key}
                standalone
                highlight={query}
                resetAlwaysVisible={changedOnly}
                beforeReset={(v) => restorable(h.def) && useUndoStore.getState().remember(h.def.key, v)}
                undo={changedOnly && h.def.key in previous && !changedKeys.has(h.def.key) ? { onUndo: () => undo(h.def.key) } : undefined}
              />
            ))}
        </SettingsGroup>
      ))}
    </div>
  );
}
