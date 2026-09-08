import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  deleted: [] as string[],
}));

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  deleteSecret: vi.fn(async (k: string) => {
    h.deleted.push(k);
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

// The removal path re-reads the team list to compute the membership delta; an
// empty list is what "you were removed from t1" looks like on the wire.
vi.mock("@/services/teamService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/teamService")>()),
  listTeams: vi.fn(async () => []),
}));

vi.mock("@/services/teamDataManager", () => ({
  refreshAwaitingKeyTeams: vi.fn(async () => {}),
  joinAndLoadTeamVault: vi.fn(async () => {}),
  onTeamLogin: vi.fn(async () => {}),
}));

import { clearTeamStoresAndSecrets } from "./teamVaultSync";
import { handleRealtimeEvent } from "./sync";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useTeamStore } from "@/stores/teamStore";

beforeEach(() => {
  h.deleted = [];
  useConnectionStore.setState({ teamConnections: {} });
  useKeyStore.setState({ teamKeys: {} });
  useIdentityStore.setState({ teamIdentities: {} });
  useTeamStore.setState({ teams: [] });
});

function seedTeamObjects(): void {
  useConnectionStore.setState({
    teamConnections: { t1: [{ id: "c1", name: "web", host: "h", port: 22 } as never] },
  });
  useKeyStore.setState({ teamKeys: { t1: [{ id: "k1", name: "deploy" } as never] } });
  useIdentityStore.setState({ teamIdentities: { t1: [{ id: "i1", name: "root" } as never] } });
}

test("deletes every team secret from the keychain and empties the stores", async () => {
  seedTeamObjects();

  await clearTeamStoresAndSecrets("t1");

  expect(h.deleted).toEqual(
    expect.arrayContaining([
      "password:c1",
      "passphrase:c1",
      "key:c1",
      "key:k1:private",
      "key:k1:public",
      "key:k1:passphrase",
      "identity:i1:password",
    ]),
  );
  expect(useConnectionStore.getState().teamConnections.t1 ?? []).toEqual([]);
  expect(useKeyStore.getState().teamKeys.t1 ?? []).toEqual([]);
  expect(useIdentityStore.getState().teamIdentities.t1 ?? []).toEqual([]);
});

test("deletes nothing when the stores were already emptied first", async () => {
  // The wipe builds its keys from the object IDs, so empty stores mean nothing
  // to delete. This pins that shape; the caller's ordering is covered below.
  await clearTeamStoresAndSecrets("t1");

  expect(h.deleted).toEqual([]);
});

test("wipes the keychain before onTeamRemoved empties the stores", async () => {
  // The wipe derives its keychain keys from the object IDs held in the stores,
  // so onTeamRemoved must call it while those stores are still populated. The
  // two tests above exercise clearTeamStoresAndSecrets in isolation and pass
  // against either ordering; this one drives the real removal path (#216).
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [] } as never] });
  seedTeamObjects();

  await handleRealtimeEvent("membership_changed", "device-1");

  // The handler kicks the membership delta off without awaiting it, so the
  // removal lands a few ticks after the event returns.
  await vi.waitFor(() =>
    expect(h.deleted).toEqual(
      expect.arrayContaining(["password:c1", "key:k1:private", "identity:i1:password"]),
    ),
  );
  expect(useConnectionStore.getState().teamConnections.t1 ?? []).toEqual([]);
});
