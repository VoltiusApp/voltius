import { describe, it, expect, vi, beforeEach } from "vitest";

const storeSecret = vi.fn();
const deleteSecret = vi.fn();
const saveTeam = vi.fn();
vi.mock("@/services/vault", () => ({ storeSecret: (...a: unknown[]) => storeSecret(...a), deleteSecret: (...a: unknown[]) => deleteSecret(...a) }));
vi.mock("@/services/teamVaultSecrets", () => ({ saveTeamVaultSecretForVault: (...a: unknown[]) => saveTeam(...a) }));
const updateConnection = vi.fn();
const saveConnection = vi.fn();
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ updateConnection, saveConnection }) },
}));

import { saveHostFromForm } from "./hostForm";

const editing = { id: "c1", vault_id: "team-1" } as never;
const none = { password: null, privateKey: null, passphrase: null, proxyPassword: null };

describe("saveHostFromForm", () => {
  beforeEach(() => { vi.clearAllMocks(); saveTeam.mockResolvedValue(undefined); });

  it("stores the proxy password locally and in the team vault", async () => {
    await saveHostFromForm(editing, { tags: [] }, { ...none, proxyPassword: "pp" }, "personal");
    expect(storeSecret).toHaveBeenCalledWith("proxy_password:c1", "pp");
    expect(saveTeam).toHaveBeenCalledWith("team-1", "proxy_password:c1", "pp");
  });

  it("clears the proxy password when emptied", async () => {
    await saveHostFromForm(editing, { tags: [] }, { ...none, proxyPassword: "" }, "personal");
    expect(deleteSecret).toHaveBeenCalledWith("proxy_password:c1");
  });

  it("saveHostFromForm surfaces team proxy-password failure", async () => {
    saveTeam.mockRejectedValueOnce(new Error("400 invalid secret_type"));
    await expect(
      saveHostFromForm(editing, { tags: [] }, { ...none, proxyPassword: "pp" }, "personal"),
    ).rejects.toThrow("400 invalid secret_type");
  });
});
