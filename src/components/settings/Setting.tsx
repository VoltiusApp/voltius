import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingRow } from "@/components/settings/sections/shared";
import { highlightRanges } from "./registry/search";
import { useSettingState } from "./registry/useSettingState";
import { SettingControl } from "./settingControls";

export function Highlight({ text, query }: { text: string; query?: string }) {
  const ranges = query ? highlightRanges(text, query) : [];
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-[color-mix(in_srgb,var(--t-accent)_26%,transparent)] text-(--t-text-bright)">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function UndoButton({ onUndo }: { onUndo: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onUndo} className="shrink-0 px-1 text-xs font-medium text-(--t-accent)">
      {t("settings.search.undo")}
    </button>
  );
}

export function Setting({ id, variant, className, note, desc, highlight, resetAlwaysVisible, undo }: {
  id: string;
  variant?: "list" | "card";
  className?: string;
  note?: ReactNode;
  /** Replaces the registry description, for a row whose text depends on live state. */
  desc?: ReactNode;
  highlight?: string;
  resetAlwaysVisible?: boolean;
  undo?: { onUndo(): void };
}) {
  const { t } = useTranslation();
  const state = useSettingState(id);
  const { def } = state;
  const title = t(def.titleKey ?? def.labelKey);
  const description = desc !== undefined ? desc : def.descKey ? <Highlight text={t(def.descKey)} query={highlight} /> : undefined;
  return (
    <SettingRow
      variant={variant}
      className={className}
      title={<Highlight text={title} query={highlight} />}
      desc={description}
      note={note}
      dimmed={!state.active}
      syncKey={def.syncKey}
      policyKey={def.policyKey}
      dirty={state.dirty && !undo}
      onReset={state.canReset ? state.reset : undefined}
      resetAlwaysVisible={resetAlwaysVisible}
    >
      {undo && <UndoButton onUndo={undo.onUndo} />}
      <SettingControl state={state} label={title} />
    </SettingRow>
  );
}
