import { test, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "keychain_get" ? "https://mock.example" : null)),
}));

const h = vi.hoisted(() => ({
  list: async (): Promise<unknown[]> => [],
  routes: {} as Record<string, number>,
  bodies: {} as Record<string, unknown>,
}));
vi.mock("@/services/teamObjects", async (orig) => ({
  ...(await orig<typeof import("@/services/teamObjects")>()),
  listTeamObjects: vi.fn(() => h.list()),
}));
vi.mock("@/services/authFetch", () => ({
  fetchAuthRateLimited: vi.fn(async (url: string) => {
    const suffix = Object.keys(h.routes).find((s) => url.endsWith(s));
    const status = suffix ? h.routes[suffix] : 404;
    return { ok: status < 300, status, json: async () => (suffix ? (h.bodies[suffix] ?? {}) : {}) };
  }),
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: { getState: () => ({ teams: [{ id: "t1" }], rolesByTeam: { t1: [] } }) },
}));
vi.mock("@/services/teamService", async (orig) => ({
  ...(await orig<typeof import("@/services/teamService")>()),
  getUserPublicKey: vi.fn(async () => ({ public_key: "pk" })),
}));
vi.mock("@/services/multiplayerService", () => ({
  unwrapSessionKey: vi.fn(async () => new Uint8Array([1, 2, 3])),
  wrapSessionKeyForUser: vi.fn(),
  publishMyPublicKey: vi.fn(),
}));

import { fetchTeamData, clearTeamKeyCache } from "./teamVaultSync";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { objectAccess } from "@/stores/teamObjectAccessStore";

beforeEach(() => {
  clearTeamKeyCache();
  h.list = async () => [];
  h.routes = {};
  h.bodies = {};
  useTeamVaultStateStore.setState({ statusByTeamId: {}, errorByTeamId: {} });
});

test("an empty object list plus a 403 blob shows an empty vault, not the error panel", async () => {
  h.list = async () => [];
  h.routes = { "/vault-key": 403, "/sync-blob": 403 };
  await fetchTeamData("t1");
  expect(useTeamVaultStateStore.getState().statusByTeamId.t1).toBe("loaded");
});

test("a 403 blob reached directly (vault key succeeds) also shows loaded", async () => {
  h.list = async () => [];
  h.routes = { "/vault-key": 200, "/sync-blob": 403 };
  h.bodies = { "/vault-key": { wrapped_key: "wk", wrapped_by_user_id: "u1", key_version: 1 } };
  await fetchTeamData("t1");
  expect(useTeamVaultStateStore.getState().statusByTeamId.t1).toBe("loaded");
});

test("a 426 on the object list shows update_required", async () => {
  h.list = async () => {
    throw Object.assign(new Error("old"), { status: 426 });
  };
  await fetchTeamData("t1");
  expect(useTeamVaultStateStore.getState().statusByTeamId.t1).toBe("update_required");
});

test("a 426 on the vault key after a fallback shows update_required", async () => {
  h.list = async () => {
    throw Object.assign(new Error("boom"), { status: 500 });
  };
  h.routes = { "/vault-key": 426 };
  await fetchTeamData("t1");
  expect(useTeamVaultStateStore.getState().statusByTeamId.t1).toBe("update_required");
});

test("hydrate records my_permissions and the parent; clearing the team drops them", async () => {
  h.list = async () => [{
    object_id: "c1", object_type: "connection", metadata: { id: "c1", folder_id: "f1" },
    updated_at: "", updated_by: "u", rule_set_id: "s1", my_permissions: 5,
  }];
  await fetchTeamData("t1");
  expect(objectAccess("t1", "c1")).toMatchObject({ myPermissions: 5, ruleSetId: "s1", parentId: "f1" });
  const { clearTeamStoresAndSecrets } = await import("./teamVaultSync");
  await clearTeamStoresAndSecrets("t1");
  expect(objectAccess("t1", "c1")).toBeUndefined();
});
