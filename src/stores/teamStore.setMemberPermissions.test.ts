import { describe, it, expect, vi, beforeEach } from "vitest";
import { PERM_BITS } from "@/services/permissions";

const setMemberPermissions = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/teamService", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  setMemberPermissions: (...a: unknown[]) => setMemberPermissions(...a),
}));

describe("teamStore.setMemberPermissions", () => {
  beforeEach(() => setMemberPermissions.mockClear());

  it("updates the cached member optimistically", async () => {
    const { useTeamStore } = await import("@/stores/teamStore");
    useTeamStore.setState({
      membersByTeam: {
        t1: [{
          team_id: "t1", user_id: "u1", handle: "alice", public_key: "k",
          invited_by_display_name: null, joined_at: "", role_ids: [],
          permission_allow: 0, permission_deny: 0,
        }],
      },
    } as never);

    await useTeamStore.getState().setMemberPermissions("t1", "u1", PERM_BITS.CONNECT, PERM_BITS.VIEW_SECRETS);

    expect(setMemberPermissions).toHaveBeenCalledWith("t1", "u1", PERM_BITS.CONNECT, PERM_BITS.VIEW_SECRETS);
    const member = useTeamStore.getState().membersByTeam.t1[0];
    expect(member.permission_allow).toBe(PERM_BITS.CONNECT);
    expect(member.permission_deny).toBe(PERM_BITS.VIEW_SECRETS);
  });
});
