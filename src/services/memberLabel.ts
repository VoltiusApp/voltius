import type { TeamMember } from "@/services/teamService";

export interface PeerName {
  name: string | null;
  handle: string | null;
  primary: string;
}

export interface PeerContext {
  teamId?: string;
  fallbackHandle?: string;
}

export function memberLabel(m: Pick<TeamMember, "member_name" | "handle"> | undefined, fallback = "?"): string {
  if (m?.member_name) return m.member_name;
  return m?.handle ? `@${m.handle}` : fallback;
}

export function memberSortKey(m: Pick<TeamMember, "member_name" | "handle">): string {
  return m.member_name ?? m.handle ?? "";
}

export function avatarLabel(p: PeerName): string {
  return p.name ?? p.handle ?? "?";
}

export function memberNamingSupported(members: TeamMember[] | undefined): boolean {
  return !!members?.some((m) => "member_name" in m);
}
