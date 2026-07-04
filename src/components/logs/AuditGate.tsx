import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/hooks/usePermission";
import type { AuditContext } from "@/services/auditContext";

interface Props {
  context: AuditContext | null;
  children: React.ReactNode;
}

export function AuditGate({ context, children }: Props) {
  const can = usePermissions();
  const { t } = useTranslation();

  if (!context) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-(--t-bg-base)">
        <div
          className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-(--t-text-dim)"
          style={{
            background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
            border: "1px solid var(--t-border)",
          }}
        >
          <Icon icon="lucide:scroll-text" width={36} />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-base font-semibold text-(--t-text-primary)">{t("logs.gate.noVaultSelected.title")}</span>
          <span className="text-sm text-(--t-text-dim) max-w-xs">
            {t("logs.gate.noVaultSelected.description")}
          </span>
        </div>
      </div>
    );
  }

  if (context.kind === "local") return <>{children}</>;

  if (!can("VIEW_AUDIT_LOG", context.teamId)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-(--t-bg-base)">
        <div
          className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-(--t-text-dim)"
          style={{
            background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
            border: "1px solid var(--t-border)",
          }}
        >
          <Icon icon="lucide:lock" width={36} />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-base font-semibold text-(--t-text-primary)">{t("logs.gate.restricted.title")}</span>
          <span className="text-sm text-(--t-text-dim) max-w-xs">
            {t("logs.gate.restricted.description")}
          </span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
