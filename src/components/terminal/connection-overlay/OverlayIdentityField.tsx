import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useIdentityStore } from "@/stores/identityStore";
import { useTeamStore } from "@/stores/teamStore";
import { usePermissions } from "@/hooks/usePermission";
import { useAllConnections } from "@/hooks/useAllConnections";
import { NO_CONNECTION, useCredentialPlan } from "@/hooks/useCredentialPlan";
import { resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { selectVaultScopedItems } from "@/utils/vaultScopedItems";
import { Pills } from "@/components/shared/Pills";
import IdentitySelector from "@/components/connections/IdentitySelector";
import { defaultSaveTarget, repairSaveTarget, saveTargetOptions, type SaveTarget } from "./saveTarget";

export function OverlayIdentityField({
  vaultId,
  connectionId,
  hostName,
  identityId,
  onIdentityChange,
  saveTarget,
  onSaveTargetChange,
  repairVia,
  onGoToKeychain,
}: {
  vaultId?: string;
  connectionId?: string;
  hostName: string;
  identityId: string | null;
  onIdentityChange: (id: string | null) => void;
  saveTarget: SaveTarget;
  onSaveTargetChange: (target: SaveTarget) => void;
  repairVia?: "pick" | "default";
  onGoToKeychain: () => void;
}) {
  const { t } = useTranslation();
  const { identities, teamIdentities, loadIdentities } = useIdentityStore();
  const teams = useTeamStore((s) => s.teams);
  const can = usePermissions();
  const connection = useAllConnections().find((c) => c.id === connectionId);
  const { teamId, groups, picksOffered, ownIds } = useCredentialPlan(connection ?? NO_CONNECTION);

  useEffect(() => {
    void loadIdentities();
  }, [loadIdentities]);

  const teamVaultIds = useMemo(() => new Set(teams.map((team) => team.id)), [teams]);
  const personal = useMemo(
    () => selectVaultScopedItems({ vaultId: vaultId ?? "personal", localItems: identities, teamItems: teamIdentities, teamVaultIds, resolveVaultId: resolveVaultIdForSave }),
    [vaultId, identities, teamIdentities, teamVaultIds],
  );
  const shared = teamId ? groups.shared : personal;
  const own = picksOffered ? groups.own : undefined;
  const vaultName = teams.find((team) => team.id === teamId)?.name ?? "";
  const canEditHost = !!teamId && !!connectionId && can("EDIT_CONNECTIONS", teamId, connectionId);
  const kind = identityId && ownIds.has(identityId) ? "own" : "team";
  const showTarget = picksOffered && !!identityId && !repairVia;

  useEffect(() => {
    if (repairVia) onSaveTargetChange(repairSaveTarget(repairVia));
    else if (showTarget) onSaveTargetChange(defaultSaveTarget(kind, canEditHost));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityId, kind, canEditHost, showTarget, repairVia]);

  return (
    <>
      <IdentitySelector
        value={identityId}
        identities={shared}
        ownIdentities={own}
        sharedLabel={t("connections.identitySelector.sharedGroup", { vault: vaultName })}
        onChange={onIdentityChange}
        onGoToKeychain={onGoToKeychain}
      />
      {showTarget && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-(--t-text-dim) px-0.5">
            {t(kind === "own" ? "terminal.overlay.saveTarget.rememberFor" : "terminal.overlay.saveTarget.saveFor")}
          </p>
          <Pills options={saveTargetOptions(kind, canEditHost, vaultName, t)} value={saveTarget} onChange={onSaveTargetChange} />
          <p className="text-xs px-0.5 text-(--t-text-dim)">
            {kind === "own" ? t("terminal.overlay.saveTarget.ownNote") : t("terminal.overlay.saveTarget.teamNote", { host: hostName })}
          </p>
        </div>
      )}
    </>
  );
}
