import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePolicyLock, usePolicyRefresh } from "@/stores/policyStore";
import { installLocked, useInstallAllowed } from "@/stores/pluginRegistryStore";

export function ManagedNote({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-(--t-text-dim) ${className}`}>
      <Icon icon="lucide:building-2" width={12} height={12} className="shrink-0" />
      {t("common.policy.managed")}
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
  const control = <fieldset disabled className="contents">{children}</fieldset>;
  if (!note) return control;
  return (
    <div className="flex items-center gap-2">
      <ManagedNote />
      {control}
    </div>
  );
}

export function ManagedInstall({ id, installed = false, children }: ManagedProps & { id: string; installed?: boolean }) {
  return <ManagedWhen locked={!useInstallAllowed(id, installed)}>{children}</ManagedWhen>;
}

export function ManagedUninstall({ id, children }: ManagedProps & { id: string }) {
  usePolicyRefresh();
  return <ManagedWhen locked={installLocked(id)}>{children}</ManagedWhen>;
}
