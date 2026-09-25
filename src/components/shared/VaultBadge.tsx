import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";

/** Small chip naming the vault (or team) an item lives in; muted for Personal. */
export function VaultBadge({ vaultId }: { vaultId: string | undefined }) {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const effectiveId = vaultId ?? "personal";
  const vault = vaults.find((v) => v.id === effectiveId || v.teamId === effectiveId);
  const team = !vault ? teams.find((tm) => tm.id === effectiveId) : undefined;
  const name = vault?.name ?? team?.name ?? t("common.entity.personal");
  const isPersonal = effectiveId === "personal";
  return (
    <span
      className="shrink-0 flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm border"
      style={isPersonal
        ? { background: "var(--t-bg-elevated)", color: "var(--t-text-muted)", borderColor: "var(--t-border)" }
        : { background: "color-mix(in srgb, var(--t-accent) 12%, transparent)", color: "var(--t-accent)", borderColor: "color-mix(in srgb, var(--t-accent) 30%, transparent)" }}
    >
      <Icon icon="lucide:vault" width={10} />
      {name}
    </span>
  );
}
