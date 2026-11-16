import { useTranslation } from "react-i18next";
import type { PendingInvitation } from "@/services/teamService";
import { usePendingInviteActions } from "@/components/members/cards/usePendingInviteActions";
import { inviteLabel } from "@/services/memberLabel";
import BottomSheet from "./BottomSheet";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";

export default function PendingInviteActionsSheet({ teamId, inv, onDone, onClose }: {
  teamId: string;
  inv: PendingInvitation;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { revoke, resend } = usePendingInviteActions(teamId, inv, onDone, onDone);
  const items: SheetAction[] = [
    { slug: "resend", icon: "lucide:send", label: t("mobile.members.invite.resend"), onTap: () => { resend(); onClose(); } },
    { slug: "revoke", icon: "lucide:x", label: t("mobile.members.invite.revoke"), danger: true, onTap: () => { revoke(); onClose(); } },
  ];
  return (
    <BottomSheet title={inviteLabel(inv)} onClose={onClose}>
      {items.map((it) => <SheetActionRow key={it.slug} attr="invite-action" it={it} />)}
    </BottomSheet>
  );
}
