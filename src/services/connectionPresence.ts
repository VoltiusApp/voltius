import { fetchWithAuth, getServerUrl } from "@/services/sync";

export interface ConnectionUsageEntry {
  connection_id: string;
  user_ids: string[];
}

/** Tell the server we just started or stopped using a team-vault connection in a terminal. */
export async function notifyConnectionUsage(connectionId: string, inUse: boolean): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return;
  try {
    await fetchWithAuth(`${serverUrl}/v1/presence/connection-usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: connectionId, in_use: inUse }),
    });
  } catch {
    // Fire-and-forget. Server-side disconnect cleanup is the safety net.
  }
}

/** Initial snapshot of teammates' in-flight connection usage. Called on SSE (re)connect. */
export async function fetchCurrentConnectionUsage(): Promise<ConnectionUsageEntry[]> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return [];
  try {
    const res = await fetchWithAuth(`${serverUrl}/v1/presence/connection-usage`, { method: "GET" });
    if (!res.ok) return [];
    return (await res.json()) as ConnectionUsageEntry[];
  } catch {
    return [];
  }
}
