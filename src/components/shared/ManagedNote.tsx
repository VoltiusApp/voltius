import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePolicyLock, usePolicyRefresh } from "@/stores/policyStore";
import { installLocked } from "@/stores/pluginRegistryStore";

export function ManagedNote({ className = "", children }: { className?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-(--t-text-dim) ${className}`}>
      <Icon icon="lucide:building-2" width={12} height={12} className="shrink-0" />
      {children ?? t("common.policy.managed")}
    </span>
  );
}

interface ManagedProps {
  /** False when the caller shows the note itself, away from the control. */
  note?: boolean;
  children: ReactNode;
}

export function Managed({ policyKey, ...rest }: ManagedProps & { policyKey: string }) {
  return <ManagedWhen locked={usePolicyLock(policyKey).locked} {...rest} />;
}

export function ManagedWhen({ locked, note = true, children }: ManagedProps & { locked: boolean }) {
  if (!locked) return <>{children}</>;
  const control = (
    <fieldset disabled className="contents [&_:disabled]:opacity-40 [&_:disabled]:cursor-not-allowed [&_:disabled]:pointer-events-none">
      {children}
    </fieldset>
  );
  if (!note) return control;
  return (
    <div className="flex items-center gap-2">
      <ManagedNote />
      {control}
    </div>
  );
}

// No note: the row's "Organization" badge already explains the lock.
export function ManagedUninstall({ id, children }: { id: string; children: ReactNode }) {
  usePolicyRefresh();
  return <ManagedWhen locked={installLocked(id)} note={false}>{children}</ManagedWhen>;
}
