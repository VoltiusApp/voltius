// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  listConnections: vi.fn(async () => [] as unknown[]),
  updateConnection: vi.fn(async (id: string, data: object) => ({ id, ...data })),
}));

vi.mock("@/services/teamObjectPersistence", () => ({ saveTeamVaultObject: vi.fn(), removeTeamVaultObject: vi.fn(async () => {}) }));
vi.mock("@/services/connections", () => ({ listConnections: h.listConnections, updateConnection: h.updateConnection }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: vi.fn(async () => false) }));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: vi.fn() }));

import { connectionToFormData, useConnectionStore } from "./connectionStore";
import { useSshConfigStore } from "./sshConfigStore";
import { fingerprint } from "@/services/sshConfig/hostFields";
import type { Connection } from "@/types";

const web = {
  id: "c1", name: "Web", host: "10.0.0.2", port: 22, username: "deploy", auth_type: "key", key_id: "k1", tags: [], vault_id: "personal",
  created_at: "t0", updated_at: "t0", last_used_at: null, clocks: {},
} as unknown as Connection;

beforeEach(() => {
  vi.clearAllMocks();
  h.listConnections.mockImplementation(async () => [web]);
  useConnectionStore.setState({ connections: [web], teamConnections: {} });
  const hash = fingerprint({ alias: "web", hostname: "10.0.0.2", port: 22, user: "deploy", identityFile: "~/.ssh/id" });
  useSshConfigStore.setState({ state: { managed: { c1: { alias: "web", at: 1, devices: { d1: { present: true, hash, at: 1 } } } } } });
});

test("every write to a managed host keeps the fields ~/.ssh/config owns", async () => {
  await useConnectionStore.getState().updateConnection("c1", { ...connectionToFormData(web), name: "Prod", username: "root", auth_type: "password", key_id: undefined, identity_id: "i1" });
  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ name: "Prod", username: "deploy", auth_type: "key", key_id: "k1" }));
});

test("a vault move drops the owned key for the sync to resolve in the new vault", async () => {
  await useConnectionStore.getState().updateConnection("c1", { ...connectionToFormData(web), vault_id: "lab", auth_type: "password", key_id: undefined });
  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ vault_id: "lab", host: "10.0.0.2", username: "deploy", key_id: undefined }));
});
