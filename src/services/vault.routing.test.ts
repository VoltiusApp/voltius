import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ owner: vi.fn(), read: vi.fn(), write: vi.fn(), remove: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/persistedAccountUiState", () => ({ clearPersistedAccountUiState: vi.fn() }));
vi.mock("@/services/teamSecretOwnership", () => ({ teamIdOwningSecret: h.owner }));
vi.mock("@/services/secretRouting", () => ({ readSecretAt: h.read, writeSecretAt: h.write, removeSecretAt: h.remove }));

import { invoke } from "@tauri-apps/api/core";
import {
  getSecret, storeSecret, deleteSecret, setVaultKey,
  storePluginSecret, getPluginSecret, deletePluginSecret,
} from "./vault";

beforeEach(() => Object.values(h).forEach((m) => m.mockReset()));

test("getSecret, storeSecret and deleteSecret route by the object that owns the key", async () => {
  h.owner.mockImplementation((k: string) => (k === "password:team" ? "t1" : null));
  h.read.mockResolvedValue("v");
  await expect(getSecret("password:team")).resolves.toBe("v");
  expect(h.read).toHaveBeenCalledWith("t1", "password:team");
  await storeSecret("password:mine", "pw");
  expect(h.write).toHaveBeenCalledWith(null, "password:mine", "pw");
  await deleteSecret("password:team");
  expect(h.remove).toHaveBeenCalledWith("t1", "password:team");
});

test("plugin secrets stay in the local store without consulting ownership", async () => {
  setVaultKey([1]);
  await storePluginSecret("p", "token", "v");
  await getPluginSecret("p", "token");
  await deletePluginSecret("p", "token");
  expect(h.owner).not.toHaveBeenCalled();
  expect(vi.mocked(invoke).mock.calls.map((c) => c[0]).filter((c) => c !== "secrets_unlock"))
    .toEqual(["secrets_set", "secrets_get", "secrets_delete"]);
});
