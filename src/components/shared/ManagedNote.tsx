import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { inPolicyRange, usePolicyLock, usePolicyRange, usePolicyRefresh, type PolicyRange } from "@/stores/policyStore";
import { installLocked } from "@/stores/pluginRegistryStore";

export function ManagedNote({ className = "", teams, children }: { className?: string; teams?: string[]; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-(--t-text-dim) ${className}`}>
      <Icon icon="lucide:building-2" width={12} height={12} className="shrink-0" />
      {children ?? (teams?.length ? t("common.policy.managedByTeam", { team: teams[0] }) : t("common.policy.managed"))}
    </span>
  );
}

type Format = (v: unknown) => string;

function useRangeText(range: PolicyRange | undefined, format: Format = String, unit = ""): string | undefined {
  const { t } = useTranslation();
  if (!range) return undefined;
  const show = (v: unknown) => `${format(v)}${unit}`;
  const { min, max, allowed } = range;
  return allowed
    ? t("common.policy.rangeAllowed", { values: allowed.filter((v) => inPolicyRange(range, v)).map(show).join(", ") })
    : min !== undefined && max !== undefined
      ? t("common.policy.rangeBetween", { min: show(min), max: show(max) })
      : max !== undefined
        ? t("common.policy.rangeMax", { value: show(max) })
        : t("common.policy.rangeMin", { value: show(min) });
}

export function RangeNote({ range, format, unit, className }: {
  range: PolicyRange;
  format?: Format;
  unit?: string;
  className?: string;
}) {
  return <ManagedNote className={className}>{useRangeText(range, format, unit)}</ManagedNote>;
}

export function useRangeSelect<V extends string | number>(key: string, values: readonly V[], label: (v: V) => string) {
  const range = usePolicyRange(key);
  const format = (v: unknown) => label(v as V);
  const text = useRangeText(range, format);
  const allows = (v: V) => inPolicyRange(range, v);
  return {
    allows,
    options: values.map((v) => ({ value: String(v), label: label(v), disabled: !allows(v), disabledTitle: text })),
    note: range && <ManagedNote>{text}</ManagedNote>,
  };
}

interface ManagedProps {
  /** False when the caller shows the note itself, away from the control. */
  note?: boolean;
  children: ReactNode;
}

export function Managed({ policyKey, ...rest }: ManagedProps & { policyKey: string }) {
  const lock = usePolicyLock(policyKey);
  return <ManagedWhen locked={lock.locked} teams={lock.locked ? lock.teams : undefined} {...rest} />;
}

export function ManagedWhen({ locked, teams, note = true, children }: ManagedProps & { locked: boolean; teams?: string[] }) {
  if (!locked) return <>{children}</>;
  const control = (
    <fieldset disabled className="contents [&_:disabled]:opacity-40 [&_:disabled]:cursor-not-allowed [&_:disabled]:pointer-events-none">
      {children}
    </fieldset>
  );
  if (!note) return control;
  return (
    <div className="flex items-center gap-2">
      <ManagedNote teams={teams} />
      {control}
    </div>
  );
}

// No note: the row's "Organization" badge already explains the lock.
export function ManagedUninstall({ id, children }: { id: string; children: ReactNode }) {
  usePolicyRefresh();
  return <ManagedWhen locked={installLocked(id)} note={false}>{children}</ManagedWhen>;
}
