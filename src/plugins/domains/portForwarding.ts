import type { ActiveTunnel, PortForwardingRule, PortForwardingRuleFormData } from "@/types";
import type { PluginActiveTunnel, PluginPortForward, PluginPortForwardInput } from "../api";
import { vaultOf } from "./vaultOf";

export interface PortForwardPorts {
  /** Same reason as the snippet store: the Port Forwarding page loads it, so a
   *  headless read on a cold app reports an empty list. */
  hydrate(): Promise<void>;
  list(): PortForwardingRule[];
  create(data: PortForwardingRuleFormData): Promise<PortForwardingRule>;
  update(id: string, data: PortForwardingRuleFormData): Promise<void>;
  remove(id: string): Promise<void>;
  isTeamVault(vaultId: string): boolean;
  /** A session that is open right now, or undefined. */
  sessionExists(sessionId: string): boolean;
  tunnels(sessionId: string): Promise<ActiveTunnel[]>;
  open(opts: {
    sessionId: string;
    localPort: number;
    remotePort: number;
    remoteHost: string;
    tunnelType: PortForwardingRule["tunnel_type"];
    bindHost: string;
    targetHost: string;
    ruleId: string;
    ruleName: string;
  }): Promise<ActiveTunnel>;
  close(sessionId: string, tunnelId: string): Promise<void>;
}

const project = (r: PortForwardingRule): PluginPortForward => ({
  id: r.id,
  name: r.name,
  local_port: r.local_port,
  remote_port: r.remote_port,
  remote_host: r.remote_host,
  tunnel_type: r.tunnel_type,
  bind_host: r.bind_host,
  target_host: r.target_host,
  description: r.description,
  connection_ids: r.connection_ids,
  vault_id: vaultOf(r),
  folder_id: r.folder_id ?? null,
});

/** `origin` is dropped: it names the rule the caller already passed, and a live
 *  tunnel's identity to a consumer is its id and its ports. */
const projectTunnel = (t: ActiveTunnel): PluginActiveTunnel => ({
  id: t.id,
  tunnel_type: t.tunnel_type,
  local_port: t.local_port,
  remote_port: t.remote_port,
  remote_host: t.remote_host,
  bind_host: t.bind_host,
  target_host: t.target_host,
  state: t.state,
  bytes_transferred: t.bytes_transferred,
});

/**
 * The full record a store write wants, from a partial patch — `updateRule` takes
 * a whole form, so a patch naming one field would blank the rest.
 */
const formFrom = (
  base: PortForwardingRule | null,
  input: Partial<PluginPortForwardInput>,
): PortForwardingRuleFormData => ({
  name: input.name ?? base?.name ?? "",
  local_port: input.local_port ?? base?.local_port ?? 0,
  remote_port: input.remote_port ?? base?.remote_port ?? 0,
  remote_host: input.remote_host ?? base?.remote_host ?? "localhost",
  tunnel_type: input.tunnel_type ?? base?.tunnel_type ?? "local",
  bind_host: input.bind_host ?? base?.bind_host ?? "127.0.0.1",
  target_host: input.target_host ?? base?.target_host ?? "localhost",
  description: input.description ?? base?.description,
  connection_ids: input.connection_ids ?? base?.connection_ids ?? [],
  folder_id: input.folder_id ?? base?.folder_id,
  vault_id: input.vault_id ?? (base ? vaultOf(base) : undefined),
});

export function createPortForwardsAPI(ports: PortForwardPorts) {
  const find = async (id: string): Promise<PortForwardingRule> => {
    await ports.hydrate();
    const found = ports.list().find((r) => r.id === id);
    if (!found) throw new Error(`Port forwarding rule "${id}" not found`);
    return found;
  };

  const refuseTeam = (r: PortForwardingRule, verb: string): void => {
    if (ports.isTeamVault(vaultOf(r))) {
      throw new Error(`Rule "${r.name}" is in a team vault and cannot be ${verb} from here`);
    }
  };

  const checkInput = (input: Partial<PluginPortForwardInput>): void => {
    if (input.name !== undefined && !input.name.trim()) {
      throw new Error("A rule name cannot be empty");
    }
    for (const [field, value] of [["local_port", input.local_port], ["remote_port", input.remote_port]] as const) {
      // A port outside 1-65535 cannot bind; refused here so the failure names
      // the field rather than surfacing as a bind error from the tunnel later.
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65535)) {
        throw new Error(`${field} must be a port between 1 and 65535`);
      }
    }
    if (input.vault_id && ports.isTeamVault(input.vault_id)) {
      throw new Error(`Vault "${input.vault_id}" is a team vault and cannot be written from here`);
    }
  };

  const requireSession = (sessionId: string): void => {
    if (!ports.sessionExists(sessionId)) {
      throw new Error(`No open session "${sessionId}"; call list_sessions for the current ids`);
    }
  };

  return {
    list: async (): Promise<PluginPortForward[]> => {
      await ports.hydrate();
      return ports.list().map(project);
    },

    create: async (input: PluginPortForwardInput): Promise<PluginPortForward> => {
      if (!input.name?.trim()) throw new Error("A rule name cannot be empty");
      checkInput(input);
      return project(await ports.create(formFrom(null, input)));
    },

    update: async (id: string, patch: Partial<PluginPortForwardInput>): Promise<void> => {
      const current = await find(id);
      refuseTeam(current, "changed");
      checkInput(patch);
      await ports.update(id, formFrom(current, patch));
    },

    delete: async (id: string): Promise<void> => {
      refuseTeam(await find(id), "deleted");
      await ports.remove(id);
    },

    tunnels: async (sessionId: string): Promise<PluginActiveTunnel[]> => {
      requireSession(sessionId);
      return (await ports.tunnels(sessionId)).map(projectTunnel);
    },

    /**
     * Opens a saved rule's tunnel on an open session.
     *
     * A team-vault rule is READABLE and startable: starting one writes nothing,
     * and refusing it would make a shared rule useless to the team it is shared
     * with. Only the rule's own record is protected.
     */
    start: async (ruleId: string, sessionId: string): Promise<PluginActiveTunnel> => {
      const rule = await find(ruleId);
      requireSession(sessionId);
      return projectTunnel(await ports.open({
        sessionId,
        localPort: rule.local_port,
        remotePort: rule.remote_port,
        remoteHost: rule.remote_host,
        tunnelType: rule.tunnel_type,
        bindHost: rule.bind_host,
        targetHost: rule.target_host,
        ruleId: rule.id,
        ruleName: rule.name,
      }));
    },

    stop: async (sessionId: string, tunnelId: string): Promise<void> => {
      requireSession(sessionId);
      await ports.close(sessionId, tunnelId);
    },
  };
}

export type PortForwardsAPI = ReturnType<typeof createPortForwardsAPI>;
