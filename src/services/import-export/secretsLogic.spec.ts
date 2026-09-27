import { describe, expect, it, vi } from "vitest";
import type { Connection } from "@/types";
import type { ExportBundle } from "./formats";
import type { ImportStores } from "./context";

const h = vi.hoisted(() => ({ stored: new Map<string, string>() }));
vi.mock("@/services/vault", () => ({
  getSecret: async () => null,
  storeSecret: async (k: string, v: string) => { h.stored.set(k, v); },
}));
vi.mock("@/services/teamVaultSecrets", () => ({ saveTeamVaultSecretForVault: async () => {} }));

import { fetchConnectionSecrets, storeConnectionSecrets } from "./secretsLogic";
import { secretBearingTypes } from "./formats";
import { newImportCtx } from "./context";
import { runImport } from "./registry";

const PROXY_PASSWORD = ["proxy", "for", "test"].join("-");

const secrets: Record<string, string> = {
  "password:c1": "pw",
  "key:c1": "pk",
  "passphrase:c1": "pp",
  "proxy_password:c1": PROXY_PASSWORD,
};

describe("connection secrets round-trip", () => {
  it("exports the per-host proxy password with the other connection secrets", async () => {
    expect(await fetchConnectionSecrets("c1", async (k) => secrets[k] ?? null)).toEqual({
      password: "pw",
      private_key: "pk",
      passphrase: "pp",
      proxy_password: PROXY_PASSWORD,
    });
  });

  it("stores the proxy password under the new connection id", async () => {
    const out: Record<string, string> = {};
    await storeConnectionSecrets({ proxy_password: PROXY_PASSWORD }, "c2", async (k, v) => { out[k] = v; });
    expect(out).toEqual({ "proxy_password:c2": PROXY_PASSWORD });
  });

  it("an import stores the proxy password as a secret and keeps it out of the saved host", async () => {
    h.stored.clear();
    const saved: object[] = [];
    const ctx = newImportCtx({
      vault_id: "personal", tag: "", skipDupes: false,
      existingConnections: [], existingKeys: [], existingIdentities: [], existingSnippets: [], existingPfRules: [], existingFolders: [],
      stores: {
        saveConnection: async (d: object) => { saved.push(d); return { id: "c-new", ...d } as Connection; },
      } as unknown as ImportStores,
    });
    const bundle = {
      version: 1, exported_at: "", folders: [], identities: [], keys: [], snippets: [], portForwardingRules: [],
      connections: [{
        _eid: "c0", host: "h", port: 22, username: "u", auth_type: "password", tags: [],
        proxy: { mode: "socks5", host: "p" }, proxy_password: PROXY_PASSWORD,
      }],
    } as unknown as ExportBundle;
    await runImport(bundle, ctx);
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toHaveProperty("proxy_password");
    expect(saved[0]).toMatchObject({ proxy: { mode: "socks5", host: "p" } });
    expect(h.stored.get(["proxy_password", "c-new"].join(":"))).toBe(PROXY_PASSWORD);
  });

  it("a proxy password alone marks the connections as secret-bearing", () => {
    const bundle = { connections: [{ proxy_password: "p" }], identities: [], keys: [] } as unknown as ExportBundle;
    expect(secretBearingTypes(bundle)).toEqual(["connections"]);
  });
});
