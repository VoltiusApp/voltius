// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { findDupes } from "./context";
import type { Connection, SshKey } from "@/types";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));

const key = (id: string, name: string) => ({ id, name, tags: [], vault_id: "personal" }) as unknown as SshKey;
const existing = {
  existingConnections: [],
  existingKeys: [key("k1", "id_ed25519")],
  existingPublicKeys: new Map([["k1", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGv0 comment"]]),
  existingIdentities: [],
  existingSnippets: [],
  existingPfRules: [],
};

describe("findDupes keyRef", () => {
  it("matches by name when the reference has no public key", () => {
    expect(findDupes(existing, "personal").keyRef({ _eid: "r", name: "id_ed25519", public_key: "" })).toBe("k1");
  });

  it("does not guess between keys that share the name", () => {
    const twin = { ...existing, existingKeys: [key("k1", "id_ed25519"), key("k2", "id_ed25519")] };
    expect(findDupes(twin, "personal").keyRef({ _eid: "r", name: "id_ed25519", public_key: "" })).toBeUndefined();
  });

  it("matches by public key only when the reference has one", () => {
    const dupes = findDupes(existing, "personal");
    expect(dupes.keyRef({ _eid: "r", name: "other", public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGv0" })).toBe("k1");
    expect(dupes.keyRef({ _eid: "r", name: "id_ed25519", public_key: "ssh-ed25519 AAAAOTHER" })).toBeUndefined();
  });
});

describe("findDupes connection", () => {
  it("still finds a host renamed after import, by host, port and user", () => {
    const renamed = { id: "c1", name: "Prod (renamed)", host: "10.0.4.12", port: 22, username: "deploy", tags: [], vault_id: "personal" } as unknown as Connection;
    const dupes = findDupes({ ...existing, existingConnections: [renamed] }, "personal");
    expect(dupes.connection({ name: "prod-web", host: "10.0.4.12", port: 22, username: "deploy", tags: [] } as never)).toBe("c1");
  });
});

describe("findDupes key", () => {
  const copy = (name: string, public_key?: string) => ({ _eid: "k", name, tags: [], private_key: "PRIVATE", ...(public_key && { public_key }) });

  it("never takes the name of a vault key whose public half differs or is unknown here", () => {
    const dupes = findDupes({ ...existing, existingKeys: [key("k1", "id_ed25519"), key("k2", "legacy")] }, "personal");
    expect(dupes.key(copy("other", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGv0"))).toBe("k1");
    expect(dupes.key(copy("id_ed25519"))).toBeUndefined();
    expect(dupes.key(copy("id_ed25519", "ssh-ed25519 AAAAOTHER"))).toBeUndefined();
    expect(dupes.key(copy("legacy"))).toBe("k2");
  });
});
