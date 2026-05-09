import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: number;
  team_id: string;
  vault_id: string | null;
  actor_id: string;
  actor_name: string;
  action: string;
  source: "server" | "client";
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditFilters {
  actions?: string[];
  actor_id?: string;
  from?: string;
  to?: string;
  page: number;
  per_page: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getJwt(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "jwt" });
}

async function getServerUrl(): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key: "server_url" });
}

async function fetchAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const jwt = await getJwt();
  if (!jwt) throw new Error("Not authenticated");
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });
}

// ─── API ──────────────────────────────────────────────────────────────────────

export async function fetchAuditLogs(
  teamId: string,
  filters: AuditFilters,
): Promise<{ logs: AuditLog[]; total: number }> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("per_page", String(filters.per_page));
  if (filters.actions?.length) filters.actions.forEach((a) => params.append("action", a));
  if (filters.actor_id) params.set("actor_id", filters.actor_id);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/audit-logs?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch audit logs: ${res.status}`);
  return res.json();
}

export async function exportAuditLogs(
  teamId: string,
  filters: Omit<AuditFilters, "page" | "per_page">,
  format: "csv" | "json",
): Promise<Blob> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error("Not connected to server");

  const params = new URLSearchParams({ format });
  if (filters.actions?.length) filters.actions.forEach((a) => params.append("action", a));
  if (filters.actor_id) params.set("actor_id", filters.actor_id);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  const res = await fetchAuth(`${serverUrl}/v1/teams/${teamId}/audit-logs/export?${params}`);
  if (!res.ok) throw new Error(`Failed to export audit logs: ${res.status}`);
  return res.blob();
}

export async function reportClientEvent(
  teamId: string,
  event: {
    action: "connection.started" | "connection.ended" | "secret.viewed";
    vault_id?: string;
    target_type?: string;
    target_id?: string;
    target_name?: string;
    metadata?: Record<string, unknown>;
    occurred_at: string;
  },
): Promise<void> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return;
  try {
    await fetchAuth(`${serverUrl}/v1/teams/${teamId}/audit-logs/client`, {
      method: "POST",
      body: JSON.stringify(event),
    });
  } catch {
    // fire-and-forget: silently drop errors
  }
}
