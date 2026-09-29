import { test, expect, vi, beforeEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { PERM_BITS } from "@/services/permissions";

vi.mock("@/services/vault", () => ({ getSecret: vi.fn() }));
vi.mock("@/services/teamService", () => ({ getMyUserId: vi.fn(async () => "u1") }));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: { getState: () => ({ vaults: [{ id: "t1", name: "t1", teamId: "t1" }] }) },
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: (sel: (s: unknown) => unknown) => sel({
    teams: [{ id: "t1", name: "t1", owner_id: "o", owner_tier: "team", created_at: "", role_ids: [] }],
    membersByTeam: {
      t1: [{
        team_id: "t1", user_id: "u1", handle: "", public_key: "",
        invited_by_display_name: null, joined_at: "", role_ids: ["r1"],
      }],
    },
    rolesByTeam: {
      t1: [{ id: "r1", team_id: "t1", name: "r1", permissions: PERM_BITS.VIEW_SECRETS, is_builtin: false, position: 0, created_at: "" }],
    },
    loadTeams: vi.fn(),
    loadMembers: vi.fn(),
    loadRoles: vi.fn(),
  }),
}));

import { getSecret } from "@/services/vault";
import { useStoredSecrets } from "./useStoredSecrets";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";

beforeEach(() => {
  cleanup();
  vi.mocked(getSecret).mockReset();
  useTeamObjectAccessStore.getState().clearAll();
});

test("an object rule without View secrets keeps the fields empty", async () => {
  useTeamObjectAccessStore.getState().replaceTeam("t1", {
    c1: { type: "connection", ruleSetId: "s1", myPermissions: PERM_BITS.VIEW | PERM_BITS.CONNECT, parentId: null, deleted: false },
  }, true);
  const { result } = renderHook(() => useStoredSecrets("c1", "t1", { password: "password:c1" }, () => {}));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current).toBe("forbidden");
  expect(getSecret).not.toHaveBeenCalled();
});
