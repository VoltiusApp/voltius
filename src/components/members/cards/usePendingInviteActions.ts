import { useState } from "react";
import type { PendingInvitation } from "@/services/teamService";
import { inviteByEmailAddress, revokeInvitation } from "@/services/vaultShare";
import { whenWritable } from "@/services/previewGuard";
import { useGreyedUnless } from "@/hooks/useGreyedUnless";

export function usePendingInviteActions({ teamId, inv, canInvite, onRevoked, onResent }: {
  teamId: string;
  inv: PendingInvitation;
  canInvite: boolean;
  onRevoked: (id: string) => void;
  onResent?: () => void;
}) {
  const [revoking, setRevoking] = useState(false);
  const [resending, setResending] = useState(false);
  const disabledReason = useGreyedUnless()(canInvite).title;

  const revoke = whenWritable(async () => {
    setRevoking(true);
    try {
      // Shared helper rather than a local runTeamAction: it carries the
      // revoke-specific failure copy every other revoke surface uses.
      await revokeInvitation({ teamId, invitationId: inv.id, name: inv.display_name });
      onRevoked(inv.id);
    } catch { /* toast already reports the failure */ }
    finally { setRevoking(false); }
  });

  const resend = whenWritable(async () => {
    setResending(true);
    try {
      // Upserts the existing row and pushes expires_at out another seven days
      // (server teams.rs); inviteByEmailAddress runs its own toast.
      await inviteByEmailAddress({ teamId, email: inv.display_name, roleName: inv.role, roleIds: inv.role_ids });
      onResent?.();
    } catch { /* toast already reports the failure */ }
    finally { setResending(false); }
  });

  return { revoke: () => void revoke(), resend: () => void resend(), revoking, resending, disabledReason };
}
