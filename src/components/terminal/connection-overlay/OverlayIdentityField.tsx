import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useIdentityStore } from "@/stores/identityStore";
import { usePermissions } from "@/hooks/usePermission";
import { useAllConnections } from "@/hooks/useAllConnections";
import { NO_CONNECTION, useCredentialPlan } from "@/hooks/useCredentialPlan";
import { useTeamName } from "@/hooks/useTeamName";
import { useVaultScopedItems } from "@/hooks/useVaultScopedItems";
import { Pills } from "@/components/shared/Pills";
import IdentitySelector from "@/components/connections/IdentitySelector";
import { PickerSectionLabel } from "@/components/shared/pickerParts";
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
  const can = usePermissions();
  const connection = useAllConnections().find((c) => c.id === connectionId);
  const { teamId, groups, picksOffered, isOwn } = useCredentialPlan(connection ?? NO_CONNECTION);

  useEffect(() => {
    void loadIdentities();
  }, [loadIdentities]);

  const personal = useVaultScopedItems(vaultId, identities, teamIdentities);
  const shared = teamId ? groups.shared : personal;
  const own = picksOffered ? groups.own : undefined;
  const vaultName = useTeamName(teamId);
  const canEditHost = !!teamId && !!connectionId && can("EDIT_CONNECTIONS", teamId, connectionId);
  const kind = identityId && isOwn(identityId) ? "own" : "team";
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
          <PickerSectionLabel>
            {t(kind === "own" ? "terminal.overlay.saveTarget.rememberFor" : "terminal.overlay.saveTarget.saveFor")}
          </PickerSectionLabel>
          <Pills options={saveTargetOptions(kind, canEditHost, vaultName, t)} value={saveTarget} onChange={onSaveTargetChange} />
          <p className="text-xs px-0.5 text-(--t-text-dim)">
            {kind === "own" ? t("terminal.overlay.saveTarget.ownNote") : t("terminal.overlay.saveTarget.teamNote", { host: hostName })}
          </p>
        </div>
      )}
    </>
  );
}
