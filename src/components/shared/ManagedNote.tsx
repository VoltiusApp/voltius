import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePolicyLock } from "@/stores/policyStore";

export function ManagedNote() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 text-xs text-(--t-text-dim)">
      <Icon icon="lucide:building-2" width={12} height={12} />
      {t("common.policy.managed")}
    </span>
  );
}

export function Managed({ policyKey, children }: { policyKey: string; children: ReactNode }) {
  const lock = usePolicyLock(policyKey);
  if (!lock.locked) return <>{children}</>;
  return (
    <div className="flex items-center gap-2">
      <ManagedNote />
      <fieldset disabled className="contents">{children}</fieldset>
    </div>
  );
}
