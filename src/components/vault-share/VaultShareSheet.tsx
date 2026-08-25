import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { getMyUserId } from "@/services/teamService";
import { ConvertToTeamGate } from "./ConvertToTeamGate";
import { InviteControl } from "./InviteControl";
import { PeopleList, type Person } from "./PeopleList";
import { canManageShare } from "./vaultShareModel";

type Tab = "people" | "invite" | "links";

interface Props {
  vaultId: string;
  variant: "popover" | "full";
  onRequestFull?: () => void;
}

export function VaultShareSheet({ vaultId, variant, onRequestFull }: Props) {
  const { t } = useTranslation();
  const vault = useVaultStore((s) => s.vaults.find((v) => v.id === vaultId));
  const teamId = vault?.teamId ?? null;

  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const pendingInvitationsByTeam = useTeamStore((s) => s.pendingInvitationsByTeam);
  const statusByTeamId = useTeamVaultStateStore((s) => s.statusByTeamId);
  const usedSeats = useSubscriptionStore((s) => s.usedSeats);
  const totalSeats = useSubscriptionStore((s) => s.totalSeats);

  const [tab, setTab] = useState<Tab>("people");
  // Owned by the sheet, never by a tab: the bug this component replaces was an
  // error written to a panel the same handler had just unmounted.
  const [error, setError] = useState("");

  // undefined while resolving, null once resolved with no signed-in user.
  const [myUserId, setMyUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getMyUserId()
      .then((id) => { if (!cancelled) setMyUserId(id); })
      .catch(() => { if (!cancelled) setMyUserId(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!teamId) return;
    setError("");
    const { loadMembers, loadRoles, loadPendingInvitations } = useTeamStore.getState();
    void Promise.allSettled([loadMembers(teamId), loadRoles(teamId), loadPendingInvitations(teamId)]).then(
      (results) => {
        if (results.some((r) => r.status === "rejected")) setError(t("members.share.loadFailed"));
      },
    );
    void useSubscriptionStore.getState().load();
    // t intentionally omitted: this loads once per teamId, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const people = useMemo<Person[]>(() => {
    if (!teamId) return [];
    const roles = rolesByTeam[teamId] ?? [];
    const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "";
    const awaiting = statusByTeamId[teamId] === "awaiting_key";
    const members: Person[] = (membersByTeam[teamId] ?? []).map((m) => ({
      userId: m.user_id,
      handle: m.handle ?? "?",
      roleNames: m.role_ids.map(roleName).filter(Boolean),
      online: !!m.is_online,
      state: awaiting ? "awaiting_key" : "member",
    }));
    const pending: Person[] = (pendingInvitationsByTeam[teamId] ?? []).map((inv) => ({
      userId: inv.id,
      handle: inv.display_name,
      roleNames: [inv.role],
      online: false,
      state: "pending",
      invitationId: inv.id,
    }));
    return [...members, ...pending];
  }, [teamId, membersByTeam, rolesByTeam, pendingInvitationsByTeam, statusByTeamId]);

  // While the caller's own id is still resolving, treat them as not a manager
  // rather than flash manage controls and then withdraw them.
  const myRoleNames = useMemo(() => {
    if (!teamId || myUserId == null) return [];
    const me = (membersByTeam[teamId] ?? []).find((m) => m.user_id === myUserId);
    if (!me) return [];
    const roles = rolesByTeam[teamId] ?? [];
    return me.role_ids
      .map((rid) => roles.find((r) => r.id === rid)?.name)
      .filter((n): n is string => !!n);
  }, [teamId, myUserId, membersByTeam, rolesByTeam]);

  if (!vault) return null;

  if (!teamId) {
    return (
      <ConvertToTeamGate
        vaultId={vault.id}
        vaultName={vault.name}
        onCancel={() => onRequestFull?.()}
        onConverted={() => setTab("invite")}
      />
    );
  }

  const canManage = canManageShare(myRoleNames);

  return (
    <div className="flex flex-col gap-3.5 p-4">
      <div className="flex gap-4 border-b border-(--t-border)">
        <button onClick={() => setTab("people")} aria-current={tab === "people"} className="pb-2 text-xs">
          {t("members.share.tabPeople")}
        </button>
        <button onClick={() => setTab("invite")} aria-current={tab === "invite"} className="pb-2 text-xs">
          {t("members.share.tabInvite")}
        </button>
      </div>

      {error && <p className="text-xs" style={{ color: "var(--t-status-error)" }}>{error}</p>}

      {tab === "people" && (
        <PeopleList
          people={people}
          canManage={canManage}
          onRemove={() => {}}
          onRevoke={() => {}}
          onGrantKey={() => {}}
          onCopyInviteLink={() => {}}
        />
      )}

      {tab === "invite" && (
        <InviteControl
          teamId={teamId}
          roles={rolesByTeam[teamId] ?? []}
          existingIds={new Set(people.map((p) => p.userId))}
          usedSeats={usedSeats}
          totalSeats={totalSeats}
          onInvited={() => setTab("people")}
        />
      )}

      {variant === "popover" && (
        <button onClick={onRequestFull} className="self-start text-[11px] text-(--t-text-secondary)">
          {t("members.share.manage")}
        </button>
      )}
    </div>
  );
}
