import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  deleted: [] as string[],
  failing: new Set<string>(),
  notWiped: [] as string[],
  departures: new Map<string, string>(),
  ownershipThrowsFor: new Set<string>(),
  linkedVaults: [] as { id: string; teamId: string }[],
}));

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  purgeLocalSecrets: vi.fn(async (keys: string[]) => {
    if (keys.some((k) => h.failing.has(k))) throw new Error("keychain unavailable");
    h.deleted.push(...keys);
    return keys;
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

vi.mock("@/services/teamSecretOwnership", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/teamSecretOwnership")>();
  return {
    ...real,
    teamObjectSecretKeys: (tid: string) => {
      if (h.ownershipThrowsFor.has(tid)) throw new Error("store blew up");
      return real.teamObjectSecretKeys(tid);
    },
  };
});

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
// why-did-this-team-go answer matters here, and an unmarked team is a kick.
vi.mock("@/services/teamOffboarding", () => ({
  selfDeparture: vi.fn((tid: string) => h.departures.get(tid)),
}));

vi.mock("@/services/teamInbox", () => ({
  notifyMembershipEnded: vi.fn(),
  notifySecretsNotWiped: vi.fn((teamId: string, teamName: string) => {
    h.notWiped.push(`${teamId}/${teamName}`);
  }),
}));

// Stand-in for "any later offboarding step throws": unlinking the team's local vault fails.
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: {
    getState: () => ({
      vaults: h.linkedVaults,
      setVaultTeamId: () => {
        throw new Error("vaultStore blew up");
      },
    }),
  },
}));

import { handleRealtimeEvent } from "./sync";
import { teamSecretCache } from "@/services/teamSecretCache";
import { usePendingSecretWipeStore } from "@/stores/pendingSecretWipeStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useTeamStore } from "@/stores/teamStore";
import { notifyMembershipEnded, notifySecretsNotWiped } from "@/services/teamInbox";

beforeEach(() => {
  h.deleted = [];
  h.failing = new Set();
  h.notWiped = [];
  h.departures = new Map();
  h.ownershipThrowsFor = new Set();
  vi.mocked(notifyMembershipEnded).mockClear();
  vi.mocked(notifySecretsNotWiped).mockClear();
  usePendingSecretWipeStore.getState().clearAll();
  useTeamStore.setState({ teams: [] });
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
  h.linkedVaults.push({ id: `v-${tid}`, teamId: tid });
  useTeamStore.setState((s) => ({
    teams: [...s.teams, { id: tid, name: `team-${tid}`, role_ids: [] } as never],
  }));
  useConnectionStore.setState((s) => ({
    teamConnections: {
      ...s.teamConnections,
      [tid]: [{ id: `c-${tid}`, name: "web", host: "h", port: 22 } as never],
    },
  }));
  useKeyStore.setState((s) => ({
    teamKeys: { ...s.teamKeys, [tid]: [{ id: `k-${tid}`, name: "deploy" } as never] },
  }));
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
    expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({
      t2: expect.arrayContaining([
        "password:c-t2", "key:c-t2", "passphrase:c-t2", "proxy_password:c-t2",
        "key:k-t2:private", "key:k-t2:public", "key:k-t2:passphrase",
      ]),
    });
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

test("a team this client deleted as owner is not offboarded at all", async () => {
  // Make-private deletes the team and re-adopts its objects locally under the
  // same ids, so the wipe would name the user's own live credentials and the
  // notice would announce a removal that never happened (#249).
  //
  // ctl is the control: both removals start in the same tick, and the marked
  // team's path is strictly shorter than the wipe, so the control's deletes
  // landing means an unsuppressed wipe of t4 would already have landed too.
  seedTeam("t4");
  seedTeam("ctl");
  h.departures.set("t4", "self-deleted");

  await handleRealtimeEvent("membership_changed", "device-1");

  await vi.waitFor(() => expect(h.deleted).toContain("password:c-ctl"));
  expect(h.deleted.filter((k) => k.includes("t4"))).toEqual([]);
  expect(notifyMembershipEnded).toHaveBeenCalledTimes(1);
  expect(notifyMembershipEnded).toHaveBeenCalledWith("team-ctl");
});

test("a voluntary leave still wipes, and only the notice is suppressed", async () => {
  seedTeam("t5");
  h.departures.set("t5", "leave");

  await handleRealtimeEvent("membership_changed", "device-1");

  await vi.waitFor(() => expect(h.deleted).toContain("password:c-t5"));
  expect(notifyMembershipEnded).not.toHaveBeenCalled();
});

test("a wipe that throws still leaves the removed member without the team's cached secrets", async () => {
  seedTeam("t6");
  h.ownershipThrowsFor.add("t6");
  teamSecretCache.set("t6", "password:c-t6", "pw");

  await handleRealtimeEvent("membership_changed", "device-1");

  await vi.waitFor(() => expect(notifyMembershipEnded).toHaveBeenCalledWith("team-t6"));
  expect(teamSecretCache.get("t6", "password:c-t6")).toBeUndefined();
});
