import { describe, expect, it, vi } from "vitest";
import type { Connection, SshKey } from "@/types";
import { connectionsClipboardHalf, type ConnectionsClipboardDeps } from "./connections";

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async () => "material"),
  storeSecret: vi.fn(async () => {}),
}));
vi.mock("@/services/vaultSecrets", () => ({
  publishKeySecrets: vi.fn(async () => {}),
  unpublishKeySecrets: vi.fn(async () => {}),
  publishIdentitySecrets: vi.fn(async () => {}),
  unpublishIdentitySecrets: vi.fn(async () => {}),
  transferConnectionSecrets: vi.fn(async () => {}),
}));

const conn = (over: Partial<Connection> = {}): Connection => ({
  id: "c1", name: "host", host: "h", port: 22, username: "root",
  vault_id: "personal", folder_id: null, key_id: "k1", identity_id: undefined, ...over,
} as Connection);
const key = (over: Partial<SshKey> = {}): SshKey => ({
  id: "k1", name: "key", vault_id: "personal", folder_id: null, key_type: "ed25519", tags: [], ...over,
} as SshKey);

const deps = (over: Partial<ConnectionsClipboardDeps> = {}): ConnectionsClipboardDeps => ({
  connections: [conn()],
  keys: [key()],
  identities: [],
  getConnectionsInFolderTree: () => [],
  vaultForFolder: () => "team-1",
  updateConnection: vi.fn(async () => {}),
  deleteConnection: vi.fn(async () => {}),
  loadConnections: vi.fn(async () => {}),
  moveObjectsToFolder: vi.fn(async () => {}),
  duplicateInto: vi.fn(async () => ({ id: "c-copy" })),
  updateKey: vi.fn(async () => {}),
  saveKey: vi.fn(async () => ({ id: "k-copy" })),
  updateIdentity: vi.fn(async () => {}),
  saveIdentity: vi.fn(async () => ({ id: "i-copy" })),
  withdrawOrWarn: vi.fn(async (p: Promise<unknown>) => p),
  ...over,
});

describe("connectionsClipboardHalf", () => {
  it("plans a move of a key no host left behind is using", () => {
    const half = connectionsClipboardHalf(deps());
    const plan = half.planCascade!([{ id: "c1", kind: "connection" }], [], "team-1", "cut");
    expect(plan).toEqual([
      expect.objectContaining({ type: "key", action: "move", sourceVaultId: "personal" }),
    ]);
  });

  it("plans a copy when a host staying behind still uses the key", () => {
    const d = deps({ connections: [conn(), conn({ id: "c2" })] });
    const plan = connectionsClipboardHalf(d)
      .planCascade!([{ id: "c1", kind: "connection" }], [], "team-1", "cut");
    expect(plan[0]).toMatchObject({ type: "key", action: "copy" });
  });

  it("plans a copy for every referenced object when the paste is a copy", () => {
    const plan = connectionsClipboardHalf(deps())
      .planCascade!([{ id: "c1", kind: "connection" }], [], "team-1", "copy");
    expect(plan[0]).toMatchObject({ action: "copy" });
  });

  it("plans nothing when the key is already in the destination vault", () => {
    const d = deps({ keys: [key({ vault_id: "team-1" })] });
    expect(connectionsClipboardHalf(d)
      .planCascade!([{ id: "c1", kind: "connection" }], [], "team-1", "cut")).toEqual([]);
  });

  it("points a pasted host at the key the cascade copied", async () => {
    const d = deps({ connections: [conn(), conn({ id: "c2" })] });
    const half = connectionsClipboardHalf(d);
    const items = [{ id: "c1", kind: "connection" as const }];
    await half.applyCascade!(items, [], "team-1", "cut");
    await half.duplicateItems(["c1"], null);
    expect(d.duplicateInto).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }), null, expect.objectContaining({ keyId: "k-copy" }),
    );
  });

  it("points a pasted host at the cascade's copy even when the half is rebuilt in between — as a re-render does", async () => {
    const d = deps({ connections: [conn(), conn({ id: "c2" })] });
    const remap = { identities: new Map<string, string>(), keys: new Map<string, string>() };
    const items = [{ id: "c1", kind: "connection" as const }];
    // Simulates usePageClipboard resolving against a fresh factory call — e.g. a
    // store write during applyCascade re-rendering the page — before duplicateItems
    // runs. Only a remap owned by the caller and passed to both calls survives that.
    await connectionsClipboardHalf(d, remap).applyCascade!(items, [], "team-1", "cut");
    await connectionsClipboardHalf(d, remap).duplicateItems(["c1"], null);
    expect(d.duplicateInto).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }), null, expect.objectContaining({ keyId: "k-copy" }),
    );
  });

  it("changes vault through updateConnection on a cross-vault move", async () => {
    const d = deps();
    await connectionsClipboardHalf(d).moveItems(["c1"], "f2", "team-1");
    expect(d.updateConnection).toHaveBeenCalledWith(
      "c1", expect.objectContaining({ folder_id: "f2", vault_id: "team-1" }),
    );
    expect(d.moveObjectsToFolder).not.toHaveBeenCalled();
  });

  it("reparents and reloads on a same-vault move", async () => {
    const d = deps();
    await connectionsClipboardHalf(d).moveItems(["c1"], "f2", "personal");
    expect(d.moveObjectsToFolder).toHaveBeenCalledWith(["c1"], "connection", "f2");
    expect(d.loadConnections).toHaveBeenCalled();
  });

  it("reports a key left outside the destination as dangling", () => {
    const half = connectionsClipboardHalf(deps());
    expect(half.danglingKinds!([{ id: "c1", kind: "connection" }], [], "team-1")).toEqual(["key"]);
  });
});
