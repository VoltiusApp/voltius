import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

export function MembersEmptyState({ kind }: { kind: "noVault" | "vaultNotFound" }) {
  const { t } = useTranslation();
  if (kind === "vaultNotFound") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center bg-(--t-bg-base)">
        <Icon icon="lucide:vault" width={28} style={{ color: "var(--t-text-dim)" }} />
        <p className="text-sm text-(--t-text-dim)">{t("members.empty.vaultNotFound")}</p>
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-(--t-bg-base)">
      <div
        className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-(--t-text-dim)"
        style={{
          background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon="lucide:users-round" width={36} />
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="text-base font-semibold text-(--t-text-primary)">{t("members.empty.noVaultTitle")}</span>
        <span className="text-sm text-(--t-text-dim) max-w-[18.667rem]">{t("members.empty.noVaultDesc")}</span>
      </div>
    </div>
  );
}
