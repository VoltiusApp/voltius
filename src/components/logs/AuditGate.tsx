import { Icon } from "@iconify/react";
import { usePermissions } from "@/hooks/usePermission";
import type { AuditContext } from "@/services/auditContext";

interface Props {
  context: AuditContext | null;
  children: React.ReactNode;
}

export function AuditGate({ context, children }: Props) {
  const can = usePermissions();

  if (!context) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[var(--t-bg-base)]">
        <div
          className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-[var(--t-text-dim)]"
          style={{
            background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
            border: "1px solid var(--t-border)",
          }}
        >
          <Icon icon="lucide:scroll-text" width={36} />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-base font-semibold text-[var(--t-text-primary)]">No vault selected</span>
          <span className="text-sm text-[var(--t-text-dim)] max-w-xs">
            Select a single vault to view audit logs.
          </span>
        </div>
      </div>
    );
  }

  if (context.kind === "local") return <>{children}</>;

  if (!can("VIEW_AUDIT_LOG", context.teamId)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[var(--t-bg-base)]">
        <div
          className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-[var(--t-text-dim)]"
          style={{
            background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
            border: "1px solid var(--t-border)",
          }}
        >
          <Icon icon="lucide:lock" width={36} />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-base font-semibold text-[var(--t-text-primary)]">Access restricted</span>
          <span className="text-sm text-[var(--t-text-dim)] max-w-xs">
            You need the View Audit Log permission to access this page.
          </span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
