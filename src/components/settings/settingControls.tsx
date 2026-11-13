import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Toggle } from "@/components/shared/Toggle";
import { FormSelect } from "@/components/shared/FormSelect";
import { clampToRange, inPolicyRange, usePolicyRange } from "@/stores/policyStore";
import { useUIStore } from "@/stores/uiStore";
import { SETTINGS_ROW_BUTTON } from "@/components/settings/sections/shared";
import { useRangeText } from "@/components/shared/ManagedNote";
import type { SettingState } from "./registry/useSettingState";

const STEP_BUTTON = "w-8 h-8 rounded-lg flex items-center justify-center transition-colors bg-(--t-bg-input) text-(--t-text-muted) border border-(--t-border) disabled:opacity-40";
const clamp = (v: number, min: number, max = Infinity) => Math.min(max, Math.max(min, v));

function SelectControl({ state, label }: { state: SettingState; label: string }) {
  const { t } = useTranslation();
  const control = state.def.control;
  const range = usePolicyRange(state.def.policyKey ?? "");
  const all = control.kind === "select" ? control.options(t) : [];
  const toOption = control.kind === "select" && control.toOption ? control.toOption : String;
  const fromOption = control.kind === "select" && control.fromOption ? control.fromOption : (o: string) => o;
  const rangeText = useRangeText(range, (v) => all.find((o) => o.value === toOption(v))?.label ?? String(v));
  if (control.kind !== "select") return null;
  const options = all.map((o) => {
    const disabled = !inPolicyRange(range, fromOption(o.value));
    return { ...o, disabled, disabledTitle: disabled ? rangeText : undefined };
  });
  return (
    <FormSelect
      className={`${control.width ?? "w-44"} shrink-0`}
      ariaLabel={label}
      disabled={!state.active}
      value={toOption(state.value)}
      options={options}
      onChange={(v) => state.set(fromOption(v))}
    />
  );
}

function NumberControl({ state, label }: { state: SettingState; label: string }) {
  const { t } = useTranslation();
  const control = state.def.control;
  const range = usePolicyRange(state.def.policyKey ?? "");
  const [draft, setDraft] = useState<string | null>(null);
  if (control.kind !== "number") return null;
  const toDisplay = (v: unknown) => (control.toDisplay ? control.toDisplay(v) : Number(v));
  const fromDisplay = (n: number) => (control.fromDisplay ? control.fromDisplay(n) : n);
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    setDraft(null);
    if (!Number.isFinite(n) || n < control.min) return;
    state.set(clampToRange(range, fromDisplay(clamp(n, control.min, control.max)) as number));
  };
  return (
    <>
      <input
        type="number"
        aria-label={label}
        min={Math.max(control.min, range?.min === undefined ? 0 : toDisplay(range.min))}
        max={range?.max === undefined ? control.max : toDisplay(range.max)}
        step={control.step}
        value={draft ?? toDisplay(state.value)}
        disabled={!state.active}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="form-input w-20 px-2 py-1 rounded-lg text-sm text-right outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
        style={{ opacity: state.active ? 1 : 0.45 }}
      />
      <span className="text-xs text-(--t-text-dim)">{control.unit(t)}</span>
    </>
  );
}

function StepperControl({ state, label }: { state: SettingState; label: string }) {
  const { t } = useTranslation();
  const control = state.def.control;
  if (control.kind !== "stepper") return null;
  const shown = control.toDisplay ? control.toDisplay(state.value) : Number(state.value);
  const write = (display: number) => {
    const next = clamp(display, control.min, control.max);
    state.set(control.fromDisplay ? control.fromDisplay(next) : next);
  };
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className={STEP_BUTTON} disabled={shown <= control.min} onClick={() => write(shown - control.step)} aria-label={t("settings.appearance.uiScale.zoomOut")}>
        <Icon icon="lucide:minus" width={14} />
      </button>
      <span className="text-xs font-semibold px-2 py-1 rounded-md tabular-nums text-center min-w-14 bg-(--t-bg-input) text-(--t-text-secondary) border border-(--t-border)">
        {shown}{control.unit(t)}
      </span>
      <button type="button" className={STEP_BUTTON} disabled={shown >= (control.max ?? Infinity)} onClick={() => write(shown + control.step)} aria-label={t("settings.appearance.uiScale.zoomIn")}>
        <Icon icon="lucide:plus" width={14} />
      </button>
    </div>
  );
}

export function SettingControl({ state, label }: { state: SettingState; label: string }) {
  const { t } = useTranslation();
  const control = state.def.control;
  switch (control.kind) {
    case "toggle":
      return <Toggle checked={!!state.value} onChange={state.set} disabled={!state.active} aria-label={label} />;
    case "select":
      return <SelectControl state={state} label={label} />;
    case "number":
      return <NumberControl state={state} label={label} />;
    case "stepper":
      return <StepperControl state={state} label={label} />;
    case "time":
      return (
        <input
          type="time"
          aria-label={label}
          value={String(state.value ?? "")}
          onChange={(e) => e.target.value && state.set(e.target.value)}
          className="form-input px-2 py-1 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
        />
      );
    case "value":
      return (
        <span className="text-xs text-(--t-text-dim) truncate max-w-56">
          {control.format ? control.format(state.value) : String(state.value ?? "")}
        </span>
      );
    case "open":
      return (
        <button type="button" className={SETTINGS_ROW_BUTTON} onClick={() => useUIStore.getState().openSettings(state.def.section)}>
          {t("settings.search.open")}
        </button>
      );
  }
}
