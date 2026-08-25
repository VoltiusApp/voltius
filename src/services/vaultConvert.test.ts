import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  createTeam: vi.fn(),
  setVaultTeamId: vi.fn(),
  initTeamVaultKey: vi.fn(),
  markLoaded: vi.fn(),
}));

vi.mock("@/stores/teamStore", () => ({
  useTeamStore: { getState: () => ({ createTeam: h.createTeam }) },
}));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: { getState: () => ({ setVaultTeamId: h.setVaultTeamId }) },
}));
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: { getState: () => ({}) },
}));
vi.mock("@/services/teamVaultSync", () => ({
  initTeamVaultKey: h.initTeamVaultKey,
}));
vi.mock("@/services/teamVaultActivation", () => ({
  markTeamVaultLoadedAfterLocalActivation: h.markLoaded,
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { convertVaultToTeam } from "./vaultConvert";

beforeEach(() => {
  h.createTeam.mockReset();
  h.setVaultTeamId.mockReset();
  h.initTeamVaultKey.mockReset();
});

test("conversion links the vault and initialises the key", async () => {
  h.createTeam.mockResolvedValue({ id: "team-1" });
  h.initTeamVaultKey.mockResolvedValue(undefined);
  const teamId = await convertVaultToTeam("vault-1", "Personal");
  expect(teamId).toBe("team-1");
  expect(h.setVaultTeamId).toHaveBeenCalledWith("vault-1", "team-1");
  expect(h.initTeamVaultKey).toHaveBeenCalledWith("team-1", []);
});

test("a failed key init surfaces rather than leaving a silent half-conversion", async () => {
  h.createTeam.mockResolvedValue({ id: "team-1" });
  h.initTeamVaultKey.mockRejectedValue(new Error("no key"));
  await expect(convertVaultToTeam("vault-1", "Personal")).rejects.toThrow("no key");
});
