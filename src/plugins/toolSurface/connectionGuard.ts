import type { PluginAPI } from "@/plugins/api";
import { refusal } from "./refusal";

/** How many connections the model-facing error will enumerate before telling
 *  the model to call `list_connections` itself. */
export const MAX_LISTED_CONNECTIONS = 25;

export interface ConnectionRef {
  id: string;
  name?: string;
  host: string;
}

export type ConnectionGuardResult = { ok: true } | { ok: false; result: Record<string, unknown> };

const FIX_IT = 'call list_connections and copy the "id" field verbatim (a connection name or hostname is not an id)';

/** `null` when the lookup threw: the caller must treat that as unresolvable,
 *  never as resolved. */
async function loadConnections(api: Pick<PluginAPI, "connections">): Promise<ConnectionRef[] | null> {
  try {
    return (await api.connections.list()).map((c) => ({ id: c.id, name: c.name, host: c.host }));
  } catch {
    return null;
  }
}

function connectionsField(conns: ConnectionRef[] | null): { connections?: ConnectionRef[] } {
  if (!conns || conns.length > MAX_LISTED_CONNECTIONS) return {};
  return { connections: conns };
}

/** Reject a `connectionId` that matches no saved connection, with a payload the
 *  model can act on. Checked against the same list `deriveScope` uses, so the
 *  guard and the scope derivation cannot disagree about what exists. */
export async function guardConnectionId(
  api: Pick<PluginAPI, "connections">,
  connectionId: string,
): Promise<ConnectionGuardResult> {
  const conns = await loadConnections(api);
  if (conns?.some((c) => c.id === connectionId)) return { ok: true };
  return {
    ok: false,
    result: refusal(
      `no connection with id ${JSON.stringify(connectionId)}; ${FIX_IT}`,
      connectionsField(conns),
    ),
  };
}

/** Reject a whole plan naming any unknown connection. Rejecting rather than
 *  badging is deliberate: an unresolvable connection is a mistake the model can
 *  correct, unlike a shell metacharacter or an over-length command. */
export async function guardPlanConnectionIds(
  api: Pick<PluginAPI, "connections">,
  connectionIds: string[],
): Promise<ConnectionGuardResult> {
  const conns = await loadConnections(api);
  const known = new Set((conns ?? []).map((c) => c.id));
  const unknown: string[] = [];
  for (const id of connectionIds) {
    if (!known.has(id) && !unknown.includes(id)) unknown.push(id);
  }
  if (unknown.length === 0) return { ok: true };
  return {
    ok: false,
    result: refusal(
      `plan not shown to the user: ${unknown.length} step connection id(s) match no saved connection; ${FIX_IT}, then propose the plan again`,
      { unknownConnectionIds: unknown, ...connectionsField(conns) },
    ),
  };
}
