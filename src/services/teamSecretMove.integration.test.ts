import { test, expect, vi, beforeEach } from "vitest";
import type { Connection, ConnectionFormData } from "@/types";

const h = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  serverUrl: "https://s" as string | null,
  uploaded: new Map<string, string>(),
  uploadError: null as unknown,
  teamRows: [] as unknown[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: { key: string; keys: string[]; value: string }) => {
    switch (cmd) {
      case "secrets_get": return h.disk.get(args.key) ?? null;
      case "secrets_set": h.disk.set(args.key, args.value); return null;
      case "secrets_delete": h.disk.delete(args.key); return null;
      case "secrets_purge": return args.keys.filter((k) => h.disk.delete(k));
      default: return null;
    }
  }),
}));
vi.mock("@/services/authTokens", async (orig) => ({
  ...(await orig<typeof import("@/services/authTokens")>()),
  getServerUrl: vi.fn(async () => h.serverUrl),
}));
vi.mock("@/services/teamObjects", async (orig) => ({
  ...(await orig<typeof import("@/services/teamObjects")>()),
  listTeamObjects: vi.fn(async () => h.teamRows),
  deleteTeamSecret: vi.fn(async () => {}),
}));
vi.mock("@/services/teamVaultSecrets", async (orig) => ({
  ...(await orig<typeof import("@/services/teamVaultSecrets")>()),
  hydrateTeamVaultSecrets: vi.fn(async () => {}),
  saveTeamVaultSecret: vi.fn(async (_t: string, key: string, value: string) => {
    if (h.uploadError) throw h.uploadError;
    h.uploaded.set(key, value);
  }),
}));
vi.mock("@/services/teamObjectReencrypt", () => ({ runReencryptionPass: vi.fn(async () => {}) }));

import { fetchTeamData } from "./teamVaultSync";
import { moveConnectionToVault } from "./connectionDuplicate";
import { getSecret, setVaultKey, storeSecret } from "./vault";
import { teamSecretCache } from "./teamSecretCache";
import { useConnectionStore } from "@/stores/connectionStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { usePendingTeamSecretUploadStore } from "@/stores/pendingTeamSecretUploadStore";
import { usePendingSecretWipeStore } from "@/stores/pendingSecretWipeStore";

const HOST = { id: "c1", name: "web", host: "10.0.0.1", port: 22, username: "root", tags: [] } as unknown as Connection;
const teamRow = (metadata: object) => ({
  object_id: "c1", object_type: "connection", metadata, updated_by: "u1",
  updated_at: new Date().toISOString(), deleted_at: null,
});

async function moveToTeamVault(conn: Connection, data: ConnectionFormData, keepLocalRow = false) {
  const moved = { ...conn, ...data } as Connection;
  useConnectionStore.setState({ connections: keepLocalRow ? [moved] : [], teamConnections: { t1: [moved] } });
  h.teamRows = [teamRow(moved)];
}

beforeEach(() => {
  h.disk.clear();
  h.uploaded.clear();
  h.uploadError = null;
  h.serverUrl = "https://s";
  h.teamRows = [];
  setVaultKey([1]);
  teamSecretCache.clearAll();
  usePendingTeamSecretUploadStore.getState().clearAll();
  usePendingSecretWipeStore.getState().clearAll();
  useTeamVaultStateStore.getState().clearAll();
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [] } as never] });
  useVaultStore.setState({ vaults: [{ id: "v-team", name: "Ops", teamId: "t1" } as never] });
  useConnectionStore.setState({ connections: [{ ...HOST, vault_id: "personal" }], teamConnections: {} });
});

test("a failed upload survives an offline load and is uploaded by the next good one, never purged", async () => {
  h.disk.set("password:c1", "pw");
  h.uploadError = new Error("429");

  await moveConnectionToVault({ ...HOST, vault_id: "personal" }, "v-team", async (_id, data) =>
    moveToTeamVault(HOST, data));

  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId.t1).toEqual(["password:c1"]);
  expect(h.disk.get("password:c1")).toBe("pw");

  h.serverUrl = null;
  await fetchTeamData("t1");

  expect(useTeamVaultStateStore.getState().statusByTeamId.t1).toBe("offline");
  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId.t1).toEqual(["password:c1"]);
  expect(h.disk.get("password:c1")).toBe("pw");
  expect(await getSecret("password:c1")).toBe("pw");

  h.serverUrl = "https://s";
  h.uploadError = null;
  await fetchTeamData("t1");

  expect(useTeamVaultStateStore.getState().statusByTeamId.t1).toBe("loaded");
  expect(h.uploaded.get("password:c1")).toBe("pw");
  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId.t1).toBeUndefined();
  expect(await getSecret("password:c1")).toBe("pw");
});

test("a foreground offline load keeps the pending queue and the local copy", async () => {
  await moveToTeamVault(HOST, {} as ConnectionFormData);
  h.disk.set("password:c1", "pw");
  h.disk.set("key:c1", "team-only");
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.serverUrl = null;

  await fetchTeamData("t1");

  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId.t1).toEqual(["password:c1"]);
  expect(h.disk.get("password:c1")).toBe("pw");
  expect(h.disk.has("key:c1")).toBe(false);
});

test("the owner still reads and edits a moved host's secret while its local row stays behind", async () => {
  h.disk.set("password:c1", "pw");

  await moveConnectionToVault({ ...HOST, vault_id: "personal" }, "v-team", async (_id, data) =>
    moveToTeamVault(HOST, data, true));

  expect(useConnectionStore.getState().connections[0].vault_id).toBe("v-team");
  expect(h.uploaded.get("password:c1")).toBe("pw");
  expect(h.disk.has("password:c1")).toBe(false);
  expect(await getSecret("password:c1")).toBe("pw");

  await storeSecret("password:c1", "pw2");
  expect(h.uploaded.get("password:c1")).toBe("pw2");
  expect(h.disk.has("password:c1")).toBe(false);
});

test("the sweep uploads a queued secret of a moved host whose local row stays behind", async () => {
  h.disk.set("password:c1", "pw");
  h.uploadError = new Error("429");

  await moveConnectionToVault({ ...HOST, vault_id: "personal" }, "v-team", async (_id, data) =>
    moveToTeamVault(HOST, data, true));
  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId.t1).toEqual(["password:c1"]);

  h.uploadError = null;
  await fetchTeamData("t1");

  expect(h.uploaded.get("password:c1")).toBe("pw");
  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId.t1).toBeUndefined();
  expect(h.disk.has("password:c1")).toBe(false);
  expect(await getSecret("password:c1")).toBe("pw");
});
