import type { Team, TeamMember, TeamRole } from "@/services/teamService";

export const makeTeam = (id: string, extra: Partial<Team> = {}): Team => ({
  id,
  name: id,
  owner_id: "o",
  owner_tier: "business",
  created_at: "",
  role_ids: [],
  ...extra,
});

export const makeRole = (id: string, permissions: number, extra: Partial<TeamRole> = {}): TeamRole => ({
  id,
  team_id: "t1",
  name: id,
  permissions,
  is_builtin: false,
  position: 1,
  created_at: "",
  ...extra,
});

export const makeMember = (user_id: string, role_ids: string[], extra: Partial<TeamMember> = {}): TeamMember => ({
  team_id: "t1",
  user_id,
  handle: "",
  public_key: "",
  invited_by_display_name: null,
  joined_at: "",
  role_ids,
  ...extra,
});
