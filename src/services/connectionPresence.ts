import { fetchWithAuth, getServerUrl } from "@/services/sync";

export interface ConnectionUsageEntry {
  connection_id: string;
  user_ids: string[];
}

/** Tell the server we started or stopped using a team-vault connection. Rejects when a retry could succeed. */
export async function notifyConnectionUsage(connectionId: string, inUse: boolean): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return;
  const res = await fetchWithAuth(`${serverUrl}/v1/presence/connection-usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connection_id: connectionId, in_use: inUse }),
  });
  if (!res.ok && (res.status >= 500 || res.status === 408 || res.status === 429)) {
    throw new Error(`HTTP ${res.status}`);
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
