import type { Team } from "@/services/teamService";

export const makeTeam = (id: string, extra: Partial<Team> = {}): Team => ({
  id,
  name: id,
  owner_id: "o",
  owner_tier: "business",
  created_at: "",
  role_ids: [],
  ...extra,
});
