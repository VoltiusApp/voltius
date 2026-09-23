import { describe, expect, it } from "vitest";
import type { Connection, Identity, PortForwardingRule, Snippet, SshKey } from "@/types";
import type { StoreSlices } from "./context";
import { buildBundle } from "./registry";

const conn = (over: Partial<Connection>) =>
  ({ name: "c", host: "h", port: 22, username: "u", tags: [], vault_id: "personal", ...over }) as Connection;

function storesOf(over: Partial<StoreSlices> = {}): StoreSlices {
  return {
    connections: [conn({ id: "c1" })],
    identities: [{ id: "i1", name: "id", username: "u", vault_id: "personal", tags: [] } as unknown as Identity],
    keys: [{ id: "k1", name: "key", vault_id: "personal", tags: [] } as unknown as SshKey],
    folders: [],
    snippets: [{ id: "s1", name: "snip", steps: [], tags: [], vault_id: "personal" } as unknown as Snippet],
    snippetFolders: [],
    pfRules: [{ id: "p1", name: "pf", connection_ids: [], vault_id: "personal" } as unknown as PortForwardingRule],
    ...over,
  };
}

const onlyConnections = { keys: false, identities: false, connections: true, snippets: false, portForwardingRules: false };

describe("buildBundle — INCLUDE selection", () => {
  it("exports only connections when only connections are included", async () => {
    const bundle = await buildBundle(onlyConnections, storesOf(), ["personal"], {}, () => false);
    expect(bundle.connections).toHaveLength(1);
    expect(bundle.identities).toEqual([]);
    expect(bundle.keys).toEqual([]);
    expect(bundle.snippets).toEqual([]);
    expect(bundle.portForwardingRules).toEqual([]);
  });
});

describe("buildBundle — cascade", () => {
  it("pulls in the identity and key a connection uses even when their types are unchecked", async () => {
    const stores = storesOf({ connections: [conn({ id: "c1", identity_id: "i1", key_id: "k1" })] });
    const bundle = await buildBundle(onlyConnections, stores, ["personal"], {}, () => false);
    expect(bundle.identities).toHaveLength(1);
    expect(bundle.keys).toHaveLength(1);
    expect(bundle.connections[0]._identity_eid).toBeDefined();
  });
});
