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

/**
 * Human-readable form of an exact-grain allowlist key. `transfer_file` keys on
 * connection ids (`<fromTarget> → <fromPath> → <toTarget> → <toPath>`), which
 * are unforgeable but render as raw UUIDs; here the two endpoints are swapped
 * for their connection labels. Display only — the stored key keeps the ids,
 * since they are the grant's identity.
 *
 * Falls back to the raw key whenever the shape isn't the expected four parts,
 * so a path containing the separator degrades to today's output rather than to
 * a mislabelled grant.
 */
export function grainKeyText(
  entry: { tool: string; grain: string; key: string },
  labelFor: (scope: string) => ScopeLabel,
  t: (key: string) => string,
): string {
  if (entry.tool !== "transfer_file" || entry.grain !== "exact") return entry.key;
  const parts = entry.key.split(" → ");
  if (parts.length !== 4) return entry.key;
  const [fromTarget, fromPath, toTarget, toPath] = parts;
  const side = (target: string, path: string) => `${scopeLabelText(labelFor(target), t)}:${path}`;
  return `${side(fromTarget, fromPath)} → ${side(toTarget, toPath)}`;
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
