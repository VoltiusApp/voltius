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

import { clearTeamStoresAndSecrets } from "./teamVaultSync";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";

beforeEach(() => {
  h.deleted = [];
  useConnectionStore.setState({ teamConnections: {} });
  useKeyStore.setState({ teamKeys: {} });
  useIdentityStore.setState({ teamIdentities: {} });
});

test("deletes every team secret from the keychain and empties the stores", async () => {
  useConnectionStore.setState({
    teamConnections: { t1: [{ id: "c1", name: "web", host: "h", port: 22 } as never] },
  });
  useKeyStore.setState({ teamKeys: { t1: [{ id: "k1", name: "deploy" } as never] } });
  useIdentityStore.setState({ teamIdentities: { t1: [{ id: "i1", name: "root" } as never] } });

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
  // Guards the ordering: the wipe builds its keys from the object IDs, so
  // clearing memory before it runs silently loses them (#216).
  await clearTeamStoresAndSecrets("t1");

  expect(h.deleted).toEqual([]);
});
