import type { PluginConnection } from "@/plugins/api";
import { UNKNOWN_SCOPE } from "./scopeDerivation";

export interface ScopeLabel {
  /** `pending`: the connection list hasn't loaded yet (see useConnectionLabels)
   * — a connection-id scope resolves here instead of `deleted` so a valid
   * grant never flashes as removed while the load is in flight. */
  kind: "local" | "unknown" | "deleted" | "connection" | "pending";
  /** Primary display string. For `local`/`unknown`/`deleted`/`pending` the
   * caller substitutes a translated label; `name` still carries the raw scope
   * so a grant can never render as an empty row. */
  name: string;
  /** Secondary line, or null when it would just repeat `name`. */
  detail: string | null;
}

function endpoint(c: PluginConnection): string {
  return `${c.username}@${c.host}:${c.port}`;
}

/** Pure: resolve an allowlist scope to what the user should see. A scope with
 * no matching connection is reported as `deleted` rather than hidden — a live
 * grant must never become invisible. */
export function resolveScopeLabel(scope: string, connections: PluginConnection[]): ScopeLabel {
  if (scope === "local") return { kind: "local", name: "local", detail: null };
  if (scope === UNKNOWN_SCOPE) return { kind: "unknown", name: UNKNOWN_SCOPE, detail: null };
  const conn = connections.find((c) => c.id === scope);
  if (!conn) return { kind: "deleted", name: scope, detail: scope };
  const named = conn.name?.trim();
  return named
    ? { kind: "connection", name: named, detail: endpoint(conn) }
    : { kind: "connection", name: endpoint(conn), detail: null };
}

/** Translated primary text for a label. `t` is passed in so this module stays
 * free of react-i18next and testable as a pure function. */
export function scopeLabelText(label: ScopeLabel, t: (key: string) => string): string {
  if (label.kind === "local") return t("aiAgent.settings.allowlist.localScope");
  if (label.kind === "unknown") return t("aiAgent.settings.allowlist.unknownScope");
  if (label.kind === "deleted") return t("aiAgent.settings.allowlist.deletedConnection");
  if (label.kind === "pending") return t("aiAgent.settings.allowlist.resolvingScope");
  return label.name;
}
