import { invoke } from "@tauri-apps/api/core";
import type { Identity, IdentityFormData } from "@/types";

export async function listIdentities(): Promise<Identity[]> {
  return invoke("identity_list");
}

export async function saveIdentity(data: IdentityFormData): Promise<Identity> {
  return invoke("identity_save", { data });
}

export async function updateIdentity(id: string, data: IdentityFormData): Promise<Identity> {
  return invoke("identity_update", { id, data });
}

export async function deleteIdentity(id: string): Promise<void> {
  return invoke("identity_delete", { id });
}
