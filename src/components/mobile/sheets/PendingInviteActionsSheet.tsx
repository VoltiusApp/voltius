import { useTranslation } from "react-i18next";
import type { PendingInvitation } from "@/services/teamService";
import { usePendingInviteActions } from "@/components/members/cards/usePendingInviteActions";
import { inviteLabel } from "@/services/memberLabel";
import BottomSheet from "./BottomSheet";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";

export default function PendingInviteActionsSheet({ teamId, inv, canInvite, onDone, onClose }: {
  teamId: string;
  inv: PendingInvitation;
  canInvite: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { revoke, resend, disabledReason } = usePendingInviteActions({ teamId, inv, canInvite, onRevoked: onDone, onResent: onDone });
  const items: SheetAction[] = [
    { slug: "resend", icon: "lucide:send", label: t("mobile.members.invite.resend"), disabledReason, onTap: () => { resend(); onClose(); } },
    { slug: "revoke", icon: "lucide:x", label: t("mobile.members.invite.revoke"), danger: true, disabledReason, onTap: () => { revoke(); onClose(); } },
  ];
  return (
    <BottomSheet title={inviteLabel(inv)} onClose={onClose}>
      {items.map((it) => <SheetActionRow key={it.slug} attr="invite-action" it={it} />)}
    </BottomSheet>
  );
}
