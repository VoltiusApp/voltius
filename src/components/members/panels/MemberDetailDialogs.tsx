import { useTranslation } from "react-i18next";
import type { TeamMember } from "@/stores/teamStore";
import { RoleModal } from "@/components/members/panels/RolesPanel";
import { OffboardingDialog } from "@/components/members/OffboardingDialog";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { OwnershipConfirm } from "@/components/members/ownerInvite";
import { memberLabel } from "@/services/memberLabel";
import type { MemberDetailModel } from "./useMemberDetailModel";

export function MemberDetailDialogs({ model, member, teamId, onDone }: {
  model: MemberDetailModel;
  member: TeamMember;
  teamId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { ownerRole, primary, revokeKey, offboarding, roleModal } = model.dialogs;
  const name = memberLabel(member);
  return (
    <>
      {roleModal && <RoleModal teamId={teamId} role={null} onClose={roleModal.close} />}

      {offboarding && (
        <OffboardingDialog
          members={[member]}
          teamId={teamId}
          mode={offboarding.mode}
          onClose={offboarding.close}
          onDone={() => { onDone(); offboarding.done(); }}
        />
      )}

      {ownerRole && (
        <OwnershipConfirm kind={ownerRole.kind} name={name} onCancel={ownerRole.cancel} onConfirm={ownerRole.confirm} />
      )}

      {primary && (
        <ConfirmModal
          tone="warning"
          title={t("members.ownership.confirmPrimary.title", { name })}
          message={t(
            model.primaryOwner.billingEnabled ? "members.ownership.confirmPrimary.bodyBilling" : "members.ownership.confirmPrimary.bodySelfHosted",
            { name },
          )}
          confirmLabel={t("members.ownership.makePrimary")}
          onCancel={primary.cancel}
          onConfirm={primary.confirm}
        />
      )}

      {revokeKey && (
        <ConfirmModal
          tone="warning"
          title={t("members.revokeKeyAccess.title", { name })}
          message={t("members.revokeKeyAccess.body", { name })}
          confirmLabel={t("members.revokeKeyAccess.confirm")}
          onCancel={revokeKey.cancel}
          onConfirm={revokeKey.confirm}
        />
      )}
    </>
  );
}
