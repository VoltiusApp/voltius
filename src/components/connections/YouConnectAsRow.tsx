import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/types";
import { ContextMenu } from "@/components/shared/ContextMenu";
import type { CredentialPlanResult } from "@/hooks/useCredentialPlan";
import { useConnectAsMenuItem } from "@/hooks/useConnectAsMenuItem";
import { formLabelClass, formLabelStyle } from "@/components/shared/Panel";
import { connectAsSummary } from "./connectAsSummary";

export function YouConnectAsRow({ connection, credential }: { connection: Connection; credential: CredentialPlanResult }) {
  const { t } = useTranslation();
  const { plan, isOwn, hostIdentity, hasSharedCredential, picksOffered } = credential;
  const menu = useConnectAsMenuItem(connection, credential);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!picksOffered && plan.kind === "host") return null;
  const s = connectAsSummary(plan, isOwn, hostIdentity, hasSharedCredential, t);

  return (
    <div>
      <label className={formLabelClass} style={formLabelStyle}>{t("connections.form.youConnectAs")}</label>
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-(--t-bg-base) border border-(--t-border)">
        <Icon icon={s.icon} width={14} className={s.warn ? "shrink-0 text-yellow-400" : "shrink-0 text-(--t-accent)"} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-(--t-text-primary) truncate">{s.title}</p>
          {s.subtitle && <p className="text-xs text-(--t-text-dim) truncate">{s.subtitle}</p>}
        </div>
        {menu?.children && (
          <button
            type="button"
            className="text-xs text-(--t-accent) shrink-0"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPos({ x: r.left, y: r.bottom + 4 });
            }}
          >
            {t("connections.form.change")}
          </button>
        )}
      </div>
      {pos && menu?.children && <ContextMenu items={menu.children} pos={pos} onClose={() => setPos(null)} />}
    </div>
  );
}
