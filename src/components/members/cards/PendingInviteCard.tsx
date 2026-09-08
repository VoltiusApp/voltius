import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { PendingInvitation, TeamRole } from "@/services/teamService";
import { revokePendingInvitation } from "@/services/teamService";
import { inviteByEmailAddress } from "@/services/vaultShare";
import { runTeamAction } from "@/services/teamActionFeedback";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import { BaseCard } from "@/components/shared/BaseCard";
import { ROLE_META } from "@/components/members/roleChips";

const DAY_MS = 86_400_000;

export function PendingInviteCard({
  inv, teamId, roles, onRevoked, onResent,
}: {
  inv: PendingInvitation;
  teamId: string;
  roles: TeamRole[];
  onRevoked: (id: string) => void;
  onResent?: () => void;
}) {
  const { t } = useTranslation();
  const [revoking, setRevoking] = useState(false);
  const [resending, setResending] = useState(false);

  // An older server filtered expired invitations out rather than labelling
  // them, so a missing status means everything it returned was still live.
  const isExpired = inv.status === "expired";
  const daysLeft = Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / DAY_MS);

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      await runTeamAction({
        pending: t("members.toast.revokingInvitation", { name: inv.display_name }),
        success: t("members.toast.invitationRevoked", { name: inv.display_name }),
        run: () => revokePendingInvitation(teamId, inv.id),
      });
      onRevoked(inv.id);
    } catch { /* toast already reports the failure */ }
    finally { setRevoking(false); }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      // Upserts the existing row and pushes expires_at out another seven days
      // (server teams.rs), so resending needs no dedicated endpoint.
      // inviteByEmailAddress runs its own toast — do not wrap it in another.
      await inviteByEmailAddress({ teamId, email: inv.display_name, roleName: inv.role });
      onResent?.();
    } catch { /* toast already reports the failure */ }
    finally { setResending(false); }
  };

  const matchedRole = roles.find((r) => r.name === inv.role);
  const meta = ROLE_META[inv.role] ?? ROLE_META.member;
  const chipColor = matchedRole?.color ?? meta.color;
  const chipBg = meta.bg ?? `${chipColor}1a`;

  // The badge already says "Expired", so this line carries the date instead of
  // repeating the word.
  const expiryLabel = isExpired
    ? t("members.invite.expiredOn", {
        date: new Date(inv.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      })
    : daysLeft <= 0
      ? t("members.invite.expiresToday")
      : t("members.invite.expiresIn", { count: daysLeft });

  return (
    <BaseCard isList>
      <MiniAvatar name={inv.display_name} size={32} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-(--t-text-bright)">{inv.display_name}</p>
        <p className="text-[10px] truncate" style={{ color: isExpired ? "var(--t-status-error)" : "var(--t-text-dim)" }}>
          {expiryLabel}
          {inv.invited_by_display_name && <> · {t("members.invitedBy")} {inv.invited_by_display_name}</>}
        </p>
      </div>

      <span
        className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
        style={{
          color: isExpired ? "var(--t-status-error)" : "var(--t-text-dim)",
          background: isExpired ? "rgba(239,68,68,0.1)" : "var(--t-bg-elevated)",
        }}
      >
        {isExpired ? t("members.invite.expired") : t("members.pendingBadge")}
      </span>
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0" style={{ color: chipColor, background: chipBg }}>
        {inv.role}
      </span>

      <button
        title={t("members.invite.resendTitle")}
        disabled={resending}
        onClick={(e) => { e.stopPropagation(); void handleResend(); }}
        className="p-1.5 flex rounded-lg transition-colors"
        style={{ color: "var(--t-text-dim)", opacity: resending ? 0.4 : 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-accent)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
      >
        {resending
          ? <Icon icon="lucide:loader-circle" width={16} className="animate-spin" />
          : <Icon icon="lucide:send" width={16} />
        }
      </button>
      <button
        title={t("members.revokeInvitationTitle")}
        disabled={revoking}
        onClick={(e) => { e.stopPropagation(); void handleRevoke(); }}
        className="p-1.5 flex rounded-lg transition-colors"
        style={{ color: "var(--t-text-dim)", opacity: revoking ? 0.4 : 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
      >
        {revoking
          ? <Icon icon="lucide:loader-circle" width={16} className="animate-spin" />
          : <Icon icon="lucide:x" width={16} />
        }
      </button>
    </BaseCard>
  );
}
