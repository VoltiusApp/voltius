import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { allTeammates, memberHasAccess, type Teammate } from "@/services/teamSharing";

interface InvitePeopleSectionProps {
  session: { vaultIds: string[]; participantIds: string[]; invitedIds: string[] };
  onInvite: (member: Teammate) => Promise<void>;
}

type RowStatus = "inviting" | "invited";

export function InvitePeopleSection({ session, onInvite }: InvitePeopleSectionProps) {
  const { t } = useTranslation();
  const [teammates, setTeammates] = useState<Teammate[] | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    allTeammates().then(setTeammates).catch(() => setTeammates([]));
  }, []);

  // Render nothing until the roster has loaded, so the section never flashes an empty header.
  if (teammates === null) return null;

  const handleInvite = async (member: Teammate) => {
    setError(null);
    setRowStatus((prev) => ({ ...prev, [member.user_id]: "inviting" }));
    try {
      await onInvite(member);
      setRowStatus((prev) => ({ ...prev, [member.user_id]: "invited" }));
    } catch {
      setRowStatus((prev) => {
        const next = { ...prev };
        delete next[member.user_id];
        return next;
      });
      setError(t("terminal.share.inviteFailed", { name: member.display_name }));
    }
  };

  return (
    <div className="px-3 pb-3">
      <p className="text-xs font-semibold mb-2" style={{ color: "var(--t-text-primary)" }}>
        {t("terminal.share.invitePeople")}
      </p>

      {error && (
        <div
          className="mb-2 px-2 py-1.5 rounded-sm text-[11px]"
          style={{
            background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)",
            color: "var(--t-status-error)",
            border: "1px solid color-mix(in srgb, var(--t-status-error) 25%, transparent)",
          }}
        >
          {error}
        </div>
      )}

      {teammates.length === 0 ? (
        <p className="text-xs text-center py-2" style={{ color: "var(--t-text-dim)" }}>
          {t("terminal.share.inviteNoTeammates")}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {teammates.map((member) => {
            const hasAccess = memberHasAccess(member, session);
            const status = rowStatus[member.user_id];
            return (
              <button
                key={member.user_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-left disabled:cursor-default transition-colors"
                style={{ color: "var(--t-text-primary)", background: "transparent" }}
                disabled={hasAccess || status === "inviting"}
                onClick={() => handleInvite(member)}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: member.is_online ? "var(--t-status-success)" : "var(--t-text-dim)" }}
                />
                <span className="text-xs flex-1 truncate">{member.display_name}</span>
                {hasAccess ? (
                  <span className="text-[10px]" style={{ color: "var(--t-text-dim)" }}>
                    {t("terminal.share.inviteHasAccess")}
                  </span>
                ) : status === "inviting" ? (
                  <Icon icon="lucide:loader-circle" width={12} className="animate-spin" style={{ color: "var(--t-text-dim)" }} />
                ) : status === "invited" ? (
                  <span className="text-[10px]" style={{ color: "var(--t-accent)" }}>
                    {t("terminal.share.inviteSent")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
