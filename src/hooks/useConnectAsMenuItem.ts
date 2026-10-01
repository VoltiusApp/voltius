import { useTranslation } from "react-i18next";
import type { Connection } from "@/types";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { useIdentityPickStore } from "@/stores/identityPickStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultIdentityDialogStore } from "@/stores/vaultIdentityDialogStore";
import { useCredentialPlan } from "@/hooks/useCredentialPlan";
import { buildConnectAsItems } from "@/utils/connectAsItems";

const EMPTY = { id: "", vault_id: "", username: "", host: "" } as unknown as Connection;

export function useConnectAsMenuItem(conn: Connection | undefined, afterPick?: () => void): ContextMenuItem | undefined {
  const { t } = useTranslation();
  const { plan, teamId, choices, hostIdentity, hasSharedCredential, ownIds, supported } = useCredentialPlan(conn ?? EMPTY);
  const setHostPick = useIdentityPickStore((s) => s.setHostPick);
  const currentPickId = useIdentityPickStore((s) => (conn ? s.byObject[conn.id] ?? null : null));
  const vaultName = useTeamStore((s) => s.teams.find((team) => team.id === teamId)?.name ?? "");
  const openDefault = useVaultIdentityDialogStore((s) => s.open);
  if (!conn || !teamId || !supported) return undefined;
  if (choices.length === 0 && !hasSharedCredential) return undefined;

  const onPick = (identityId: string | null) => {
    setHostPick(conn.id, identityId).then(
      () => afterPick?.(),
      (err: unknown) =>
        useNotificationStore.getState().addToast({
          source: { kind: "plugin", id: "core", name: "Voltius" },
          type: "toast",
          message: err instanceof Error ? err.message : String(err),
          severity: "error",
          duration: 4000,
        }),
    );
  };
  return {
    label: t("hosts.connectAs.title"),
    icon: "lucide:user-round",
    children: buildConnectAsItems({
      choices,
      currentPickId: plan.kind === "unavailable" ? null : currentPickId,
      ownIds,
      hostLabel: hasSharedCredential ? (hostIdentity ? hostIdentity.name ?? hostIdentity.username : t("connections.form.connectAsHost")) : null,
      vaultName,
      t,
      onPick,
      onOpenVaultDefault: () => openDefault(teamId),
    }),
  };
}
