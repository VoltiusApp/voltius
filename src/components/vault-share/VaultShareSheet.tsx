import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { displaySeatCap } from "@/services/seatMath";
import { getMyUserId, getVaultKeyHolders } from "@/services/teamService";
import { ConvertToTeamGate } from "./ConvertToTeamGate";
import { InviteControl } from "./InviteControl";
import { JoinLinksTab } from "./JoinLinksTab";
import { PeopleList, type Person } from "./PeopleList";
import { canManageShare, canMintLink } from "./vaultShareModel";
import {
  addressedInviteLink,
  grantVaultKeyToMember,
  removeTeamMember,
  revokeInvitation,
} from "@/services/vaultShare";
import { writeClipboard } from "@/utils/clipboard";

type Tab = "people" | "invite" | "links";

interface Props {
  vaultId: string;
  variant: "popover" | "full";
  onRequestFull?: () => void;
}

export function VaultShareSheet({ vaultId, variant, onRequestFull }: Props) {
  const { t } = useTranslation();
  const vault = useVaultStore((s) => s.vaults.find((v) => v.id === vaultId));
  const teams = useTeamStore((s) => s.teams);
  // `vaultId` is a local vault id for an owner but a *team* id when reached
  // through the sidebar's standalone-team entry.
  const standaloneTeam = vault ? null : (teams.find((t) => t.id === vaultId) ?? null);
  const teamId = vault?.teamId ?? standaloneTeam?.id ?? null;

  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const pendingInvitationsByTeam = useTeamStore((s) => s.pendingInvitationsByTeam);
  const usedSeats = useSubscriptionStore((s) => s.usedSeats);
  const effectiveSeats = useSubscriptionStore((s) => s.effectiveSeats);
  const totalSeats = useSubscriptionStore((s) => s.totalSeats);

  const [tab, setTab] = useState<Tab>("people");
  // Owned by the sheet, never by a tab: the bug this component replaces was an
  // error written to a panel the same handler had just unmounted.
  const [error, setError] = useState("");
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);

  // undefined while resolving, null once resolved with no signed-in user.
  const [myUserId, setMyUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getMyUserId()
      .then((id) => { if (!cancelled) setMyUserId(id); })
      .catch(() => { if (!cancelled) setMyUserId(null); });
    return () => { cancelled = true; };
  }, []);

  // Null while unknown. `statusByTeamId` is the *viewer's* own status, so it
  // cannot say who is waiting.
  const [keyHolders, setKeyHolders] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!teamId) return;
    setError("");
    setKeyHolders(null);
    const { loadMembers, loadRoles, loadPendingInvitations } = useTeamStore.getState();
    void Promise.allSettled([loadMembers(teamId), loadRoles(teamId), loadPendingInvitations(teamId)]).then(
      (results) => {
        if (results.some((r) => r.status === "rejected")) setError(t("members.share.loadFailed"));
      },
    );
    // Best-effort: a member without MANAGE permission is refused this list.
    let cancelled = false;
    void getVaultKeyHolders(teamId)
      .then((ids) => { if (!cancelled) setKeyHolders(new Set(ids)); })
      .catch(() => {});
    void useSubscriptionStore.getState().load();
    return () => { cancelled = true; };
    // t intentionally omitted: this loads once per teamId, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const people = useMemo<Person[]>(() => {
    if (!teamId) return [];
    const roles = rolesByTeam[teamId] ?? [];
    const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "";
    const members: Person[] = (membersByTeam[teamId] ?? []).map((m) => ({
      userId: m.user_id,
      handle: m.handle ?? "?",
      roleNames: m.role_ids.map(roleName).filter(Boolean),
      online: !!m.is_online,
      state: keyHolders && !keyHolders.has(m.user_id) ? "awaiting_key" : "member",
      publicKey: m.public_key,
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
  }, [teamId, membersByTeam, rolesByTeam, pendingInvitationsByTeam, keyHolders]);

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

  if (!vault && !standaloneTeam) return null;

  // Only a local vault can be converted; a standalone team already is one.
  if (!teamId) {
    return (
      <ConvertToTeamGate
        vaultId={vault!.id}
        vaultName={vault!.name}
        onCancel={() => onRequestFull?.()}
        onConverted={() => setTab("invite")}
      />
    );
  }

  const canManage = canManageShare(myRoleNames);
  const canMint = canMintLink(myRoleNames);

  const reloadMembers = () => {
    void useTeamStore.getState().loadMembers(teamId);
    void useTeamStore.getState().loadPendingInvitations(teamId);
    // So a member who just received their key stops reading as waiting.
    void getVaultKeyHolders(teamId).then((ids) => setKeyHolders(new Set(ids))).catch(() => {});
  };

  const handleRemove = (p: Person) =>
    void removeTeamMember({ teamId, userId: p.userId, handle: p.handle })
      .then(reloadMembers)
      .catch(() => {});

  const handleRevoke = (p: Person) =>
    p.invitationId &&
    void revokeInvitation({ teamId, invitationId: p.invitationId, name: p.handle })
      .then(reloadMembers)
      .catch(() => {});

  const handleGrantKey = (p: Person) =>
    void grantVaultKeyToMember({
      teamId,
      userId: p.userId,
      handle: p.handle,
      publicKey: p.publicKey ?? "",
    })
      .then(reloadMembers)
      .catch(() => {});

  const handleCopyInviteLink = (p: Person) => {
    if (!p.invitationId) return;
    void writeClipboard(addressedInviteLink(p.invitationId)).then(() => setCopiedInvite(p.invitationId!));
  };

  return (
    <div className="flex flex-col gap-3.5 p-4">
      <div className="flex gap-4 border-b border-(--t-border)">
        <button onClick={() => setTab("people")} aria-current={tab === "people"} className="pb-2 text-xs">
          {t("members.share.tabPeople")}
        </button>
        <button onClick={() => setTab("invite")} aria-current={tab === "invite"} className="pb-2 text-xs">
          {t("members.share.tabInvite")}
        </button>
        <button onClick={() => setTab("links")} aria-current={tab === "links"} className="pb-2 text-xs">
          {t("members.share.tabLinks")}
        </button>
      </div>

      {error && <p className="text-xs" style={{ color: "var(--t-status-error)" }}>{error}</p>}

      {tab === "people" && (
        <>
          <PeopleList
            people={people}
            canManage={canManage}
            onRemove={handleRemove}
            onRevoke={handleRevoke}
            onGrantKey={handleGrantKey}
            onCopyInviteLink={handleCopyInviteLink}
          />
          {copiedInvite && (
            <p className="text-[11px] text-(--t-text-secondary)">{t("members.people.inviteLinkCopied")}</p>
          )}
        </>
      )}

      {tab === "links" && (
        <JoinLinksTab teamId={teamId} roles={rolesByTeam[teamId] ?? []} canMint={canMint} />
      )}

      {tab === "invite" && (
        <InviteControl
          teamId={teamId}
          roles={rolesByTeam[teamId] ?? []}
          existingIds={new Set(people.map((p) => p.userId))}
          usedSeats={usedSeats}
          seatCap={displaySeatCap(effectiveSeats, totalSeats)}
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
