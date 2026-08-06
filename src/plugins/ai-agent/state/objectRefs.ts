import type { PluginConnection } from "@/plugins/api";

/** Mirrors the host's own connectionDisplayName, which is not plugin surface. */
function connectionDisplayName(c: PluginConnection): string {
  if (c.connection_type === "serial") {
    return c.name?.trim() || c.serial_port || "Serial Device";
  }
  return c.name?.trim() || `${c.username}@${c.host}:${c.port}`;
}

/** The only seam that changes to add object types later (keys/folders/…). */
export type ObjectRefKind = "connection";

export interface ObjectRef {
  kind: ObjectRefKind;
  id: string;
  /** Display name (connectionDisplayName). */
  name: string;
  /** Secondary line: user@host:port. */
  detail: string;
  /** Another connection shares this display name, so the name alone does not
   * identify the target. Duplicate names are known to exist in this product,
   * and a plan mixing two of them otherwise reads as one host. */
  ambiguous: boolean;
  connection: PluginConnection;
}

/** Pure: resolve an id to what the user should see, or null if unknown. */
export function resolveObjectRef(
  id: string,
  connections: PluginConnection[],
): ObjectRef | null {
  const conn = connections.find((c) => c.id === id);
  if (!conn) return null;
  const name = connectionDisplayName(conn);
  return {
    kind: "connection",
    id,
    name,
    detail: `${conn.username}@${conn.host}:${conn.port}`,
    ambiguous: connections.some((c) => c.id !== id && connectionDisplayName(c) === name),
    connection: conn,
  };
}
