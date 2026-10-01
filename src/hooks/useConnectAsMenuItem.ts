import { useTranslation } from "react-i18next";
import type { Connection } from "@/types";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { useIdentityPickStore } from "@/stores/identityPickStore";
import { useVaultIdentityDialogStore } from "@/stores/vaultIdentityDialogStore";
import { useTeamName } from "@/hooks/useTeamName";
import type { CredentialPlanResult } from "@/hooks/useCredentialPlan";
import { notifyError } from "@/utils/notifyError";
import { buildConnectAsItems, type ConnectAsCurrent } from "@/utils/connectAsItems";

export function useConnectAsMenuItem(conn: Connection | undefined, credential: CredentialPlanResult, afterPick?: () => void): ContextMenuItem | undefined {
  const { t } = useTranslation();
  const { plan, teamId, choices, hostIdentity, hasSharedCredential, isOwn, picksOffered } = credential;
  const setHostPick = useIdentityPickStore((s) => s.setHostPick);
  const currentPickId = useIdentityPickStore((s) => (conn ? s.byObject[conn.id] ?? null : null));
  const vaultName = useTeamName(teamId);
  const openDefault = useVaultIdentityDialogStore((s) => s.open);
  if (!conn || !teamId || !picksOffered) return undefined;
  if (choices.length === 0 && !hasSharedCredential && !currentPickId) return undefined;

  const current: ConnectAsCurrent =
    plan.kind === "unavailable" ? { kind: "none" } : currentPickId ? { kind: "pick", id: currentPickId } : { kind: "host" };
  const onPick = (identityId: string | null) => {
    setHostPick(conn.id, identityId).then(
      () => afterPick?.(),
      notifyError,
    );
  };
  return {
    label: t("hosts.connectAs.title"),
    icon: "lucide:user-round",
    children: buildConnectAsItems({
      choices,
      current,
      isOwn,
      hostLabel: hasSharedCredential ? (hostIdentity ? hostIdentity.name ?? hostIdentity.username : t("connections.form.connectAsHost")) : null,
      hostIdentityId: hostIdentity?.id,
      hasPick: !!currentPickId,
      vaultName,
      t,
      onPick,
      onOpenVaultDefault: () => openDefault(teamId),
    }),
  };
}
