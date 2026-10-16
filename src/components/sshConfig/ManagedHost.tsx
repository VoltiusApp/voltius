import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useManagedAlias } from "@/stores/sshConfigStore";
import { detach } from "@/services/sshConfig/link";
import { formLabelClass, formLabelStyle } from "@/components/shared/Panel";
import { ReadOnlyFields } from "@/components/shared/editAccess";

const surface = {
  background: "color-mix(in srgb, var(--t-accent) 10%, transparent)",
  border: "1px solid color-mix(in srgb, var(--t-accent) 28%, transparent)",
};

export function ManagedBadge({ id, compact }: { id: string; compact?: boolean }) {
  const { t } = useTranslation();
  const alias = useManagedAlias(id);
  if (!alias) return null;
  return (
    <span title={t("hosts.managed.tooltip", { alias })} className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold" style={{ ...surface, color: "var(--t-accent)" }}>
      <Icon icon="lucide:file-cog" width={12} />
      {!compact && t("hosts.managed.badge")}
    </span>
  );
}

export function ManagedBanner({ id }: { id: string | undefined }) {
  const { t } = useTranslation();
  const alias = useManagedAlias(id);
  if (!alias || !id) return null;
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg text-xs" style={surface}>
      <div className="flex items-center gap-2">
        <Icon icon="lucide:file-cog" width={15} className="shrink-0" style={{ color: "var(--t-accent)" }} />
        <span className="flex-1 min-w-0 text-(--t-text-primary) font-semibold truncate">{t("hosts.managed.bannerTitle")}</span>
        <button type="button" className="btn btn-secondary shrink-0 px-2.5 py-1 rounded-md text-xs font-medium" onClick={() => void detach([id])}>{t("hosts.managed.detach")}</button>
      </div>
      <span className="text-(--t-text-secondary)">
        {t("hosts.managed.bannerBodyBefore")}<code className="font-mono text-(--t-text-primary)">{alias}</code>{t("hosts.managed.bannerBodyAfter")}
      </span>
    </div>
  );
}

export const LockMark = () => <Icon icon="lucide:lock" width={11} className="inline ml-1 -mt-0.5 text-(--t-text-dim)" />;

export function LockedField({ label, locked, className, children }: { label: ReactNode; locked: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label className={formLabelClass} style={formLabelStyle}>{label}{locked && <LockMark />}</label>
      <ReadOnlyFields readOnly={locked}>{children}</ReadOnlyFields>
    </div>
  );
}
