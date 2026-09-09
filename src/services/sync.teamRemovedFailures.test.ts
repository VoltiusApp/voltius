import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  deleted: [] as string[],
  failing: new Set<string>(),
  notWiped: [] as string[],
}));

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  deleteSecret: vi.fn(async (k: string) => {
    if (h.failing.has(k)) throw new Error("keychain unavailable");
    h.deleted.push(k);
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

vi.mock("@/services/teamService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/teamService")>()),
  listTeams: vi.fn(async () => []),
}));

vi.mock("@/services/teamDataManager", () => ({
  refreshAwaitingKeyTeams: vi.fn(async () => {}),
  joinAndLoadTeamVault: vi.fn(async () => {}),
  onTeamLogin: vi.fn(async () => {}),
}));

// Its real module graph reaches back into the mocked vault store; only the
// kick-vs-leave answer matters here, and this event is a kick.
vi.mock("@/services/teamOffboarding", () => ({
  departedVoluntarily: vi.fn(() => false),
}));

vi.mock("@/services/teamInbox", () => ({
  notifyMembershipEnded: vi.fn(),
  notifySecretsNotWiped: vi.fn((teamId: string, teamName: string) => {
    h.notWiped.push(`${teamId}/${teamName}`);
  }),
}));

// The step that unlinks local vaults sits between the removal event and the
// rest of the offboarding sequence; a store that throws on read is the
// cheapest stand-in for "anything in here throws".
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: {
    getState: () => {
      throw new Error("vaultStore blew up");
    },
  },
}));

import { handleRealtimeEvent } from "./sync";
import { usePendingSecretWipeStore } from "@/stores/pendingSecretWipeStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useTeamStore } from "@/stores/teamStore";
import { notifySecretsNotWiped } from "@/services/teamInbox";

beforeEach(() => {
  h.deleted = [];
  h.failing = new Set();
  h.notWiped = [];
  vi.mocked(notifySecretsNotWiped).mockClear();
  usePendingSecretWipeStore.getState().clearAll();
  useConnectionStore.setState({ teamConnections: {} });
  useKeyStore.setState({ teamKeys: {} });
  useIdentityStore.setState({ teamIdentities: {} });
});

/**
 * Each test uses its own team id: the removal is deliberately not awaited, so a
 * previous test's sequence can still be in flight and would otherwise land in
 * the next test's stores.
 */
function seedTeam(tid: string): void {
  useTeamStore.setState({ teams: [{ id: tid, name: `team-${tid}`, role_ids: [] } as never] });
  useConnectionStore.setState({
    teamConnections: { [tid]: [{ id: `c-${tid}`, name: "web", host: "h", port: 22 } as never] },
  });
  useKeyStore.setState({ teamKeys: { [tid]: [{ id: `k-${tid}`, name: "deploy" } as never] } });
}

test("wipes the keychain even when a later offboarding step throws", async () => {
  seedTeam("t1");

  await handleRealtimeEvent("membership_changed", "device-1");

  await vi.waitFor(() =>
    expect(h.deleted).toEqual(expect.arrayContaining(["password:c-t1", "key:k-t1:private"])),
  );
});

test("queues and reports the secrets a failed wipe left on the device", async () => {
  seedTeam("t2");
  h.failing = new Set(["password:c-t2"]);

  await handleRealtimeEvent("membership_changed", "device-1");

  await vi.waitFor(() => {
    expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({ t2: ["password:c-t2"] });
    expect(h.notWiped).toEqual(["t2/team-t2"]);
  });
});

test("says nothing when the wipe succeeded", async () => {
  seedTeam("t3");

  await handleRealtimeEvent("membership_changed", "device-1");

  await vi.waitFor(() => expect(h.deleted).toContain("password:c-t3"));
  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({});
  expect(notifySecretsNotWiped).not.toHaveBeenCalled();
});
