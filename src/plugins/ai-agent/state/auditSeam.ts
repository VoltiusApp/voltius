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
 * Cap on `localMetadata.command` characters.
 *
 * `run_command`'s schema is a bare `z.string()` with no max, which makes it
 * this log's first unbounded free-form field. Left unbounded, a handful of
 * huge commands can blow the per-vault byte budget (see
 * `MAX_LOCAL_LOG_CHARS_PER_VAULT` in `localAuditService.ts`) long before the
 * entry-count cap ever trips.
 */
const MAX_LOCAL_COMMAND_CHARS = 2000;

/**
 * Truncate `localMetadata.command`, if present and over budget, and flag it
 * as truncated so a reader is never misled into thinking they see the whole
 * command. Applies to `localMetadata` only — never to what actually runs or
 * to anything shown to the user elsewhere, and never to the `metadata` that
 * can reach the wire.
 */
function boundLocalMetadata(
  localMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!localMetadata) return localMetadata;
  const command = localMetadata.command;
  if (typeof command !== "string" || command.length <= MAX_LOCAL_COMMAND_CHARS) return localMetadata;
  return {
    ...localMetadata,
    command: command.slice(0, MAX_LOCAL_COMMAND_CHARS),
    command_truncated: true,
  };
}

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
    localMetadata: boundLocalMetadata(localMetadata),
  });
}
