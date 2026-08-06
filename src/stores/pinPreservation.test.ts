import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/teamObjectPersistence", () => ({
  removeTeamVaultObject: vi.fn(async () => {}),
  saveTeamVaultObject: vi.fn(async () => {}),
}));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: vi.fn() }));

import { useKeyStore } from "./keyStore";
import { useIdentityStore } from "./identityStore";
import { useConnectionStore } from "./connectionStore";
import { useTeamStore } from "./teamStore";

/** key_update/identity_update/connection_update all assign `pinned = data.pinned`
 *  outright, so a payload that omits it clears the pin. Vault moves and bulk
 *  actions build partial payloads and none of them carry it. */
const payloadFor = (cmd: string) => h.invoke.mock.calls.find(([c]) => c === cmd)?.[1]?.data;

const base = { vault_id: "personal", pinned: true, created_at: "", updated_at: "", clocks: {} };
const key = { ...base, id: "k1", name: "Deploy", key_type: "ed25519", tags: [] };
const identity = { ...base, id: "i1", name: "root", username: "root", tags: [] };
const connection = { ...base, id: "c1", name: "Web", host: "h", port: 22, username: "u", auth_type: "key", tags: [] };

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockResolvedValue([]);
  useTeamStore.setState({ teams: [] });
  useKeyStore.setState({ keys: [{ ...key } as never], teamKeys: {} });
  useIdentityStore.setState({ identities: [{ ...identity } as never], teamIdentities: {} });
  useConnectionStore.setState({ connections: [{ ...connection } as never], teamConnections: {} });
});

test("moving a pinned key to another vault keeps it pinned", async () => {
  await useKeyStore.getState().updateKey("k1", {
    name: key.name, key_type: key.key_type, tags: [], folder_id: undefined, vault_id: "work",
  });
  expect(payloadFor("key_update")).toHaveProperty("pinned", true);
});

test("an explicit unpin still unpins a key", async () => {
  await useKeyStore.getState().updateKey("k1", {
    name: key.name, key_type: key.key_type, tags: [], vault_id: "personal", pinned: false,
  });
  expect(payloadFor("key_update")).toHaveProperty("pinned", false);
});

test("moving a pinned identity to another vault keeps it pinned", async () => {
  await useIdentityStore.getState().updateIdentity("i1", {
    name: identity.name, username: identity.username, key_id: undefined, tags: [], vault_id: "work",
  });
  expect(payloadFor("identity_update")).toHaveProperty("pinned", true);
});

test("an explicit unpin still unpins an identity", async () => {
  await useIdentityStore.getState().updateIdentity("i1", {
    name: identity.name, username: identity.username, tags: [], vault_id: "personal", pinned: false,
  });
  expect(payloadFor("identity_update")).toHaveProperty("pinned", false);
});

test("moving a pinned connection to another vault keeps it pinned", async () => {
  await useConnectionStore.getState().updateConnection("c1", {
    name: connection.name, host: connection.host, port: connection.port,
    username: connection.username, auth_type: "key", tags: [], vault_id: "work",
  });
  expect(payloadFor("connection_update")).toHaveProperty("pinned", true);
});

test("an explicit unpin still unpins a connection", async () => {
  await useConnectionStore.getState().updateConnection("c1", {
    name: connection.name, host: connection.host, port: connection.port,
    username: connection.username, auth_type: "key", tags: [], vault_id: "personal", pinned: false,
  });
  expect(payloadFor("connection_update")).toHaveProperty("pinned", false);
});

test("an unpinned key is not accidentally pinned by an update", async () => {
  useKeyStore.setState({ keys: [{ ...key, pinned: undefined } as never], teamKeys: {} });
  await useKeyStore.getState().updateKey("k1", {
    name: key.name, key_type: key.key_type, tags: [], vault_id: "personal",
  });
  expect(payloadFor("key_update")?.pinned).toBeUndefined();
});
