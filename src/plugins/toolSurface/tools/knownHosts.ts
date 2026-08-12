import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp } from "./helpers";

export const KNOWN_HOST_PERMISSIONS = ["known_hosts:read", "known_hosts:write", "audit"] as const;

export function buildKnownHostTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "known_host_list",
      description:
        "List the SSH host keys this machine has trusted, with their fingerprints. A connection "
        + "that fails on a changed host key can be diagnosed here.",
      risk: "auto",
      schema: z.object({
        host: z.string().optional(),
        port: z.number().int().optional(),
      }),
      execute: async (raw) => {
        const { host, port } = raw as { host?: string; port?: number };
        return ports.api.knownHosts.list({ host, port });
      },
    },
    {
      name: "known_host_delete",
      description:
        "Forget a trusted host key by id. The next connection to that host asks about its key "
        + "again — this is what unblocks a host that was rebuilt.",
      risk: "prompt",
      schema: z.object({ id: z.string() }),
      execute: async (raw) =>
        op("known_host_delete", "agent.object_deleted", { objectType: "known_host", objectId: String(raw.id) }, raw, (a) =>
          ports.api.knownHosts.delete(a.id as string)),
    },
    {
      name: "known_host_trust",
      description:
        "Trust an SSH host key. Without `replace` this only trusts a host that has no key stored "
        + "yet: a host that already has one is refused, naming the stored fingerprints, because a "
        + "second key would be accepted alongside the first. `replace: true` supersedes the keys "
        + "already stored for that host and port. The result always names what was superseded, so "
        + "a replaced key is never reported as a fresh trust.",
      risk: "prompt",
      schema: z.object({
        host: z.string(),
        port: z.number().int(),
        fingerprint: z.string(),
        vault_id: z.string().optional(),
        replace: z.boolean().optional(),
      }),
      execute: async (raw) =>
        // No id exists yet, so host:port identifies the entry; the fingerprint
        // stays out of the row.
        op("known_host_trust", "agent.object_created", {
          objectType: "known_host",
          objectId: `${String(raw.host)}:${String(raw.port)}`,
          replace: raw.replace === true,
        }, raw, (a) =>
          ports.api.knownHosts.trust({
            host: a.host as string,
            port: a.port as number,
            fingerprint: a.fingerprint as string,
            vaultId: a.vault_id as string | undefined,
            replace: a.replace as boolean | undefined,
          })),
    },
  ];
}
