import type { KnownHost } from "@/types";
import type { PluginKnownHost, PluginTrustResult } from "../api";

export interface KnownHostPorts {
  list(): Promise<KnownHost[]>;
  remove(id: string): Promise<void>;
  trust(input: {
    host: string; port: number; fingerprint: string; vaultId?: string; replace?: boolean;
  }): Promise<{ entry: KnownHost; superseded: KnownHost[] }>;
  isTeamVault(vaultId: string): boolean;
}

const project = (h: KnownHost): PluginKnownHost => ({
  id: h.id,
  host: h.host,
  port: h.port,
  fingerprint: h.fingerprint,
  vault_id: h.vault_id,
  created_at: h.created_at,
});

export function createKnownHostsAPI(ports: KnownHostPorts) {
  return {
    async list(filter?: { host?: string; port?: number }): Promise<PluginKnownHost[]> {
      const all = await ports.list();
      return all
        .filter((h) => (filter?.host === undefined || h.host === filter.host)
          && (filter?.port === undefined || h.port === filter.port))
        .map(project);
    },

    async delete(id: string): Promise<void> {
      await ports.remove(id);
    },

    async trust(input: {
      host: string; port: number; fingerprint: string; vaultId?: string; replace?: boolean;
    }): Promise<PluginTrustResult> {
      if (input.vaultId && ports.isTeamVault(input.vaultId)) {
        throw new Error("Cannot trust a host key into a team vault");
      }
      const { entry, superseded } = await ports.trust(input);
      return {
        entry: project(entry),
        superseded: superseded.map(project),
        replaced: superseded.length > 0,
      };
    },
  };
}

export type KnownHostsAPI = ReturnType<typeof createKnownHostsAPI>;
