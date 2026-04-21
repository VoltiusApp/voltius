import { invoke } from "@tauri-apps/api/core";
import type { Connection, ConnectionFormData } from "@/types";

export async function listConnections(): Promise<Connection[]> {
  return invoke("connection_list");
}

export async function saveConnection(data: ConnectionFormData): Promise<Connection> {
  return invoke("connection_save", { data });
}

export async function updateConnection(id: string, data: ConnectionFormData): Promise<Connection> {
  return invoke("connection_update", { id, data });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke("connection_delete", { id });
}

export async function setConnectionDistro(id: string, distro: string): Promise<void> {
  return invoke("connection_set_distro", { id, distro });
}

export async function setConnectionLastUsed(id: string): Promise<void> {
  return invoke("connection_set_last_used", { id });
}
