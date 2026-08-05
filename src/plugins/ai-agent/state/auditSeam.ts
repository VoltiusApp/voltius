import type { PluginAPI, PluginAuditAction } from "@/plugins/api";
import { UNKNOWN_SCOPE } from "./scopeDerivation";

/**
 * The plugin's one audit entry point, now a thin adapter over `api.audit.record`.
 *
 * Everything this file used to do on the host's behalf — the connection lookup
 * across personal and team stores, resolving that connection's vault to an audit
 * context, deriving a target name, and bounding `localMetadata` — is done by the
 * host, which is where the connection data and the sinks live. What remains here
 * is the scope→connectionId mapping, since "scope" is the agent's own vocabulary.
 *
 * `localMetadata` never leaves the device. Never pass captured terminal output to
 * either channel.
 */

let _api: PluginAPI | null = null;

export function setAuditApi(api: PluginAPI | null): void {
  _api = api;
}

/**
 * Record an agent action against the connection a tool call targets.
 *
 * A team-vault connection posts to that team's server; `"local"`, `UNKNOWN_SCOPE`
 * and deleted ids all fail closed to the on-device sink. Those two non-connection
 * scopes both reach the host as `null`, which it records as target id "local", so
 * the original scope is carried in `metadata` to keep them distinguishable — safe
 * on the wire because a null connection never resolves to a team context.
 */
export function auditAgentAction(
  scope: string,
  action: PluginAuditAction,
  metadata?: Record<string, unknown>,
  localMetadata?: Record<string, unknown>,
): void {
  const isConnection = scope !== "local" && scope !== UNKNOWN_SCOPE;
  _api?.audit.record(
    isConnection ? scope : null,
    action,
    isConnection ? metadata : { ...metadata, scope },
    localMetadata,
  );
}
