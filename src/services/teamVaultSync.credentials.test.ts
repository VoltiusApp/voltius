import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  listTeamObjects: vi.fn(),
  hydrateTeamVaultSecrets: vi.fn(),
  backfillExistingTeamVaultSecrets: vi.fn(),
  checkAndRotateTeamKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamObjects", () => ({ listTeamObjects: h.listTeamObjects }));
vi.mock("@/services/teamVaultSecrets", () => ({
  hydrateTeamVaultSecrets: h.hydrateTeamVaultSecrets,
  backfillExistingTeamVaultSecrets: h.backfillExistingTeamVaultSecrets,
}));
vi.mock("@/services/teamKeyRotation", () => ({
  checkAndRotateTeamKey: h.checkAndRotateTeamKey,
}));

import { fetchTeamData, clearTeamKeyCache } from "./teamVaultSync";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";

const HOST = {
  object_id: "c1",
  object_type: "connection" as const,
  metadata: { id: "c1", name: "web", host: "10.0.0.1", port: 22, username: "root", tags: [] },
  updated_by: "u1",
  updated_at: new Date().toISOString(),
  deleted_at: null,
};

function futureJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = btoa(JSON.stringify({ exp })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `h.${b64}.s`;
}

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) => {
    if (cmd === "keychain_get") return ({ server_url: "https://s", jwt: futureJwt() } as Record<string, string>)[args.key] ?? null;
    return null;
  });
  h.appFetch.mockReset();
  h.listTeamObjects.mockReset().mockResolvedValue([HOST]);
  h.hydrateTeamVaultSecrets.mockReset().mockResolvedValue(undefined);
  h.backfillExistingTeamVaultSecrets.mockReset().mockResolvedValue(undefined);
  h.checkAndRotateTeamKey.mockReset().mockResolvedValue(undefined);
  useTeamVaultStateStore.getState().clearAll();
  clearTeamKeyCache();
});

// The hosts come back as plaintext metadata, so the vault looks complete right
// up until the member presses connect and authentication fails (issue #190).
test("a failed credential hydration is recorded, not swallowed", async () => {
  h.hydrateTeamVaultSecrets.mockRejectedValue("forbidden");

  await fetchTeamData("t1");

  const state = useTeamVaultStateStore.getState();
  expect(state.statusByTeamId["t1"]).toBe("loaded");
  expect(state.credentialsUnavailableByTeamId["t1"]).toBe(true);
});

test("a successful hydration clears the warning", async () => {
  h.hydrateTeamVaultSecrets.mockRejectedValueOnce("forbidden");
  await fetchTeamData("t1");
  expect(useTeamVaultStateStore.getState().credentialsUnavailableByTeamId["t1"]).toBe(true);

  await fetchTeamData("t1");

  expect(useTeamVaultStateStore.getState().credentialsUnavailableByTeamId["t1"]).toBe(false);
});

// A key_mismatch is not a permission gap — a stale wrap this device's own
// identity can't open — so a plain retry never helps. Only a rotation can.
test("key_mismatch requests a rotation and clears once the retry succeeds", async () => {
  h.hydrateTeamVaultSecrets
    .mockRejectedValueOnce("key_mismatch")
    .mockResolvedValueOnce(undefined);

  await fetchTeamData("t1");

  expect(h.checkAndRotateTeamKey).toHaveBeenCalledWith("t1", { force: true });
  expect(h.hydrateTeamVaultSecrets).toHaveBeenCalledTimes(2);
  expect(useTeamVaultStateStore.getState().credentialsUnavailableByTeamId["t1"]).toBeFalsy();
});

// A no-op rotation (caller lacks COPY_SECRETS) still leaves the banner up,
// from the retry's own failure.
test("key_mismatch still reports unavailable when the rotation cannot fix it", async () => {
  h.hydrateTeamVaultSecrets.mockRejectedValue("key_mismatch");

  await fetchTeamData("t1");

  expect(h.checkAndRotateTeamKey).toHaveBeenCalledTimes(1);
  expect(useTeamVaultStateStore.getState().credentialsUnavailableByTeamId["t1"]).toBe(true);
});

// Without this guard, a mismatch a rotation can't fix would re-trigger a full
// rewrap-and-drain pass on every refresh, forever.
test("key_mismatch only attempts a rotation once per team per session", async () => {
  h.hydrateTeamVaultSecrets.mockRejectedValue("key_mismatch");

  await fetchTeamData("t1");
  await fetchTeamData("t1");

  expect(h.checkAndRotateTeamKey).toHaveBeenCalledTimes(1);
});

test("a plain forbidden failure never requests a rotation", async () => {
  h.hydrateTeamVaultSecrets.mockRejectedValue("forbidden");

  await fetchTeamData("t1");

  expect(h.checkAndRotateTeamKey).not.toHaveBeenCalled();
});
