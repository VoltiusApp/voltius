import { test, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

const h = vi.hoisted(() => ({ getMyUserId: vi.fn(async () => "me") }));
vi.mock("@/services/teamService", () => ({ getMyUserId: h.getMyUserId }));

import { resolveVaultIdForSave, useDefaultVaultId } from "./useWritableVaultIds";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { PERM_BITS } from "@/hooks/usePermission";
import type { TeamMember, TeamRole } from "@/services/teamService";

const role = (id: string, permissions: number, name = id, is_builtin = false): TeamRole =>
  ({ id, team_id: "t1", name, permissions, is_builtin, position: 0 } as TeamRole);
const member = (user_id: string, role_ids: string[]): TeamMember =>
  ({ team_id: "t1", user_id, display_name: "", public_key: "", invited_by_display_name: null, joined_at: "", role_ids });

beforeEach(() => {
  h.getMyUserId.mockResolvedValue("me");
  useVaultStore.setState({ vaults: [], selectedVaultIds: [] } as never);
  useTeamStore.setState({ teams: [], membersByTeam: {}, rolesByTeam: {} } as never);
});

// ─── resolveVaultIdForSave ───
test("resolveVaultIdForSave: personal passthrough", () => {
  expect(resolveVaultIdForSave("personal")).toBe("personal");
});
test("resolveVaultIdForSave: maps local vault uuid to its teamId", () => {
  useVaultStore.setState({ vaults: [{ id: "v1", teamId: "team-abc" }] } as never);
  expect(resolveVaultIdForSave("v1")).toBe("team-abc");
});
test("resolveVaultIdForSave: unknown vault id returned unchanged", () => {
  expect(resolveVaultIdForSave("v-unknown")).toBe("v-unknown");
});

// ─── useDefaultVaultId ───
test("selected 'personal' wins immediately", async () => {
  useVaultStore.setState({ selectedVaultIds: ["personal"], vaults: [] } as never);
  const { result } = renderHook(() => useDefaultVaultId());
  await waitFor(() => expect(h.getMyUserId).toHaveBeenCalled());
  expect(result.current).toBe("personal");
});

test("member with EDIT_CONNECTIONS on a team vault → returns team id", async () => {
  useVaultStore.setState({ selectedVaultIds: ["team-1"], vaults: [] } as never);
  useTeamStore.setState({
    teams: [{ id: "team-1", role_ids: ["r1"] }],
    membersByTeam: { "team-1": [member("me", ["r1"])] },
    rolesByTeam: { "team-1": [role("r1", PERM_BITS.EDIT_CONNECTIONS)] },
  } as never);
  const { result } = renderHook(() => useDefaultVaultId());
  await waitFor(() => expect(result.current).toBe("team-1"));
});

test("member WITHOUT EDIT_CONNECTIONS → skips team vault, falls to personal", async () => {
  useVaultStore.setState({ selectedVaultIds: ["team-1"], vaults: [] } as never);
  useTeamStore.setState({
    teams: [{ id: "team-1", role_ids: ["r1"] }],
    membersByTeam: { "team-1": [member("me", ["r1"])] },
    rolesByTeam: { "team-1": [role("r1", PERM_BITS.VIEW_SECRETS)] }, // no EDIT_CONNECTIONS
  } as never);
  const { result } = renderHook(() => useDefaultVaultId());
  await waitFor(() => expect(h.getMyUserId).toHaveBeenCalled());
  expect(result.current).toBe("personal");
});

test("optimistic while members not loaded: privileged builtin role in team.role_ids → team id", async () => {
  useVaultStore.setState({ selectedVaultIds: ["team-1"], vaults: [] } as never);
  useTeamStore.setState({
    teams: [{ id: "team-1", role_ids: ["owner-role"] }],
    membersByTeam: {}, // NOT loaded
    rolesByTeam: { "team-1": [role("owner-role", 0, "owner", true)] },
  } as never);
  const { result } = renderHook(() => useDefaultVaultId());
  await waitFor(() => expect(result.current).toBe("team-1"));
});

test("optimistic while roles not loaded (roles.length===0) → team id", async () => {
  useVaultStore.setState({ selectedVaultIds: ["team-1"], vaults: [] } as never);
  useTeamStore.setState({
    teams: [{ id: "team-1", role_ids: [] }],
    membersByTeam: {},
    rolesByTeam: { "team-1": [] },
  } as never);
  const { result } = renderHook(() => useDefaultVaultId());
  await waitFor(() => expect(result.current).toBe("team-1"));
});
