import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ owner: vi.fn(), read: vi.fn(), write: vi.fn(), remove: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/persistedAccountUiState", () => ({ clearPersistedAccountUiState: vi.fn() }));
vi.mock("@/services/teamSecretOwnership", () => ({ teamIdOwningSecret: h.owner }));
vi.mock("@/services/secretRouting", () => ({ readSecretAt: h.read, writeSecretAt: h.write, removeSecretAt: h.remove }));

import { getSecret, storeSecret, deleteSecret } from "./vault";

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
