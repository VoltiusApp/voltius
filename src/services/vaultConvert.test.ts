import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  createTeam: vi.fn(async (name: string) => ({ id: "team-1", name, owner_id: "u1", owner_tier: "pro", created_at: "", role_ids: [] })),
  deleteTeam: vi.fn(async () => {}),
  migrateVaultToTeam: vi.fn(async () => {}),
  initTeamVaultKey: vi.fn(async () => {}),
  invoke: vi.fn(async () => null),
  addToast: vi.fn(() => "toast-1"),
  updateToast: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/teamService", () => ({ createTeam: h.createTeam, deleteTeam: h.deleteTeam }));
vi.mock("@/services/vaultTeamMigration", () => ({ migrateVaultToTeam: h.migrateVaultToTeam }));
vi.mock("@/services/teamVaultSync", () => ({ initTeamVaultKey: h.initTeamVaultKey }));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast: h.addToast, updateToast: h.updateToast }) },
}));

import { convertVaultToTeam } from "./vaultConvert";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";

const VAULT = "vault-1";

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaults: [{ id: VAULT, name: "Ops" }] });
  useTeamStore.setState({ teams: [], activeTeamId: null });
  useTeamVaultStateStore.setState({ status: {} } as never);
});

test("conversion links the vault and initialises the key", async () => {
  const teamId = await convertVaultToTeam(VAULT, "Ops");

  expect(teamId).toBe("team-1");
  expect(useVaultStore.getState().vaults[0].teamId).toBe("team-1");
  expect(h.initTeamVaultKey).toHaveBeenCalledWith("team-1", []);
});

test("carries the vault's existing contents into the new team vault", async () => {
  await convertVaultToTeam(VAULT, "Ops");

  expect(h.migrateVaultToTeam).toHaveBeenCalledWith(VAULT, "team-1");
});

test("initialises the team key before uploading anything to it", async () => {
  await convertVaultToTeam(VAULT, "Ops");

  expect(h.initTeamVaultKey.mock.invocationCallOrder[0])
    .toBeLessThan(h.migrateVaultToTeam.mock.invocationCallOrder[0]);
});

test("a failed migration leaves the vault private instead of half-converted", async () => {
  h.migrateVaultToTeam.mockRejectedValueOnce(new Error("upload failed"));

  await expect(convertVaultToTeam(VAULT, "Ops")).rejects.toThrow("upload failed");

  expect(useVaultStore.getState().vaults[0].teamId).toBeUndefined();
  expect(useTeamStore.getState().teams).toHaveLength(0);
  expect(h.deleteTeam).toHaveBeenCalledWith("team-1");
});

test("a failed key init surfaces rather than leaving a silent half-conversion", async () => {
  h.initTeamVaultKey.mockRejectedValueOnce(new Error("no key"));

  await expect(convertVaultToTeam(VAULT, "Ops")).rejects.toThrow("no key");

  expect(h.migrateVaultToTeam).not.toHaveBeenCalled();
  expect(useVaultStore.getState().vaults[0].teamId).toBeUndefined();
});

test("a team the server refuses to delete still leaves the vault private", async () => {
  h.migrateVaultToTeam.mockRejectedValueOnce(new Error("upload failed"));
  h.deleteTeam.mockRejectedValueOnce(new Error("500"));

  await expect(convertVaultToTeam(VAULT, "Ops")).rejects.toThrow("upload failed");

  expect(useVaultStore.getState().vaults[0].teamId).toBeUndefined();
});
