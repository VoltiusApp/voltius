import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  listTeamObjects: vi.fn(),
  hydrateTeamVaultSecrets: vi.fn(),
  backfillExistingTeamVaultSecrets: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamObjects", () => ({ listTeamObjects: h.listTeamObjects }));
vi.mock("@/services/teamVaultSecrets", () => ({
  hydrateTeamVaultSecrets: h.hydrateTeamVaultSecrets,
  backfillExistingTeamVaultSecrets: h.backfillExistingTeamVaultSecrets,
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
