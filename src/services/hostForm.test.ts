// @vitest-environment jsdom
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

const { calls, moveWithSecrets } = vi.hoisted(() => ({ calls: [] as string[], moveWithSecrets: vi.fn() }));
vi.mock("@/services/vaultObjectSecrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/vaultObjectSecrets")>();
  moveWithSecrets.mockImplementation(async (...a: Parameters<typeof actual.moveWithSecrets>) => {
    calls.push("move");
    await actual.moveWithSecrets(...a);
  });
  return { ...actual, moveWithSecrets: (...a: Parameters<typeof actual.moveWithSecrets>) => moveWithSecrets(...a) };
});

import { emptyHostSecrets, saveHostFromForm } from "./hostForm";

const editing = { id: "c1", vault_id: "team-1" } as never;
const none = emptyHostSecrets();

describe("saveHostFromForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    storeSecret.mockResolvedValue(undefined);
    deleteSecret.mockResolvedValue(undefined);
  });

  it("an edit hands its secret fields to the move, which writes them after a same-location update", async () => {
    updateConnection.mockImplementation(async () => { calls.push("update"); });
    storeSecret.mockImplementation(async (k: string) => { calls.push(`store ${k}`); });
    const personal = { id: "c1", vault_id: "personal" } as never;

    await saveHostFromForm(personal, { tags: [], vault_id: "v-other" }, { ...none, password: "new" }, "personal");

    expect(moveWithSecrets).toHaveBeenCalledWith("connection", personal, "v-other", expect.any(Function), [
      ["password:c1", "new"], ["key:c1", null], ["passphrase:c1", null], ["proxy_password:c1", null], ["knock_sequence:c1", null],
    ]);
    expect(updateConnection).toHaveBeenCalledWith("c1", { tags: [], vault_id: "v-other" });
    expect(calls).toEqual(["move", "update", "store password:c1"]);
  });

  it("stores the proxy password locally", async () => {
    await saveHostFromForm(editing, { tags: [] }, { ...none, proxy_password: "pp" }, "personal");
    expect(storeSecret).toHaveBeenCalledWith("proxy_password:c1", "pp");
  });

  it("stores the knock sequence locally", async () => {
    await saveHostFromForm(editing, { tags: [] }, { ...none, knock_sequence: "666/tcp" }, "personal");
    expect(storeSecret).toHaveBeenCalledWith("knock_sequence:c1", "666/tcp");
  });

  it("clears the proxy password when emptied", async () => {
    await saveHostFromForm(editing, { tags: [] }, { ...none, proxy_password: "" }, "personal");
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
      saveHostFromForm(editing, { tags: [] }, { ...none, password: "pw" }, "v1"),
    ).rejects.toBeInstanceOf(TeamSecretUploadError);
  });
});
