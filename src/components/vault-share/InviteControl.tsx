import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { TeamRole } from "@/stores/teamStore";
import { useUserSearch } from "@/hooks/useUserSearch";
import { assignableRoles, seatState } from "./vaultShareModel";
import { inviteUserById, inviteByEmailAddress } from "@/services/vaultShare";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  teamId: string;
  roles: TeamRole[];
  existingIds: Set<string>;
  usedSeats: number | null;
  totalSeats: number | null;
  onInvited: () => void;
}

export function InviteControl({ teamId, roles, existingIds, usedSeats, totalSeats, onInvited }: Props) {
  const { t } = useTranslation();
  const options = assignableRoles(roles);
  const seats = seatState(usedSeats, totalSeats);
  const [roleId, setRoleId] = useState<string | null>(null);
  const search = useUserSearch(existingIds);

  useEffect(() => {
    if (!roleId && options.length > 0) {
      setRoleId(options.find((r) => r.name === "member")?.id ?? options[options.length - 1].id);
    }
  }, [options, roleId]);

  const role = options.find((r) => r.id === roleId) ?? null;
  const isEmail = EMAIL_RE.test(search.query.trim());

  const invite = async (userId: string, handle: string) => {
    if (!role) return;
    try {
      await inviteUserById({ teamId, userId, handle, roleName: role.name, roleId: role.id });
    } catch {
      return;
    }
    search.reset();
    onInvited();
  };

  const inviteEmail = async () => {
    if (!role) return;
    try {
      await inviteByEmailAddress({ teamId, email: search.query.trim(), roleName: role.name });
    } catch {
      return;
    }
    search.reset();
    onInvited();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-(--t-text-secondary)">
          {t("members.invite.searchOrInviteLabel")}
        </span>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <Icon icon="lucide:search" width={14} className="text-(--t-text-dim)" />
          <input
            ref={search.inputRef}
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            placeholder={t("members.invite.searchUserPlaceholder")}
            className="bg-transparent outline-none text-xs flex-1 text-(--t-text-primary)"
          />
        </div>

        {search.open && search.results.map((u) => (
          <div key={u.user_id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-(--t-bg-card)">
            <span className="text-xs flex-1 text-(--t-text-primary) break-all">{u.handle}</span>
            <button
              onClick={() => void invite(u.user_id, u.handle)}
              className="px-3 py-1 rounded-lg text-[11px] font-medium"
              style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}
            >
              {t("members.invite.inviteAction")}
            </button>
          </div>
        ))}

        {isEmail && (
          <button onClick={() => void inviteEmail()} className="px-3 py-1.5 rounded-lg text-[11px] border border-(--t-border) text-(--t-text-secondary) self-start">
            {t("members.invite.sendInviteLabel")}
          </button>
        )}

        <p className="text-[11px] text-(--t-text-secondary)">{t("members.invite.handleRule")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-(--t-text-secondary)">
          {t("members.invite.joinsAs")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {options.map((r) => (
            <button
              key={r.id}
              onClick={() => setRoleId(r.id)}
              aria-pressed={r.id === roleId}
              className="px-2.5 py-1 rounded-lg text-[11px] capitalize border"
              style={{
                background: r.id === roleId ? "color-mix(in srgb, var(--t-accent) 10%, transparent)" : "var(--t-bg-elevated)",
                borderColor: r.id === roleId ? "var(--t-accent)" : "transparent",
                color: r.id === roleId ? "var(--t-accent)" : "var(--t-text-secondary)",
              }}
            >
              {r.name}
            </button>
          ))}
        </div>
        {role && <p className="text-[11px] text-(--t-text-secondary)">{t(`members.roleBlurb.${role.name}`, { defaultValue: "" })}</p>}
      </div>

      <span className="text-[11px] text-(--t-text-secondary)">
        {seats.kind === "known"
          ? t("members.invite.seatsSummary", { used: seats.used, available: seats.available, total: seats.total })
          : t("members.invite.seatsUnknown")}
      </span>
    </div>
  );
}
