import type { PluginConnection } from "@/plugins/api";
import { connectionDisplayName } from "@/utils/connectionDisplayName";

/** The only seam that changes to add object types later (keys/folders/…). */
export type ObjectRefKind = "connection";

export interface ObjectRef {
  kind: ObjectRefKind;
  id: string;
  /** Display name (connectionDisplayName). */
  name: string;
  /** Secondary line: user@host:port. */
  detail: string;
  connection: PluginConnection;
}

/** Pure: resolve an id to what the user should see, or null if unknown. */
export function resolveObjectRef(
  id: string,
  connections: PluginConnection[],
): ObjectRef | null {
  const conn = connections.find((c) => c.id === id);
  if (!conn) return null;
  return {
    kind: "connection",
    id,
    name: connectionDisplayName(conn),
    detail: `${conn.username}@${conn.host}:${conn.port}`,
    connection: conn,
  };
}
