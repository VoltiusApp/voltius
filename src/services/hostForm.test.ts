import { describe, it, expect, vi, beforeEach } from "vitest";
import { TeamSecretUploadError } from "@/services/secretRouting";

const storeSecret = vi.fn();
const deleteSecret = vi.fn();
vi.mock("@/services/vault", () => ({ storeSecret: (...a: unknown[]) => storeSecret(...a), deleteSecret: (...a: unknown[]) => deleteSecret(...a) }));
const updateConnection = vi.fn();
const saveConnection = vi.fn();
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ updateConnection, saveConnection }) },
}));

import { saveHostFromForm } from "./hostForm";

const editing = { id: "c1", vault_id: "team-1" } as never;
const none = { password: null, privateKey: null, passphrase: null, proxyPassword: null };

describe("saveHostFromForm", () => {
  beforeEach(() => { vi.clearAllMocks(); storeSecret.mockResolvedValue(undefined); deleteSecret.mockResolvedValue(undefined); });

  it("stores the proxy password locally", async () => {
    await saveHostFromForm(editing, { tags: [] }, { ...none, proxyPassword: "pp" }, "personal");
    expect(storeSecret).toHaveBeenCalledWith("proxy_password:c1", "pp");
  });

  it("clears the proxy password when emptied", async () => {
    await saveHostFromForm(editing, { tags: [] }, { ...none, proxyPassword: "" }, "personal");
    expect(deleteSecret).toHaveBeenCalledWith("proxy_password:c1");
  });

  it("an edit that clears a password rejects when deleteSecret rejects", async () => {
    deleteSecret.mockRejectedValueOnce(new Error("withdraw failed"));
    await expect(
      saveHostFromForm(editing, { tags: [] }, { ...none, password: "" }, "personal"),
    ).rejects.toThrow("withdraw failed");
  });

  it("an upload failure while saving a host form reaches the caller", async () => {
    storeSecret.mockRejectedValue(new TeamSecretUploadError("password:c1", new Error("403")));
    await expect(
      saveHostFromForm(editing, { tags: [] }, { password: "pw", privateKey: null, passphrase: null, proxyPassword: null }, "v1"),
    ).rejects.toBeInstanceOf(TeamSecretUploadError);
  });
});
