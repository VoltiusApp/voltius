import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTeamStore, type TeamRole } from "@/stores/teamStore";
import { useMyUserId } from "@/hooks/useMyUserId";
import { useOwnershipContext } from "@/hooks/useOwnershipContext";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { assignableRoles } from "@/components/vault-share/vaultShareModel";

export type OwnershipChange = "grant" | "revoke" | "invite";

export function OwnershipConfirm({ kind, name, onCancel, onConfirm }: {
  kind: OwnershipChange;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmModal
      tone="warning"
      title={t(`members.ownership.${kind}.title`, { name })}
      message={t(`members.ownership.${kind}.body`, { name })}
      confirmLabel={t(`members.ownership.${kind}.confirm`)}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/** Roles an invitation may carry, and why Owner is out of reach when the viewer is not an Owner. */
export function useInviteRoleOptions(teamId: string, roles: TeamRole[]) {
  const { t } = useTranslation();
  const myUserId = useMyUserId();
  const me = useTeamStore((s) => s.membersByTeam[teamId]?.find((m) => m.user_id === myUserId));
  const { multiOwner, viewerIsOwner } = useOwnershipContext(teamId, me, roles);
  const options = useMemo(() => assignableRoles(roles, { withOwner: multiOwner }), [roles, multiOwner]);
  return { options, ownerLockedReason: viewerIsOwner ? undefined : t("members.invite.ownerOnlyOwners") };
}

export function useOwnerInviteConfirm() {
  const [pending, setPending] = useState<{ name: string; send: () => void } | null>(null);
  const guard = (grantsOwner: boolean, name: string, send: () => void) => {
    if (grantsOwner) setPending({ name, send });
    else send();
  };
  const modal = pending && (
    <OwnershipConfirm
      kind="invite"
      name={pending.name}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        setPending(null);
        pending.send();
      }}
    />
  );
  return { guard, modal };
}
