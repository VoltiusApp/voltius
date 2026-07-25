import type { AgentAuditAction, AuditContext } from "@/services/auditContext";
import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportAgentAuditEvent } from "@/services/auditReporter";
import { useConnectionStore } from "@/stores/connectionStore";
import { UNKNOWN_SCOPE } from "./scopeDerivation";

/**
 * The ONE file in this plugin that reaches outside `@/plugins/api`.
 *
 * Audit is deliberately not a PluginAPI capability: a public `api.audit.*`
 * would let any plugin forge events like `connection.deleted` unless the API
 * force-namespaced every action. Keeping the coupling in one named file makes
 * it greppable, and swappable if that ever changes.
 *
 * It also means the plugin does not need `vault_id` on `PluginConnection` —
 * the lookup happens here, on the app side.
 */

const LOCAL_CONTEXT: AuditContext = { kind: "local", vaultId: "personal" };

/**
 * Record an agent action against the connection a tool call targets.
 *
 * The audit context is resolved from THAT connection's vault, which is what
 * keeps personal hosts off the team server: a POST happens only when the
 * scope's connection lives in a team vault — a connection the team already
 * holds. `"local"`, `UNKNOWN_SCOPE` and deleted ids all fail closed to the
 * local sink.
 *
 * `localMetadata` never leaves the device. Never pass captured terminal
 * output to either channel.
 */
export function auditAgentAction(
  scope: string,
  action: AgentAuditAction,
  metadata?: Record<string, unknown>,
  localMetadata?: Record<string, unknown>,
): void {
  // Team-vault connections live only in `teamConnections` (by team id), never
  // in `connections` (personal-only). Merge both, as `findConnection` in
  // `@/plugins/runtime.ts` does — that is the canonical lookup pattern.
  const conn = scope === "local" || scope === UNKNOWN_SCOPE
    ? undefined
    : (() => {
        const { connections, teamConnections } = useConnectionStore.getState();
        return (
          connections.find((c) => c.id === scope) ??
          Object.values(teamConnections).flat().find((c) => c.id === scope)
        );
      })();

  const context = conn ? auditContextForVaultId(conn.vault_id) : LOCAL_CONTEXT;
  const targetName = conn
    ? conn.name?.trim() || `${conn.username}@${conn.host}:${conn.port}`
    : scope;

  reportAgentAuditEvent(context, action, {
    target_type: "ai_agent",
    target_id: scope,
    target_name: targetName,
    metadata,
    localMetadata,
  });
}
