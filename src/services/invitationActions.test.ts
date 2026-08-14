import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  accept: vi.fn(async () => {}),
  decline: vi.fn(async () => {}),
  loadTeams: vi.fn(async () => {}),
  loadMyPendingInvitations: vi.fn(async () => {}),
  joinAndLoadTeamVault: vi.fn(async () => {}),
}));

vi.mock("@/services/teamService", () => ({
  acceptMyPendingInvitation: h.accept,
  declineMyPendingInvitation: h.decline,
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: {
    getState: () => ({
      loadTeams: h.loadTeams,
      loadMyPendingInvitations: h.loadMyPendingInvitations,
    }),
  },
}));
vi.mock("@/services/teamDataManager", () => ({
  joinAndLoadTeamVault: h.joinAndLoadTeamVault,
}));

import { acceptInvitation, declineInvitation } from "./invitationActions";

beforeEach(() => {
  h.accept.mockClear();
  h.decline.mockClear();
  h.loadTeams.mockClear();
  h.loadMyPendingInvitations.mockClear();
  h.joinAndLoadTeamVault.mockClear();
});

test("acceptInvitation joins the vault directly rather than waiting for the membership event", async () => {
  await acceptInvitation("inv1", "team1");
  expect(h.accept).toHaveBeenCalledWith("inv1");
  expect(h.joinAndLoadTeamVault).toHaveBeenCalledWith("team1");
  expect(h.loadTeams).toHaveBeenCalled();
  expect(h.loadMyPendingInvitations).toHaveBeenCalled();
});

test("acceptInvitation accepts before loading, so a failed accept does not reload state", async () => {
  h.accept.mockRejectedValueOnce(new Error("409"));
  await expect(acceptInvitation("inv1", "team1")).rejects.toThrow("409");
  expect(h.loadTeams).not.toHaveBeenCalled();
  expect(h.joinAndLoadTeamVault).not.toHaveBeenCalled();
});

test("declineInvitation reloads the pending list and never touches the vault", async () => {
  await declineInvitation("inv1");
  expect(h.decline).toHaveBeenCalledWith("inv1");
  expect(h.loadMyPendingInvitations).toHaveBeenCalled();
  expect(h.joinAndLoadTeamVault).not.toHaveBeenCalled();
});
