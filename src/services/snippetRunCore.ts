import type { Connection } from "@/types";
import type { DynamicContext } from "@/services/snippetParser";

/** Build the dynamic-variable context from the (first) target session. Pure. */
export function buildDynamicContext(
  session: { type: string; connectionId: string; connectionName: string } | undefined,
  connections: Connection[],
  clipboard = "",
): DynamicContext {
  if (!session || session.type === "local") {
    return { connectionHost: "localhost", connectionUsername: "local", connectionName: "Local Shell", clipboard };
  }
  const conn = connections.find((c) => c.id === session.connectionId);
  return {
    connectionHost: conn?.host ?? "",
    connectionUsername: conn?.username ?? "",
    connectionName: session.connectionName,
    clipboard,
  };
}
