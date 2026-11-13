import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { DirtyDot, ResetButton, SettingRow } from "@/components/settings/sections/shared";
import { useIsAndroid, useIsMobile } from "@/utils/platform";
import { RangeNote } from "@/components/shared/ManagedNote";
import { usePolicyRange } from "@/stores/policyStore";
import { availableOn } from "./registry/defaults";
import type { SettingDef, Translate } from "./registry/types";
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

function rangeFormat(def: SettingDef, t: Translate): { format: (v: unknown) => string; unit?: string } {
  const c = def.control;
  if (c.kind === "select") {
    const toOption = c.toOption ?? String;
    return { format: (v) => c.options(t).find((o) => o.value === toOption(v))?.label ?? String(v) };
  }
  if (c.kind === "number" || c.kind === "stepper") return { format: (v) => String(c.toDisplay ? c.toDisplay(v) : v), unit: ` ${c.unit(t)}` };
  return { format: String };
}

const MARKUP = /<\/?\w+>/;

function Description({ descKey, query }: { descKey: string; query?: string }) {
  const { t } = useTranslation();
  const text = t(descKey);
  if (MARKUP.test(text)) return <Trans i18nKey={descKey} components={{ code: <code className="font-mono" /> }} />;
  return <Highlight text={text} query={query} />;
}

export function UndoButton({ onUndo }: { onUndo: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onUndo} className="shrink-0 px-1 text-xs font-medium text-(--t-accent)">
      {t("settings.search.undo")}
    </button>
  );
}

export function Setting({ id, variant, className, note, desc, highlight, resetAlwaysVisible, undo, beforeReset, standalone }: {
  id: string;
  variant?: "list" | "card";
  className?: string;
  note?: ReactNode;
  /** Replaces the registry description; null hides it. */
  desc?: ReactNode | null;
  highlight?: string;
  resetAlwaysVisible?: boolean;
  undo?: { onUndo(): void };
  beforeReset?(previous: unknown): void;
  /** Outside its section the row needs the setting's full name, e.g. "Theme mode" rather than "Mode". */
  standalone?: boolean;
}) {
  const { t } = useTranslation();
  const state = useSettingState(id);
  const { def } = state;
  const isMobile = useIsMobile();
  const isAndroid = useIsAndroid();
  const range = usePolicyRange(def.policyKey ?? "");
  if (!availableOn(def, { isMobile, isAndroid })) return null;
  const title = t(standalone ? def.labelKey : def.titleKey ?? def.labelKey);
  const description = desc === null ? undefined : desc ?? (def.descKey ? <Description descKey={def.descKey} query={highlight} /> : undefined);
  return (
    <SettingRow
      variant={variant}
      className={className}
      title={<Highlight text={title} query={highlight} />}
      desc={description}
      note={note ?? (range && !state.locked ? <RangeNote range={range} {...rangeFormat(def, t)} /> : undefined)}
      dimmed={!state.active}
      syncKey={def.syncKey}
      policyKey={def.policyKey}
      dirty={state.dirty && !undo}
      onReset={state.canReset ? () => { beforeReset?.(state.value); state.reset(); } : undefined}
      resetAlwaysVisible={resetAlwaysVisible}
    >
      {undo && <UndoButton onUndo={undo.onUndo} />}
      <SettingControl state={state} label={title} />
    </SettingRow>
  );
}

/** Adds the changed dot and reset next to a bespoke label; renders the label untouched at default. */
export function SettingMark({ id, children }: { id: string; children: ReactNode }) {
  const state = useSettingState(id);
  if (!state.dirty || state.locked) return <>{children}</>;
  return (
    <span className="group inline-flex items-center gap-1.5">
      {children}
      <DirtyDot />
      {state.canReset && <ResetButton onReset={state.reset} />}
    </span>
  );
}
