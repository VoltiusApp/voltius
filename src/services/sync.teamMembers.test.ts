import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  reconcileTeamVaultKeys: vi.fn(async () => {}),
  checkAndRotateTeamKey: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

// The team_members: branch reloads teams/members/roles/pending-invitations
// through the real teamStore actions; stubbing the underlying teamService
// calls (rather than the store) keeps that reload harmless without having to
// re-mock every store action.
vi.mock("@/services/teamService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/teamService")>()),
  listTeams: vi.fn(async () => []),
  listMembers: vi.fn(async () => []),
  listRoles: vi.fn(async () => []),
  listPendingInvitations: vi.fn(async () => []),
}));

vi.mock("@/services/teamVaultSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/teamVaultSync")>()),
  reconcileTeamVaultKeys: h.reconcileTeamVaultKeys,
}));

vi.mock("@/services/teamKeyRotation", () => ({
  checkAndRotateTeamKey: h.checkAndRotateTeamKey,
}));

import { handleRealtimeEvent } from "./sync";

beforeEach(() => {
  h.reconcileTeamVaultKeys.mockClear();
  h.checkAndRotateTeamKey.mockClear();
});

test("a team_members event checks for a DEK rotation alongside key reconciliation", async () => {
  await handleRealtimeEvent("team_members:t1", "device-1");

  expect(h.reconcileTeamVaultKeys).toHaveBeenCalledWith("t1");
  expect(h.checkAndRotateTeamKey).toHaveBeenCalledWith("t1");
});
