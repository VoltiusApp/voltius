import { useTeamStore } from "@/stores/teamStore";
import { getMyUserId, listMembers } from "@/services/teamService";
import type { TeamMember } from "@/services/teamService";
import type { Tier } from "@/stores/subscriptionTier";

/** Account tier as used across the share flow (ShareMenu, InvitePeopleSection, ParticipantsRatioNotice). */
export type ShareTier = Tier;

/** Guests a shared session may hold, from the tier whose plan the session runs on. */
export function guestCapFor(tier: string | undefined): number {
  return tier === "business" ? 50 : tier === "teams" ? 10 : 1;
}

const OWNER_TIER_RANK: Record<string, number> = { business: 2, teams: 1 };

/**
 * Highest owner tier across the given team vaults. A shared session's guest cap
 * comes from the owner's plan, so sharing to several vaults takes the best one.
 */
export function highestOwnerTier(teamIds: string[]): string {
  const { teams } = useTeamStore.getState();
  return teamIds
    .map((id) => teams.find((t) => t.id === id)?.owner_tier ?? "free")
    .reduce((best, t) => ((OWNER_TIER_RANK[t] ?? 0) > (OWNER_TIER_RANK[best] ?? 0) ? t : best), "free");
}

/** Members of the given team vaults, loading any the UI has not visited yet. */
export async function membersOfTeams(teamIds: string[]): Promise<TeamMember[]> {
  const store = useTeamStore.getState();
  await Promise.all(teamIds.map((id) => (store.membersByTeam[id] ? Promise.resolve() : store.loadMembers(id))));
  const { membersByTeam } = useTeamStore.getState();
  return teamIds.flatMap((id) => membersByTeam[id] ?? []);
}

/**
 * Current public keys for the given members, fetched straight from the server —
 * never `teamStore`'s cached member list. A cached `public_key` can be stale
 * (e.g. the member joined or rotated keys after the cache was filled), and
 * wrapping a session/vault key to a stale key produces a wrap the recipient
 * can't unwrap. Used at the point of wrapping by both the direct-invite and
 * vault-share paths; the cached roster remains fine for display.
 */
export async function freshPublicKeys(members: TeamMember[]): Promise<Map<string, string>> {
  const teamIds = [...new Set(members.map((m) => m.team_id))];
  const fresh = (await Promise.all(teamIds.map((id) => listMembers(id)))).flat();
  return new Map(fresh.map((m) => [m.user_id, m.public_key]));
}

/** A teammate merged across every team they share with the caller. */
export type Teammate = TeamMember & { teamIds: string[] };

/**
 * Every teammate across all of the caller's teams, merged by user_id (with the
 * union of shared team_ids) and with the caller dropped, sorted online-first
 * then alphabetically.
 */
export async function allTeammates(): Promise<Teammate[]> {
  const { teams } = useTeamStore.getState();
  const [members, myUserId] = await Promise.all([membersOfTeams(teams.map((t) => t.id)), getMyUserId()]);

  const merged = new Map<string, Teammate>();
  for (const member of members) {
    if (member.user_id === myUserId) continue;
    const existing = merged.get(member.user_id);
    if (existing) existing.teamIds.push(member.team_id);
    else merged.set(member.user_id, { ...member, teamIds: [member.team_id] });
  }

  return [...merged.values()].sort((a, b) => {
    if (!!a.is_online !== !!b.is_online) return a.is_online ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });
}

/** The invite-relevant view of a hosted session, as both invite surfaces need it. */
export interface InviteSession {
  vaultIds: string[];
  participantIds: string[];
  invitedIds: string[];
}

/**
 * Builds that view from a local multiplayer connection plus the server's record of
 * the session, if one exists yet. The host is always in `participants` but never
 * counts against their own cap.
 */
export function inviteSessionOf(
  connection: { participants?: { user_id: string }[]; myUserId?: string } | undefined,
  active: { vault_ids?: string[]; invitee_ids?: string[] } | undefined,
): InviteSession {
  return {
    vaultIds: active?.vault_ids ?? [],
    participantIds: (connection?.participants ?? [])
      .filter((p) => p.user_id !== connection?.myUserId)
      .map((p) => p.user_id),
    invitedIds: active?.invitee_ids ?? [],
  };
}

/**
 * Seats a session has committed against its cap: live guests, standing invites, and
 * invites just sent from this menu that the server has not round-tripped back into
 * `invitedIds` yet. Without that last set a Pro host at cap 1 could invite a second
 * teammate in the window before the session list refreshes. A pending invite holds
 * its seat until the session ends — that is deliberate, not an oversight.
 */
export function seatUsage(
  session: InviteSession,
  invitedThisSession: Iterable<string>,
  guestCap: number,
): { committedSeats: number; atCap: boolean } {
  const committedSeats = new Set([...session.participantIds, ...session.invitedIds, ...invitedThisSession]).size;
  return { committedSeats, atCap: committedSeats >= guestCap };
}

/** Whether a member already has a route into the session: a shared vault, live participation, or a standing invite. */
export function memberHasAccess(
  member: { user_id: string; teamIds: string[] },
  session: InviteSession,
): boolean {
  return (
    member.teamIds.some((id) => session.vaultIds.includes(id)) ||
    session.participantIds.includes(member.user_id) ||
    session.invitedIds.includes(member.user_id)
  );
}
