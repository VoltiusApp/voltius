import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  read: vi.fn(), write: vi.fn(), remove: vi.fn(),
  enqueue: vi.fn(), resolve: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/teamObjectPersistence", () => ({
  removeTeamVaultObject: vi.fn(async () => {}),
  saveTeamVaultObject: vi.fn(async () => {}),
}));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/secretRouting", () => ({
  readSecretAt: h.read, writeSecretAt: h.write, removeSecretAt: h.remove,
  teamIdOfVault: (v: string | null | undefined) => (v?.startsWith("team") ? v : null),
}));
vi.mock("@/stores/pendingTeamSecretUploadStore", () => ({
  usePendingTeamSecretUploadStore: { getState: () => ({ enqueue: h.enqueue, resolve: h.resolve }) },
}));

import { useConnectionStore } from "./connectionStore";
import { useKeyStore } from "./keyStore";
import { useIdentityStore } from "./identityStore";
import { useTeamStore } from "./teamStore";
import { useHistoryStore } from "./historyStore";
import type { Connection, SshKey, Identity } from "@/types";

const TEAM = "team-1";
const t0 = "2026-01-01T00:00:00Z";
const stamp = { created_at: t0, updated_at: t0, clocks: { created_at: t0, updated_at: t0 } };

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockImplementation(async (cmd: string, args?: { id: string; data: object }) =>
    cmd.endsWith("_list") ? [] : { id: args?.id, ...args?.data, ...stamp });
  h.read.mockImplementation(async (teamId: string | null, key: string) => (teamId === TEAM ? `v:${key}` : null));
  h.write.mockResolvedValue(undefined);
  h.remove.mockResolvedValue(undefined);
  useTeamStore.setState({ teams: [{ id: TEAM, name: "T" }] as never });
  useConnectionStore.setState({ connections: [], teamConnections: {} });
  useKeyStore.setState({ keys: [], teamKeys: {} });
  useIdentityStore.setState({ identities: [], teamIdentities: {} });
  useHistoryStore.setState({ past: [], future: [], bypassing: false, suppressing: false, suppressDepth: 0 });
});

const conn = { id: "c1", host: "h", port: 22, username: "u", auth_type: "password", tags: [], vault_id: "personal", last_used_at: null, ...stamp } as Connection;
const key = { id: "k1", name: "k", key_type: "ed25519", tags: [], vault_id: "personal", ...stamp } as SshKey;
const identity = { id: "i1", name: "i", username: "u", tags: [], vault_id: "personal", ...stamp } as Identity;

const cases = [
  {
    kind: "connection", secret: "password:c1",
    seed: () => useConnectionStore.setState({ connections: [conn] }),
    update: (vault_id: string, name = "h") => useConnectionStore.getState().updateConnection("c1", { host: "h", port: 22, username: "u", tags: [], vault_id, name }),
  },
  {
    kind: "key", secret: "key:k1:private",
    seed: () => useKeyStore.setState({ keys: [key] }),
    update: (vault_id: string, name = "k") => useKeyStore.getState().updateKey("k1", { name, key_type: "ed25519", tags: [], vault_id }),
  },
  {
    kind: "identity", secret: "identity:i1:password",
    seed: () => useIdentityStore.setState({ identities: [identity] }),
    update: (vault_id: string, name = "i") => useIdentityStore.getState().updateIdentity("i1", { name, username: "u", tags: [], vault_id }),
  },
];

test.each(cases)("undo and redo of a cross-vault $kind edit move its secrets with it", async ({ secret, seed, update }) => {
  seed();
  await update(TEAM);

  await useHistoryStore.getState().undo();
  expect(h.write).toHaveBeenCalledWith(null, secret, `v:${secret}`);
  expect(h.remove).toHaveBeenCalledWith(TEAM, secret);

  h.read.mockImplementation(async (teamId: string | null, k: string) => (teamId === null ? `v:${k}` : null));
  h.write.mockClear();
  await useHistoryStore.getState().redo();
  expect(h.enqueue).toHaveBeenCalledWith(TEAM, expect.arrayContaining([secret]));
  expect(h.write).toHaveBeenCalledWith(TEAM, secret, `v:${secret}`);
  expect(h.remove).toHaveBeenCalledWith(null, secret);
});

test.each(cases)("a same-vault $kind undo transfers nothing", async ({ seed, update }) => {
  seed();
  await update("personal", "renamed");

  await useHistoryStore.getState().undo();
  expect(h.read).not.toHaveBeenCalled();
  expect(h.write).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.enqueue).not.toHaveBeenCalled();
});
